import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ensurePhoneCheckLedger } from "@/lib/phone-accuracy";

/**
 * Engine-side rollup behind GET /api/kpi-stats: everything the portal's
 * admin "OS Text Performance" tab needs from this engine in one call.
 *
 * All windowed numbers share the same `days` cutoff so the tiles, funnel,
 * daily trend, and cost lines always agree with each other. Current-state
 * gauges (contact statuses, campaign counts, freshness stamps) are not
 * windowed: they answer "what is the engine holding right now".
 */

// Mirrors the spend page's segment estimate: Telnyx bills outbound per GSM-7
// segment (<=160 chars = 1, else 153/segment) including the appended
// "\n\nReply STOP to opt out." footer.
const OPT_OUT_LEN = 24;
const OUTBOUND_SEGMENTS = sql`CASE WHEN char_length(body) + ${OPT_OUT_LEN} <= 160 THEN 1 ELSE ceil((char_length(body) + ${OPT_OUT_LEN})::numeric / 153) END`;

const SMS_OUT = Number(process.env.SMS_OUT_COST ?? "0.0079");
const SMS_IN = Number(process.env.SMS_IN_COST ?? "0.001");
const PROFILE_COST = Number(process.env.RAPIDAPI_PROFILE_COST ?? "0.00267");
const LOOKUP_COST = Number(process.env.TELNYX_LOOKUP_COST ?? "0.0025");
const TZ = process.env.APP_TIMEZONE ?? "America/Chicago";

/** Reply labels that count as a positive outcome for the funnel. */
const POSITIVE_LABELS = ["positive", "curious", "referral", "asked_email", "asked_compensation", "asked_remote", "asked_client"];

interface Row extends Record<string, unknown> {}

async function one(q: Parameters<typeof db.execute>[0]): Promise<Row> {
  const r = (await db.execute(q)) as { rows?: Row[] };
  return (r.rows ?? [])[0] ?? {};
}
async function many(q: Parameters<typeof db.execute>[0]): Promise<Row[]> {
  const r = (await db.execute(q)) as { rows?: Row[] };
  return r.rows ?? [];
}
const n = (v: unknown): number => Number(v ?? 0) || 0;

export interface KpiDay {
  day: string;
  sentMsgs: number;
  deliveredMsgs: number;
  failedMsgs: number;
  inboundMsgs: number;
  positiveMsgs: number;
  optOuts: number;
  checked: number;
  cellConfirmed: number;
}

export interface KpiStats {
  days: number;
  generatedAt: string;
  funnel: {
    contactsAdded: number;
    checked: number;
    cellConfirmed: number;
    texted: number;
    delivered: number;
    replied: number;
    positive: number;
    wrongNumber: number;
    optedOut: number;
  };
  messages: {
    sentMsgs: number;
    deliveredMsgs: number;
    failedMsgs: number;
    unconfirmedMsgs: number;
    inboundMsgs: number;
    outboundSegments: number;
    failureReasons: { reason: string; count: number }[];
  };
  classifications: { label: string; count: number }[];
  daily: KpiDay[];
  costs: {
    smsUsd: number;
    llmUsd: number;
    enrichUsd: number;
    lookupUsd: number;
    lookups: number;
    profilesEnriched: number;
  };
  engine: {
    activeCampaigns: number;
    scheduledCampaigns: number;
    totalCampaigns: number;
    contactsByStatus: Record<string, number>;
    lastOutboundAt: string | null;
    lastInboundAt: string | null;
    lastCheckAt: string | null;
  };
}

export async function kpiStats(days = 30): Promise<KpiStats> {
  await ensurePhoneCheckLedger();
  // The window is the last `days` CALENDAR days in APP_TIMEZONE, today
  // included (days=30 means today plus the 29 days before it). A rolling
  // now()-N*24h cutoff made the headline counts disagree with the daily[]
  // series: daily buckets by local calendar day, and the rolling cutoff kept
  // a partial extra day on the far end that the portal's day axis (last N
  // calendar days) never renders, so tiles and trend totals drifted apart.
  // `back` is clamped locally so the raw interval below is always a safe int.
  const back = Math.max(0, Math.min(89, Math.floor(days) - 1));
  const cutRow = await one(sql`SELECT ((date_trunc('day', now() AT TIME ZONE ${TZ}) - ${sql.raw(`interval '${back} days'`)}) AT TIME ZONE ${TZ}) AS cutoff`);
  const cutoff = new Date(String(cutRow.cutoff)).toISOString();
  const positiveList = sql.join(POSITIVE_LABELS.map((l) => sql`${l}`), sql`, `);

  const [checks, added, funnel, optOutRow, msg, failures, classes, msgDays, checkDays, optDays, llm, enrich, camp, statuses, fresh] = await Promise.all([
    one(sql`SELECT count(*)::int AS checked, count(*) FILTER (WHERE kept)::int AS cell
            FROM phone_check_outcomes WHERE created_at > ${cutoff}`),
    one(sql`SELECT count(*)::int AS added FROM contacts WHERE created_at > ${cutoff}`),
    one(sql`SELECT count(DISTINCT ct.id) FILTER (WHERE m.direction = 'outbound')::int AS texted,
                   count(DISTINCT ct.id) FILTER (WHERE m.direction = 'outbound' AND m.status = 'delivered')::int AS delivered,
                   count(DISTINCT ct.id) FILTER (WHERE m.direction = 'inbound')::int AS replied,
                   count(DISTINCT ct.id) FILTER (WHERE cv.classification IN (${positiveList}))::int AS positive,
                   count(DISTINCT ct.id) FILTER (WHERE cv.classification = 'wrong_person' OR m.classification = 'wrong_person')::int AS wrong_number
            FROM contacts ct
            JOIN conversations cv ON cv.contact_id = ct.id
            JOIN messages m ON m.conversation_id = cv.id
            WHERE m.created_at > ${cutoff}`),
    one(sql`SELECT count(DISTINCT phone)::int AS opted
            FROM suppressed_numbers WHERE reason = 'opted_out' AND created_at > ${cutoff}`),
    one(sql`SELECT count(*) FILTER (WHERE direction = 'outbound' AND status IN ('sent','delivered','failed'))::int AS sent,
                   count(*) FILTER (WHERE direction = 'outbound' AND status = 'delivered')::int AS delivered,
                   count(*) FILTER (WHERE direction = 'outbound' AND status = 'failed')::int AS failed,
                   count(*) FILTER (WHERE direction = 'outbound' AND status = 'sent')::int AS unconfirmed,
                   count(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
                   coalesce(sum(${OUTBOUND_SEGMENTS}) FILTER (WHERE direction = 'outbound'), 0)::int AS segments
            FROM messages WHERE created_at > ${cutoff}`),
    many(sql`SELECT coalesce(nullif(trim(error), ''), 'No reason recorded') AS reason, count(*)::int AS count
             FROM messages
             WHERE direction = 'outbound' AND status = 'failed' AND created_at > ${cutoff}
             GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
    many(sql`SELECT classification::text AS label, count(*)::int AS count
             FROM conversations
             WHERE classification IS NOT NULL AND last_message_at > ${cutoff}
             GROUP BY 1 ORDER BY 2 DESC`),
    many(sql`SELECT to_char((created_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day,
                    count(*) FILTER (WHERE direction = 'outbound' AND status IN ('sent','delivered','failed'))::int AS sent,
                    count(*) FILTER (WHERE direction = 'outbound' AND status = 'delivered')::int AS delivered,
                    count(*) FILTER (WHERE direction = 'outbound' AND status = 'failed')::int AS failed,
                    count(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
                    count(*) FILTER (WHERE direction = 'inbound' AND classification IN (${positiveList}))::int AS positive
             FROM messages WHERE created_at > ${cutoff}
             GROUP BY 1 ORDER BY 1`),
    many(sql`SELECT to_char((created_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day,
                    count(*)::int AS checked,
                    count(*) FILTER (WHERE kept)::int AS cell
             FROM phone_check_outcomes WHERE created_at > ${cutoff}
             GROUP BY 1 ORDER BY 1`),
    many(sql`SELECT to_char((created_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day, count(DISTINCT phone)::int AS opted
             FROM suppressed_numbers WHERE reason = 'opted_out' AND created_at > ${cutoff}
             GROUP BY 1 ORDER BY 1`),
    one(sql`SELECT coalesce(sum(cost_usd), 0)::float AS usd FROM usage_events WHERE created_at > ${cutoff}`),
    one(sql`SELECT count(*)::int AS profiles FROM contacts
            WHERE enriched_profile IS NOT NULL AND enriched_at IS NOT NULL AND enriched_at > ${cutoff}`),
    one(sql`SELECT count(*)::int AS total,
                   count(*) FILTER (WHERE status = 'active')::int AS active,
                   count(*) FILTER (WHERE scheduled_at IS NOT NULL)::int AS scheduled
            FROM campaigns`),
    many(sql`SELECT status::text AS status, count(*)::int AS count FROM contacts WHERE deleted_at IS NULL GROUP BY 1`),
    one(sql`SELECT (SELECT max(created_at) FROM messages WHERE direction = 'outbound') AS last_out,
                   (SELECT max(created_at) FROM messages WHERE direction = 'inbound') AS last_in,
                   (SELECT max(created_at) FROM phone_check_outcomes) AS last_check`),
  ]);

  // Stitch the three daily series into one array keyed by day.
  const byDay = new Map<string, KpiDay>();
  const dayRow = (day: string): KpiDay => {
    let row = byDay.get(day);
    if (!row) {
      row = { day, sentMsgs: 0, deliveredMsgs: 0, failedMsgs: 0, inboundMsgs: 0, positiveMsgs: 0, optOuts: 0, checked: 0, cellConfirmed: 0 };
      byDay.set(day, row);
    }
    return row;
  };
  for (const r of msgDays) {
    const row = dayRow(String(r.day));
    row.sentMsgs = n(r.sent);
    row.deliveredMsgs = n(r.delivered);
    row.failedMsgs = n(r.failed);
    row.inboundMsgs = n(r.inbound);
    row.positiveMsgs = n(r.positive);
  }
  for (const r of checkDays) {
    const row = dayRow(String(r.day));
    row.checked = n(r.checked);
    row.cellConfirmed = n(r.cell);
  }
  for (const r of optDays) dayRow(String(r.day)).optOuts = n(r.opted);
  const daily = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));

  const segments = n(msg.segments);
  const inbound = n(msg.inbound);
  const lookups = n(checks.checked);
  const profiles = n(enrich.profiles);

  const contactsByStatus: Record<string, number> = {};
  for (const r of statuses) contactsByStatus[String(r.status)] = n(r.count);

  return {
    days,
    generatedAt: new Date().toISOString(),
    funnel: {
      contactsAdded: n(added.added),
      checked: lookups,
      cellConfirmed: n(checks.cell),
      texted: n(funnel.texted),
      delivered: n(funnel.delivered),
      replied: n(funnel.replied),
      positive: n(funnel.positive),
      wrongNumber: n(funnel.wrong_number),
      optedOut: n(optOutRow.opted),
    },
    messages: {
      sentMsgs: n(msg.sent),
      deliveredMsgs: n(msg.delivered),
      failedMsgs: n(msg.failed),
      unconfirmedMsgs: n(msg.unconfirmed),
      inboundMsgs: inbound,
      outboundSegments: segments,
      failureReasons: failures.map((r) => ({ reason: String(r.reason), count: n(r.count) })),
    },
    classifications: classes.map((r) => ({ label: String(r.label), count: n(r.count) })),
    daily,
    costs: {
      smsUsd: segments * SMS_OUT + inbound * SMS_IN,
      llmUsd: n(llm.usd),
      enrichUsd: profiles * PROFILE_COST,
      lookupUsd: lookups * LOOKUP_COST,
      lookups,
      profilesEnriched: profiles,
    },
    engine: {
      activeCampaigns: n(camp.active),
      scheduledCampaigns: n(camp.scheduled),
      totalCampaigns: n(camp.total),
      contactsByStatus,
      lastOutboundAt: fresh.last_out ? new Date(String(fresh.last_out)).toISOString() : null,
      lastInboundAt: fresh.last_in ? new Date(String(fresh.last_in)).toISOString() : null,
      lastCheckAt: fresh.last_check ? new Date(String(fresh.last_check)).toISOString() : null,
    },
  };
}
