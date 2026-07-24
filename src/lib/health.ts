import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * System health checks for OS Text (taltxt).
 *
 * Two independent signals, because "send works but receive doesn't" is the
 * classic split and each half fails differently:
 *
 *   1. Telnyx connection (live API) — proves the account is reachable AND that
 *      the messaging profile's INBOUND webhook URL points back at this app.
 *      A blank/wrong webhook URL is the #1 cause of replies never arriving:
 *      outbound still sends fine because sending never touches the webhook.
 *
 *   2. SMS activity (this app's database) — sends, delivery receipts, and
 *      inbound replies actually recorded, per recruiter. If we are sending but
 *      zero replies are landing, receiving is broken even if Telnyx looks ok.
 */

const TELNYX_API = "https://api.telnyx.com/v2";

/** The inbound webhook URL Telnyx SHOULD be posting replies to. */
export function expectedWebhookUrl(): string {
  const base = (process.env.PUBLIC_APP_URL || process.env.AUTH_URL || "")
    .trim()
    .replace(/\/$/, "");
  return base ? `${base}/api/webhooks/telnyx` : "";
}

function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/$/, "").toLowerCase();
  return !!a && !!b && norm(a) === norm(b);
}

async function telnyxGet(path: string): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> {
  const key = process.env.TELNYX_API_KEY;
  if (!key) return { ok: false, status: 0, json: null, error: "TELNYX_API_KEY not set" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${TELNYX_API}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return { ok: false, status: 0, json: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export type TelnyxNumber = { phoneNumber: string; status: string };

export type TelnyxConnection = {
  apiKeySet: boolean;
  reachable: boolean; // a Telnyx API call succeeded
  profileId: string | null;
  profileFound: boolean;
  profileName: string | null;
  profileEnabled: boolean;
  webhookUrlActual: string | null; // what Telnyx has on file for inbound
  webhookUrlExpected: string;
  webhookUrlOk: boolean; // actual matches expected
  webhookApiVersion: string | null;
  publicKeySet: boolean; // TELNYX_PUBLIC_KEY, used to verify inbound signatures
  fromNumberSet: boolean;
  numbers: TelnyxNumber[];
  error: string | null;
};

/** Query the Telnyx API for the messaging profile config + assigned numbers. */
export async function getTelnyxConnection(): Promise<TelnyxConnection> {
  const profileId = process.env.TELNYX_MESSAGING_PROFILE_ID || null;
  const expected = expectedWebhookUrl();
  const base: TelnyxConnection = {
    apiKeySet: !!process.env.TELNYX_API_KEY,
    reachable: false,
    profileId,
    profileFound: false,
    profileName: null,
    profileEnabled: false,
    webhookUrlActual: null,
    webhookUrlExpected: expected,
    webhookUrlOk: false,
    webhookApiVersion: null,
    publicKeySet: !!process.env.TELNYX_PUBLIC_KEY,
    fromNumberSet: !!process.env.TELNYX_FROM_NUMBER,
    numbers: [],
    error: null,
  };

  if (!base.apiKeySet) {
    base.error = "TELNYX_API_KEY not set";
    return base;
  }
  if (!profileId) {
    base.error = "TELNYX_MESSAGING_PROFILE_ID not set";
    // We can still confirm the account is reachable + list numbers.
  }

  const profileRes = profileId
    ? await telnyxGet(`/messaging_profiles/${encodeURIComponent(profileId)}`)
    : await telnyxGet(`/messaging_profiles?page[size]=1`);

  if (!profileRes.ok) {
    base.error = profileRes.error || `Telnyx API returned ${profileRes.status}`;
    return base;
  }
  base.reachable = true;

  const data = (profileRes.json as { data?: unknown })?.data;
  const profile = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : (data as Record<string, unknown> | undefined);
  if (profile && typeof profile === "object") {
    base.profileFound = true;
    base.profileName = (profile.name as string) ?? null;
    base.profileEnabled = profile.enabled !== false;
    base.webhookUrlActual = (profile.webhook_url as string) || null;
    base.webhookApiVersion = (profile.webhook_api_version as string) ?? null;
    base.webhookUrlOk = sameUrl(base.webhookUrlActual ?? "", expected);
  }

  // Numbers assigned to the profile (proves the sending number is live).
  if (profileId) {
    const numRes = await telnyxGet(`/messaging_profiles/${encodeURIComponent(profileId)}/phone_numbers?page[size]=25`);
    if (numRes.ok) {
      const arr = ((numRes.json as { data?: unknown })?.data as Record<string, unknown>[]) ?? [];
      base.numbers = arr.map((n) => ({
        phoneNumber: (n.phone_number as string) ?? "",
        status: (n.status as string) ?? "unknown",
      }));
    }
  }

  return base;
}

export type SmsHealth = {
  outbound24h: number;
  outbound7d: number;
  outboundAll: number;
  deliveredAll: number;
  failedAll: number;
  pendingAll: number;
  deliveryRate: number; // delivered / (delivered + failed), 0-100
  inbound24h: number;
  inbound7d: number;
  inboundAll: number;
  lastInbound: string | null; // ISO
  lastOutbound: string | null; // ISO
  deliveryReceiptsSeen: boolean; // any outbound reached delivered/failed => outbound webhook works
};

export async function getSmsHealth(): Promise<SmsHealth> {
  const r = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE direction='outbound' AND created_at >= now() - interval '24 hours')::int AS out_24h,
      count(*) FILTER (WHERE direction='outbound' AND created_at >= now() - interval '7 days')::int  AS out_7d,
      count(*) FILTER (WHERE direction='outbound')::int AS out_all,
      count(*) FILTER (WHERE direction='outbound' AND status='delivered')::int AS delivered_all,
      count(*) FILTER (WHERE direction='outbound' AND status='failed')::int AS failed_all,
      count(*) FILTER (WHERE direction='outbound' AND status IN ('queued','sending','sent','pending'))::int AS pending_all,
      count(*) FILTER (WHERE direction='inbound' AND created_at >= now() - interval '24 hours')::int AS in_24h,
      count(*) FILTER (WHERE direction='inbound' AND created_at >= now() - interval '7 days')::int  AS in_7d,
      count(*) FILTER (WHERE direction='inbound')::int AS in_all,
      max(created_at) FILTER (WHERE direction='inbound')  AS last_inbound,
      max(created_at) FILTER (WHERE direction='outbound') AS last_outbound
    FROM messages
  `)) as { rows?: Record<string, unknown>[] };
  const row = (r.rows ?? [])[0] ?? {};
  const num = (k: string) => Number(row[k] ?? 0);
  const iso = (k: string) => {
    const v = row[k];
    return v ? new Date(v as string).toISOString() : null;
  };
  const delivered = num("delivered_all");
  const failed = num("failed_all");
  const denom = delivered + failed;
  return {
    outbound24h: num("out_24h"),
    outbound7d: num("out_7d"),
    outboundAll: num("out_all"),
    deliveredAll: delivered,
    failedAll: failed,
    pendingAll: num("pending_all"),
    deliveryRate: denom ? Math.round((delivered / denom) * 100) : 0,
    inbound24h: num("in_24h"),
    inbound7d: num("in_7d"),
    inboundAll: num("in_all"),
    lastInbound: iso("last_inbound"),
    lastOutbound: iso("last_outbound"),
    deliveryReceiptsSeen: denom > 0,
  };
}

export type RecruiterRow = {
  recruiter: string;
  campaigns: number;
  outbound7d: number;
  inbound7d: number;
  outboundAll: number;
  inboundAll: number;
  lastInbound: string | null;
  receiveOk: boolean; // sending but zero inbound ever => false
};

export async function getRecruiterBreakdown(): Promise<RecruiterRow[]> {
  const r = (await db.execute(sql`
    SELECT
      coalesce(nullif(trim(c.recruiter_name), ''), 'Unassigned') AS recruiter,
      count(DISTINCT c.id)::int AS campaigns,
      count(*) FILTER (WHERE m.direction='outbound' AND m.created_at >= now() - interval '7 days')::int AS out_7d,
      count(*) FILTER (WHERE m.direction='inbound'  AND m.created_at >= now() - interval '7 days')::int AS in_7d,
      count(*) FILTER (WHERE m.direction='outbound')::int AS out_all,
      count(*) FILTER (WHERE m.direction='inbound')::int  AS in_all,
      max(m.created_at) FILTER (WHERE m.direction='inbound') AS last_inbound
    FROM campaigns c
    LEFT JOIN conversations cv ON cv.campaign_id = c.id
    LEFT JOIN messages m ON m.conversation_id = cv.id
    GROUP BY recruiter
    ORDER BY out_all DESC, recruiter ASC
  `)) as { rows?: Record<string, unknown>[] };
  return (r.rows ?? []).map((row) => {
    const outAll = Number(row.out_all ?? 0);
    const inAll = Number(row.in_all ?? 0);
    return {
      recruiter: String(row.recruiter ?? "Unassigned"),
      campaigns: Number(row.campaigns ?? 0),
      outbound7d: Number(row.out_7d ?? 0),
      inbound7d: Number(row.in_7d ?? 0),
      outboundAll: outAll,
      inboundAll: inAll,
      lastInbound: row.last_inbound ? new Date(row.last_inbound as string).toISOString() : null,
      // If a recruiter has sent a meaningful volume but never received a single
      // reply, their receive path is almost certainly broken.
      receiveOk: !(outAll >= 25 && inAll === 0),
    };
  });
}

export type OverallStatus = "ok" | "degraded" | "down";

export type HealthReport = {
  status: OverallStatus;
  checkedAt: string;
  telnyx: TelnyxConnection;
  sms: SmsHealth;
  recruiters: RecruiterRow[];
  issues: string[];
};

/**
 * Roll the raw checks into one status + a plain-English issue list.
 *   down     = receiving is (almost certainly) broken right now
 *   degraded = something needs attention but core flow works
 *   ok       = sending and receiving both look healthy
 */
export function summarize(
  telnyx: TelnyxConnection,
  sms: SmsHealth,
  recruiters: RecruiterRow[],
): { status: OverallStatus; issues: string[] } {
  const issues: string[] = [];
  let down = false;
  let degraded = false;

  if (!telnyx.apiKeySet) {
    issues.push("Telnyx API key is not configured, so we cannot verify the connection.");
    degraded = true;
  } else if (!telnyx.reachable) {
    issues.push(`Cannot reach the Telnyx API${telnyx.error ? ` (${telnyx.error})` : ""}. Sends and lookups may be failing.`);
    down = true;
  } else {
    if (!telnyx.profileFound) {
      issues.push("The configured Telnyx messaging profile was not found. Check TELNYX_MESSAGING_PROFILE_ID.");
      down = true;
    }
    if (!telnyx.profileEnabled) {
      issues.push("The Telnyx messaging profile is disabled. Enable it in the Telnyx portal.");
      down = true;
    }
    // The critical receive check.
    if (!telnyx.webhookUrlActual) {
      issues.push("Telnyx has NO inbound webhook URL set on the messaging profile, so replies are never delivered to OS Text. This breaks receiving.");
      down = true;
    } else if (!telnyx.webhookUrlOk) {
      issues.push(`Telnyx inbound webhook URL is wrong. It points at ${telnyx.webhookUrlActual} but should be ${telnyx.webhookUrlExpected}. Replies are not reaching OS Text.`);
      down = true;
    }
    if (!telnyx.publicKeySet) {
      issues.push("TELNYX_PUBLIC_KEY is not set, so inbound webhooks are accepted unverified. Set it to verify signatures.");
      degraded = true;
    }
  }

  // Sending but never receiving = receive path broken even if config looks ok.
  if (sms.outboundAll >= 25 && sms.inboundAll === 0) {
    issues.push("We have sent messages but never recorded a single inbound reply. Receiving is almost certainly broken.");
    down = true;
  }
  // Outbound piling up with no delivery receipts => delivery webhook not landing.
  if (sms.outboundAll >= 25 && !sms.deliveryReceiptsSeen) {
    issues.push("No delivery receipts have been recorded for any sent message. Delivery-status webhooks may not be reaching OS Text.");
    degraded = true;
  }
  // Actively sending but no reply in over 3 days.
  if (sms.outbound7d >= 25 && sms.inbound7d === 0) {
    issues.push("Messages went out in the last 7 days but no replies came back. Check the inbound webhook.");
    degraded = true;
  }
  // Low delivery rate.
  if (sms.deliveredAll + sms.failedAll >= 20 && sms.deliveryRate < 70) {
    issues.push(`Delivery rate is low (${sms.deliveryRate}%). Check your 10DLC registration and number health.`);
    degraded = true;
  }

  for (const r of recruiters) {
    if (!r.receiveOk) {
      issues.push(`Recruiter "${r.recruiter}" has sent ${r.outboundAll} messages but received 0 replies.`);
      degraded = true;
    }
  }

  const status: OverallStatus = down ? "down" : degraded ? "degraded" : "ok";
  return { status, issues };
}

/** One call that runs every check and returns the full report. */
export async function getHealthReport(): Promise<HealthReport> {
  const [telnyx, sms, recruiters] = await Promise.all([
    getTelnyxConnection(),
    getSmsHealth(),
    getRecruiterBreakdown(),
  ]);
  const { status, issues } = summarize(telnyx, sms, recruiters);
  return { status, checkedAt: new Date().toISOString(), telnyx, sms, recruiters, issues };
}
