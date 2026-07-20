import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Phone accuracy by source: the send-and-response scoreboard for every phone
 * number pushed into OS Text.
 *
 * The portal stamps each contact's customFields.phone_source with the rung that
 * produced the number (skiptrace = the paid Boost lookup, koldinfo, laxis,
 * landlinedb, finder). This module turns that provenance into a tracked metric:
 *
 *   1. Validation outcomes: the Telnyx cell-line check DELETES failed contact
 *      rows, so runValidateBatch records each verdict here first, into the
 *      phone_check_outcomes ledger (created on first use; no migration step).
 *   2. Send / response outcomes: computed live from contacts, messages, and
 *      conversations (delivery via Telnyx DLR, replies, AI-classified
 *      wrong_person replies, opt-outs) grouped by phone_source.
 *
 * Surfaced by GET /api/phone-accuracy for the portal's Outbound Performance
 * "Phone number accuracy" card.
 */

let tableReady: Promise<void> | null = null;

/** Idempotent create of the validation-outcome ledger (same spirit as scripts/migrate-*). */
export function ensurePhoneCheckLedger(): Promise<void> {
  if (!tableReady) {
    tableReady = db
      .execute(
        sql`CREATE TABLE IF NOT EXISTS phone_check_outcomes (
          id bigserial PRIMARY KEY,
          campaign_id uuid,
          phone text NOT NULL,
          phone_source text,
          line_type text NOT NULL,
          kept boolean NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
      )
      .then(() => undefined)
      .catch((err) => {
        // Next attempt retries the create; callers treat recording as best-effort.
        tableReady = null;
        throw err;
      });
  }
  return tableReady;
}

export interface PhoneCheckOutcome {
  campaignId: string;
  phone: string;
  /** customFields.phone_source of the contact, when the portal stamped one. */
  phoneSource?: string | null;
  lineType: string;
  kept: boolean;
}

/** Record one Telnyx line-type verdict. Best-effort: accuracy bookkeeping must
 *  never break validation itself, so callers .catch and move on. */
export async function recordPhoneCheck(o: PhoneCheckOutcome): Promise<void> {
  await ensurePhoneCheckLedger();
  await db.execute(
    sql`INSERT INTO phone_check_outcomes (campaign_id, phone, phone_source, line_type, kept)
        VALUES (${o.campaignId}, ${o.phone}, ${o.phoneSource ?? null}, ${o.lineType}, ${o.kept})`,
  );
}

export interface SourceAccuracy {
  source: string;
  /** Telnyx line-type checks recorded (each = one pushed number reaching validation). */
  checked: number;
  /** Checks that confirmed a textable cell. */
  cellConfirmed: number;
  /** Contacts actually sent at least one SMS. */
  texted: number;
  /** Texted contacts with a Telnyx-confirmed delivery. */
  delivered: number;
  /** Contacts who replied at all. */
  replied: number;
  /** Contacts whose reply was AI-classified wrong_person ("wrong number / not me"). */
  wrongNumber: number;
  /** Contacts who opted out (STOP). */
  optedOut: number;
}

interface FunnelRow extends Record<string, unknown> {
  source: string;
  texted: number;
  delivered: number;
  replied: number;
  wrong_number: number;
  opted_out: number;
}

interface CheckRow extends Record<string, unknown> {
  source: string;
  checked: number;
  cell_confirmed: number;
}

/** Aggregate accuracy per phone source across all campaigns. */
export async function phoneAccuracyBySource(): Promise<SourceAccuracy[]> {
  await ensurePhoneCheckLedger();

  const checks = await db.execute<CheckRow>(
    sql`SELECT COALESCE(phone_source, 'unknown') AS source,
               count(*)::int AS checked,
               count(*) FILTER (WHERE kept)::int AS cell_confirmed
        FROM phone_check_outcomes
        GROUP BY 1`,
  );

  // Send-and-response funnel from the message ledger, per contact, grouped by
  // the contact's stamped source. Delivery = Telnyx DLR on an outbound message;
  // wrong-number = the conversation's AI classification.
  const funnel = await db.execute<FunnelRow>(
    sql`SELECT COALESCE(ct.custom_fields->>'phone_source', 'unknown') AS source,
               count(DISTINCT ct.id) FILTER (WHERE m.direction = 'outbound')::int AS texted,
               count(DISTINCT ct.id) FILTER (WHERE m.direction = 'outbound' AND m.status = 'delivered')::int AS delivered,
               count(DISTINCT ct.id) FILTER (WHERE m.direction = 'inbound')::int AS replied,
               count(DISTINCT ct.id) FILTER (WHERE cv.classification = 'wrong_person' OR m.classification = 'wrong_person')::int AS wrong_number,
               count(DISTINCT ct.id) FILTER (WHERE ct.opted_out)::int AS opted_out
        FROM contacts ct
        JOIN conversations cv ON cv.contact_id = ct.id
        JOIN messages m ON m.conversation_id = cv.id
        GROUP BY 1`,
  );

  const bySource = new Map<string, SourceAccuracy>();
  const get = (source: string): SourceAccuracy => {
    let row = bySource.get(source);
    if (!row) {
      row = { source, checked: 0, cellConfirmed: 0, texted: 0, delivered: 0, replied: 0, wrongNumber: 0, optedOut: 0 };
      bySource.set(source, row);
    }
    return row;
  };
  for (const r of checks.rows) {
    const row = get(r.source);
    row.checked = r.checked;
    row.cellConfirmed = r.cell_confirmed;
  }
  for (const r of funnel.rows) {
    const row = get(r.source);
    row.texted = r.texted;
    row.delivered = r.delivered;
    row.replied = r.replied;
    row.wrongNumber = r.wrong_number;
    row.optedOut = r.opted_out;
  }
  // Named sources first (most data first), the unknown bucket last.
  return Array.from(bySource.values()).sort((a, b) =>
    Number(a.source === "unknown") - Number(b.source === "unknown") || b.texted - a.texted || b.checked - a.checked);
}
