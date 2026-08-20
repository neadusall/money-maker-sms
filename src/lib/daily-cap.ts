import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Campaign } from "@/db/schema";

/**
 * OS Text · Daily cap + day-spreading
 *
 * The drain used to send as fast as the batch loop and the MPS throttle allowed. For a warm
 * 10DLC fleet that was fine. For a single business line doing 200/day it is the fastest way
 * to lose the number: carriers score volume SPIKES, and Apple throttles Apple IDs that fan
 * out to many strangers in a short burst. "200 a day" only protects a line if it is genuinely 200
 * spread across the send window, not 200 inside the first ten minutes.
 *
 * The mechanic is a release valve rather than a scheduler. On every sweep we ask: given how
 * far we are through today's send window, how many of today's allowance SHOULD have gone out
 * by now? Anything already sent counts against it; the difference is what this sweep may
 * release. That self-corrects — an outage at 10am doesn't lose the day's volume, it just
 * releases a little faster afterwards — and it needs no queue table, no cron, and no state
 * beyond the messages already in the database.
 *
 * On top of the even release, each individual send takes a random extra delay (see
 * `jitterDelayMs`). Two hundred sends at a mathematically perfect 162-second interval is
 * itself a machine signature; humans are lumpy.
 */

const TZ = process.env.APP_TIMEZONE ?? "America/New_York";

function parseHHMM(s: string, fallbackH: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? "").trim());
  if (!m) return fallbackH * 60;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return 1440;
  if (h < 0 || h > 23 || min < 0 || min > 59) return fallbackH * 60;
  return h * 60 + min;
}

/** Minutes since local midnight, in APP_TIMEZONE. */
function minutesNowLocal(now = new Date()): number {
  const local = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  return local.getHours() * 60 + local.getMinutes() + local.getSeconds() / 60;
}

/**
 * Today's allowance for a campaign, honoring the warm-up ramp.
 *
 * A brand-new line does NOT get the full cap on day one. `rampStart` is day one's budget
 * and it grows by `rampStep` for each day the campaign has been sending, up to `dailyCap`.
 * With rampStart=20, rampStep=20, dailyCap=200 a line reaches full volume on day ten —
 * which is roughly the gentlest schedule that still gets you to 200/day inside two weeks.
 *
 * `dayIndex` counts from the campaign's first outbound message, not from `createdAt`: a
 * campaign that sat in draft for a month is still cold on the day it actually starts.
 */
export function allowanceForDay(campaign: Campaign, dayIndex: number): number {
  const cap = campaign.dailyCap ?? 0;
  if (cap <= 0) return 0; // 0 / null = uncapped; callers check `dailyCap` before calling.
  const start = campaign.rampStart ?? 0;
  const step = campaign.rampStep ?? 0;
  if (start <= 0 || step <= 0) return cap;
  return Math.min(cap, start + step * Math.max(0, dayIndex));
}

export interface CapState {
  /** Null when the campaign is uncapped — the caller sends its normal batch. */
  capped: boolean;
  /** Today's total budget after the ramp. */
  allowance: number;
  /** Messages already sent today (local calendar day). */
  sentToday: number;
  /** How many the elapsed portion of the send window entitles us to have sent by now. */
  earned: number;
  /** What this sweep may release: max(0, earned - sentToday). */
  releasable: number;
  /** Day number since the campaign's first send, 0-based. */
  dayIndex: number;
}

/**
 * How many messages this campaign may release RIGHT NOW.
 *
 * Returns `capped: false` for a campaign with no `dailyCap`, so uncapped campaigns keep
 * their existing behavior byte-for-byte and this whole module is inert for them.
 */
export async function capState(campaign: Campaign, now = new Date()): Promise<CapState> {
  const inert: CapState = { capped: false, allowance: 0, sentToday: 0, earned: 0, releasable: 0, dayIndex: 0 };
  if (!campaign.dailyCap || campaign.dailyCap <= 0) return inert;

  const result = (await db.execute(sql`
    SELECT
      count(*) FILTER (
        WHERE m.direction = 'outbound'
          AND (m.created_at AT TIME ZONE ${TZ})::date = (now() AT TIME ZONE ${TZ})::date
      )::int AS sent_today,
      min(m.created_at) FILTER (WHERE m.direction = 'outbound') AS first_send
    FROM messages m
    JOIN conversations cv ON cv.id = m.conversation_id
    WHERE cv.campaign_id = ${campaign.id}
  `)) as { rows?: Record<string, unknown>[] };
  const row = (result.rows ?? [])[0] ?? {};

  const sentToday = Number(row.sent_today ?? 0) || 0;
  // Day 0 is the day of the first send. No sends yet = day 0 (today is day one of the ramp).
  const firstSend = row.first_send ? new Date(String(row.first_send)) : null;
  const dayIndex = firstSend
    ? Math.max(0, Math.floor((localMidnight(now) - localMidnight(firstSend)) / 86_400_000))
    : 0;

  const allowance = allowanceForDay(campaign, dayIndex);

  const startMin = parseHHMM(campaign.sendWindowStart, 9);
  const endMin = parseHHMM(campaign.sendWindowEnd, 19);
  const nowMin = minutesNowLocal(now);

  // Overnight windows (start > end) are not spread — they are a niche case and treating the
  // wrap-around as "0% elapsed" would stall them entirely. Release the whole allowance and
  // let the batch limit and jitter do the smoothing.
  const spanMin = endMin - startMin;
  let elapsedFraction: number;
  if (spanMin <= 0) {
    elapsedFraction = 1;
  } else if (nowMin <= startMin) {
    elapsedFraction = 0;
  } else if (nowMin >= endMin) {
    elapsedFraction = 1;
  } else {
    elapsedFraction = (nowMin - startMin) / spanMin;
  }

  const earned = Math.floor(allowance * elapsedFraction);
  return {
    capped: true,
    allowance,
    sentToday,
    earned,
    releasable: Math.max(0, earned - sentToday),
    dayIndex,
  };
}

function localMidnight(d: Date): number {
  const local = new Date(d.toLocaleString("en-US", { timeZone: TZ }));
  return Date.UTC(local.getFullYear(), local.getMonth(), local.getDate());
}

/**
 * A random extra pause before an individual capped send, so the spacing is irregular.
 *
 * Scaled to the natural gap between sends (window length / allowance) and capped at two
 * minutes: enough to break the metronome without letting jitter alone eat the day's volume.
 * Uses Math.random deliberately — unlike spintax selection, this must NOT be reproducible;
 * a deterministic "jitter" is just a slower metronome.
 */
export function jitterDelayMs(state: CapState, campaign: Campaign): number {
  if (!state.capped || state.allowance <= 0) return 0;
  const startMin = parseHHMM(campaign.sendWindowStart, 9);
  const endMin = parseHHMM(campaign.sendWindowEnd, 19);
  const spanMs = Math.max(0, endMin - startMin) * 60_000;
  if (spanMs === 0) return 0;
  const naturalGapMs = spanMs / state.allowance;
  return Math.floor(Math.random() * Math.min(naturalGapMs * 0.5, 120_000));
}

/**
 * Sends remaining in today's allowance, for the UI's "today" gauge. Cheap enough to call on
 * a page render; separate from `capState` so the dashboard doesn't recompute the window math.
 */
export async function sentTodayByLane(campaignId: string): Promise<{ telnyx: number; imessage: number }> {
  const result = (await db.execute(sql`
    SELECT m.provider::text AS provider, count(*)::int AS n
    FROM messages m
    JOIN conversations cv ON cv.id = m.conversation_id
    WHERE cv.campaign_id = ${campaignId}
      AND m.direction = 'outbound'
      AND (m.created_at AT TIME ZONE ${TZ})::date = (now() AT TIME ZONE ${TZ})::date
    GROUP BY 1
  `)) as { rows?: Record<string, unknown>[] };
  const out = { telnyx: 0, imessage: 0 };
  for (const r of result.rows ?? []) {
    const p = String(r.provider);
    if (p === "telnyx" || p === "imessage") out[p] = Number(r.n ?? 0) || 0;
  }
  return out;
}
