import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * OS Text · Lane comparison ("is the blue bubble actually working?")
 *
 * The claim behind the whole iMessage lane is that blue bubbles get more replies than green
 * ones. This module answers that with YOUR numbers instead of a vendor's, and it is
 * deliberately built to be hard to fool:
 *
 *  1. `provider` is trustworthy here ONLY because we own the sender. The router hands the
 *     Mac bridge nothing but handles it reports as iMessage-capable, so provider='imessage'
 *     really is a blue bubble. Were this a hosted iMessage API, its silent downgrades to
 *     carrier SMS would need a third bucket, or the blue lane's numbers would be inflated
 *     by green-bubble sends billed to it.
 *
 *  2. A reply is attributed to the lane of the outbound it ANSWERED — the most recent
 *     outbound in that conversation before the reply landed — not to the lane the reply
 *     itself arrived on and not to the campaign's current channel setting. A contact texted
 *     on iMessage and followed up on SMS credits each lane for what it earned.
 *
 *  3. A "reply" uses the same strict definition as the KPI tab: an inbound that is not a
 *     STOP and that follows an outbound in the same conversation. A cold inbound from a
 *     number we never texted is not engagement and must not inflate either lane.
 */

const TZ = process.env.APP_TIMEZONE ?? "America/New_York";

/** Reply labels that count as a positive outcome — same list the KPI funnel uses. */
const POSITIVE_LABELS = [
  "positive",
  "curious",
  "referral",
  "asked_email",
  "asked_compensation",
  "asked_remote",
  "asked_client",
];

export type LaneKey = "imessage" | "sms";

export interface LaneRow {
  lane: LaneKey;
  label: string;
  /** Outbound messages that left on this lane. */
  sent: number;
  delivered: number;
  failed: number;
  /** Distinct people reached — the denominator for reply rate. */
  recipients: number;
  /** Distinct people who answered (non-STOP, after an outbound). */
  replied: number;
  positive: number;
  optedOut: number;
  replyRatePct: number;
  positiveRatePct: number;
  deliveredRatePct: number;
}

export interface LaneComparison {
  days: number;
  generatedAt: string;
  rows: LaneRow[];
  /** True once both a blue and a green bucket have enough volume to be worth comparing. */
  verdictReady: boolean;
  /** Plain-English read of the comparison, or why it is not ready yet. */
  verdict: string;
}

const LABELS: Record<LaneKey, string> = {
  imessage: "iMessage (blue)",
  sms: "SMS (Telnyx)",
};

// Below this many recipients a lane's reply rate is noise, not a signal. Two hundred sends
// a day reaches it inside a week; declaring a winner before then is how a line gets scaled
// up on a coin flip.
const MIN_SAMPLE = Number(process.env.OSTEXT_LANE_MIN_SAMPLE ?? "100") || 100;

const pct = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : 0);

export async function laneComparison(days = 30, campaignId?: string): Promise<LaneComparison> {
  const back = Math.max(0, Math.min(89, Math.floor(days) - 1));
  const cutRow = (await db.execute(
    sql`SELECT ((date_trunc('day', now() AT TIME ZONE ${TZ}) - ${sql.raw(`interval '${back} days'`)}) AT TIME ZONE ${TZ}) AS cutoff`,
  )) as { rows?: Record<string, unknown>[] };
  const cutoff = new Date(String((cutRow.rows ?? [])[0]?.cutoff)).toISOString();

  const positiveList = sql.join(POSITIVE_LABELS.map((l) => sql`${l}`), sql`, `);
  // Optional campaign scope, so the same component serves the global dashboard and a single
  // campaign page without two near-identical queries drifting apart.
  const scope = campaignId ? sql`AND cv.campaign_id = ${campaignId}` : sql``;

  const result = (await db.execute(sql`
    WITH outbound AS (
      SELECT
        m.id,
        m.conversation_id,
        m.status,
        m.created_at,
        cv.contact_id,
        -- Our own bridge only ever carries iMessage-capable handles, so one column is the
        -- whole answer. Mirrors laneOf() in components/LaneBadge.tsx exactly.
        CASE WHEN m.provider = 'imessage' THEN 'imessage' ELSE 'sms' END AS lane
      FROM messages m
      JOIN conversations cv ON cv.id = m.conversation_id
      WHERE m.direction = 'outbound' AND m.created_at > ${cutoff} ${scope}
    ),
    inbound AS (
      SELECT
        m.id,
        cv.contact_id,
        m.classification,
        -- The lane this reply ANSWERED: the last outbound in the conversation before it.
        (
          SELECT o.lane FROM outbound o
          WHERE o.conversation_id = m.conversation_id AND o.created_at < m.created_at
          ORDER BY o.created_at DESC LIMIT 1
        ) AS lane
      FROM messages m
      JOIN conversations cv ON cv.id = m.conversation_id
      WHERE m.direction = 'inbound' AND m.created_at > ${cutoff} ${scope}
    )
    SELECT
      o.lane,
      count(*)::int AS sent,
      count(*) FILTER (WHERE o.status = 'delivered')::int AS delivered,
      count(*) FILTER (WHERE o.status = 'failed')::int AS failed,
      count(DISTINCT o.contact_id)::int AS recipients,
      (SELECT count(DISTINCT i.contact_id) FROM inbound i
        WHERE i.lane = o.lane AND i.classification IS DISTINCT FROM 'stop')::int AS replied,
      (SELECT count(DISTINCT i.contact_id) FROM inbound i
        WHERE i.lane = o.lane AND i.classification IN (${positiveList}))::int AS positive,
      (SELECT count(DISTINCT i.contact_id) FROM inbound i
        WHERE i.lane = o.lane AND i.classification = 'stop')::int AS opted_out
    FROM outbound o
    GROUP BY o.lane
  `)) as { rows?: Record<string, unknown>[] };

  const n = (v: unknown) => Number(v ?? 0) || 0;
  const byLane = new Map<LaneKey, LaneRow>();
  for (const r of result.rows ?? []) {
    const lane = String(r.lane) as LaneKey;
    if (!LABELS[lane]) continue;
    const sent = n(r.sent);
    const recipients = n(r.recipients);
    const replied = n(r.replied);
    const positive = n(r.positive);
    byLane.set(lane, {
      lane,
      label: LABELS[lane],
      sent,
      delivered: n(r.delivered),
      failed: n(r.failed),
      recipients,
      replied,
      positive,
      optedOut: n(r.opted_out),
      replyRatePct: pct(replied, recipients),
      positiveRatePct: pct(positive, recipients),
      deliveredRatePct: pct(n(r.delivered), sent),
    });
  }

  // Always emit both rows, zeros included: a lane showing 0 is information ("we have not
  // actually sent any blue bubbles yet"), whereas a missing row reads as a bug.
  const order: LaneKey[] = ["imessage", "sms"];
  const rows = order.map(
    (lane) =>
      byLane.get(lane) ?? {
        lane,
        label: LABELS[lane],
        sent: 0,
        delivered: 0,
        failed: 0,
        recipients: 0,
        replied: 0,
        positive: 0,
        optedOut: 0,
        replyRatePct: 0,
        positiveRatePct: 0,
        deliveredRatePct: 0,
      },
  );

  const blue = rows[0];
  const green = rows[1];
  const ready = blue.recipients >= MIN_SAMPLE && green.recipients >= MIN_SAMPLE;
  let verdict: string;
  if (!ready) {
    const short = [
      blue.recipients < MIN_SAMPLE ? `iMessage has ${blue.recipients} of ${MIN_SAMPLE}` : null,
      green.recipients < MIN_SAMPLE ? `SMS has ${green.recipients} of ${MIN_SAMPLE}` : null,
    ]
      .filter(Boolean)
      .join(" and ");
    verdict = `Not enough volume to call it yet: ${short} people reached.`;
  } else {
    const diff = Math.round((blue.replyRatePct - green.replyRatePct) * 10) / 10;
    if (Math.abs(diff) < 1) {
      verdict = `Too close to call: iMessage ${blue.replyRatePct}% vs SMS ${green.replyRatePct}% reply rate.`;
    } else if (diff > 0) {
      verdict = `iMessage is ahead by ${diff} points (${blue.replyRatePct}% vs ${green.replyRatePct}% reply rate).`;
    } else {
      verdict = `SMS is ahead by ${Math.abs(diff)} points (${green.replyRatePct}% vs ${blue.replyRatePct}% reply rate).`;
    }
  }

  return { days, generatedAt: new Date().toISOString(), rows, verdictReady: ready, verdict };
}
