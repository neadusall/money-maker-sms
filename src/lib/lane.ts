import crypto from "node:crypto";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { messages, type Campaign, type Contact } from "@/db/schema";
import {
  isBridgeConfigured,
  isAmbiguousBridgeError,
  checkIMessageAvailability,
  sendBridgeText,
  reconcileSend,
} from "./bluebubbles";
import { imessageSendAllowed } from "./imessage-warmup";
import { withOptOut } from "./opt-out";
import { normalizePhone } from "./phone";

/**
 * OS Text · Lane router
 *
 * The ONLY module that knows both sending lanes exist. `telnyx.ts` and `bluebubbles.ts` are
 * each ignorant of the other; everything that decides "blue bubble or green" lives here, so
 * there is exactly one place to read when the answer to "why did this go out as SMS?" is
 * needed.
 *
 * NO THIRD PARTY IS IN THIS PATH. The iMessage lane is our own Mac running BlueBubbles
 * Server against our own Apple ID. That is not a stylistic choice: iMessage can only be
 * originated by Apple hardware, so every hosted "iMessage API" is a vendor running a Mac
 * fleet and charging per line for it. Owning the Mac removes the vendor, the per-line fee,
 * and one real ambiguity - a hosted API silently downgrades to carrier SMS for non-iPhones,
 * so `provider` alone would never tell you what colour bubble actually arrived. Here the
 * router only ever hands the bridge handles the Mac positively reports as iMessage-capable,
 * so provider='imessage' IS a blue bubble and the lane comparison can trust one column.
 *
 * Three campaign channels:
 *   "sms"      - Telnyx only. The default, and what every pre-existing campaign keeps.
 *   "imessage" - Bridge only. Contacts it cannot reach are HELD, never silently sent green.
 *   "auto"     - Ask the bridge whether the handle is iMessage-capable; blue if yes,
 *                Telnyx if no or unknown.
 */

export type Lane = "telnyx" | "imessage";

export type LaneDecision =
  | { lane: "telnyx"; reason: string }
  | { lane: "imessage"; reason: string }
  // "hold" leaves the contact pending for a later sweep: the bridge could not be used and
  // the campaign forbids falling back. Never burns the contact.
  | { lane: "hold"; reason: string };

/**
 * Is the iMessage lane open for this campaign at all?
 *
 * FAILS CLOSED, and deliberately requires an explicit tenant opt-in on top of the bridge
 * credentials. The bridge is ONE person's Apple ID: another tenant's campaign riding it
 * would put their outreach on our owner's personal line, which is both a tenancy leak and
 * the fastest way to get that Apple ID flagged. Unset env = lane closed.
 */
function laneOpenFor(tenant: string | null | undefined): boolean {
  if (!isBridgeConfigured()) return false;
  if (process.env.OSTEXT_IMESSAGE_ENABLED === "off") return false;
  const allowed = process.env.OSTEXT_IMESSAGE_TENANT?.trim().toLowerCase();
  if (!allowed) return false;
  if (allowed === "*") return true;
  return (tenant ?? "").trim().toLowerCase() === allowed;
}

/**
 * Decide the lane for one send.
 *
 * Fallback posture is asymmetric on purpose: an unreachable or over-budget bridge falls
 * back to Telnyx on "auto" (degrade to the lane that works) but HOLDS on "imessage" (the
 * recruiter asked for blue bubbles specifically; quietly sending green would corrupt the
 * very comparison this feature exists to produce).
 */
export async function resolveLane(campaign: Campaign, contact: Contact): Promise<LaneDecision> {
  const channel = campaign.channel ?? "sms";
  if (channel === "sms") return { lane: "telnyx", reason: "campaign channel is SMS" };

  const holdOrFallback = (reason: string): LaneDecision =>
    channel === "imessage" ? { lane: "hold", reason } : { lane: "telnyx", reason };

  if (!laneOpenFor(campaign.tenant)) {
    return holdOrFallback("iMessage lane is closed (bridge not configured, or tenant not opted in)");
  }

  const to = normalizePhone(contact.phone);
  if (!to) return holdOrFallback(`unroutable number for the bridge: ${contact.phone}`);

  // Does this handle have iMessage? `null` means the Mac could not answer, which is NOT a
  // fact about the number: availability checks have documented false negatives, and an
  // AppleScript send to a non-iMessage handle fails slowly. Unknowns ride Telnyx unless
  // policy explicitly opts them in.
  const available = await checkIMessageAvailability(to).catch(() => null);
  const routeUnknown = process.env.OSTEXT_IMESSAGE_ROUTE_UNKNOWN === "1";
  if (available === false) {
    return channel === "imessage"
      ? { lane: "hold", reason: "no iMessage on this number" }
      : { lane: "telnyx", reason: "auto: number has no iMessage" };
  }
  if (available === null && !routeUnknown) {
    return holdOrFallback("iMessage capability unknown for this number");
  }

  // The warm-up ledger. Hard per-line ceilings under a two-to-three week ramp; replies to
  // already-engaged contacts are exempt because they are conversation, not fanout.
  const gate = await imessageSendAllowed(to);
  if (!gate.allowed) return holdOrFallback(`iMessage budget: ${gate.reason}`);

  return {
    lane: "imessage",
    reason: available === true ? "handle has iMessage" : "unknown handle, routed by policy",
  };
}

// ---------------------------------------------------------------------------
// Sending on the bridge
// ---------------------------------------------------------------------------

export type BridgeSendOutcome =
  | { ok: true; guid: string; text: string; uncertain: boolean }
  // `definite: true` means the bridge is certain nothing was delivered, so the caller may
  // safely fall back to Telnyx. Anything ambiguous never reports definite.
  | { ok: false; error: string; definite: boolean };

/**
 * Send one message through our Mac.
 *
 * THE DOUBLE-TEXT GUARD IS THE POINT OF THIS FUNCTION. BlueBubbles is known to hand
 * Messages.app a send and THEN time out, so a timeout does not mean "not delivered". A
 * definite failure may fall back to Telnyx; an ambiguous one never does. The row persists
 * as status 'uncertain' and `reconcileUncertainSends` settles it later. Falling back on a
 * timeout is exactly how a candidate receives the same message twice, once blue and once
 * green.
 *
 * The opt-out footer is applied HERE, at this lane's chokepoint, mirroring `sendSms`. Only
 * `internal: true` (alerts to our own recruiters) skips it.
 */
export async function sendOnBridge(args: {
  to: string;
  body: string;
  internal?: boolean;
}): Promise<BridgeSendOutcome> {
  const to = normalizePhone(args.to);
  if (!to) return { ok: false, error: `unroutable number: ${args.to}`, definite: true };

  const text = args.internal ? args.body : withOptOut(args.body);
  const tempGuid = `ros-${crypto.randomUUID()}`;

  try {
    const sent = await sendBridgeText(to, text, tempGuid);
    return { ok: true, guid: sent.guid ?? tempGuid, text, uncertain: false };
  } catch (err) {
    if (isAmbiguousBridgeError(err)) {
      // One immediate reconcile attempt; if that cannot confirm, hold as uncertain.
      const rec = await reconcileSend(tempGuid).catch(() => ({ found: false as const }));
      if (rec.found && rec.guid) return { ok: true, guid: rec.guid, text, uncertain: false };
      console.warn(`[imessage] ambiguous send (timeout) to ${to}; holding as uncertain, NOT retrying on Telnyx`);
      return { ok: true, guid: tempGuid, text, uncertain: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, definite: true };
  }
}

const UNCERTAIN_GIVE_UP_MS = 30 * 60 * 1000;

/**
 * Resolve 'uncertain' iMessage sends (clock sweep; a no-op without the bridge).
 *
 * Confirmed on the Mac -> 'sent' with the real GUID. Still unconfirmed after 30 minutes ->
 * 'failed', with a human-readable reason IN THE THREAD so a recruiter resends deliberately.
 * NEVER auto-resends: a late iMessage plus an automatic Telnyx copy is the double-text this
 * whole design exists to prevent.
 */
export async function reconcileUncertainSends(): Promise<{ checked: number; confirmed: number; failed: number }> {
  if (!isBridgeConfigured()) return { checked: 0, confirmed: 0, failed: 0 };
  const rows = await db
    .select({ id: messages.id, guid: messages.blueBubblesGuid, createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.status, "uncertain"), eq(messages.provider, "imessage")))
    .limit(25);

  let confirmed = 0;
  let failed = 0;
  for (const row of rows) {
    const rec = row.guid
      ? await reconcileSend(row.guid).catch(() => ({ found: false as const }))
      : { found: false as const };
    if (rec.found && rec.guid) {
      await db
        .update(messages)
        .set({ status: "sent", blueBubblesGuid: rec.guid, error: null })
        .where(eq(messages.id, row.id));
      confirmed++;
    } else if (row.createdAt.getTime() < Date.now() - UNCERTAIN_GIVE_UP_MS) {
      await db
        .update(messages)
        .set({
          status: "failed",
          error:
            "iMessage could not be confirmed on the Mac bridge. Not retried automatically (double-text guard) - resend from this thread if the candidate never received it.",
        })
        .where(and(eq(messages.id, row.id), lt(messages.createdAt, new Date(Date.now() - UNCERTAIN_GIVE_UP_MS))));
      failed++;
    }
  }
  return { checked: rows.length, confirmed, failed };
}

// ---------------------------------------------------------------------------
// Lane health: is our own Apple line still behaving?
// ---------------------------------------------------------------------------

/**
 * Apple does not filter on content the way carriers do - it acts on BEHAVIOR: an Apple ID
 * that fans out to many strangers fast, with few real conversations back, gets rate-limited
 * and eventually flagged. Spintax does nothing against that. The warm-up ramp and this
 * check are what do.
 *
 * We own the Mac, so there is no vendor webhook to tell us we have been throttled. The
 * observable signals are ours: a burst of send failures, or sustained sending with nobody
 * answering. Either means stop and look before the Apple ID is the thing that breaks.
 */
export interface LaneHealth {
  sent: number;
  replies: number;
  failures: number;
  replyRate: number;
  failureRate: number;
  healthy: boolean;
  note: string;
}

const HEALTH_WINDOW_HOURS = Number(process.env.OSTEXT_IMESSAGE_HEALTH_WINDOW_HOURS ?? "72") || 72;
const MIN_REPLY_RATE = Number(process.env.OSTEXT_IMESSAGE_MIN_REPLY_RATE ?? "0.02") || 0.02;
const MAX_FAILURE_RATE = Number(process.env.OSTEXT_IMESSAGE_MAX_FAILURE_RATE ?? "0.25") || 0.25;
const MIN_SAMPLE = Number(process.env.OSTEXT_IMESSAGE_HEALTH_MIN_SAMPLE ?? "100") || 100;

export async function laneHealth(): Promise<LaneHealth> {
  const since = new Date(Date.now() - HEALTH_WINDOW_HOURS * 3_600_000).toISOString();
  const result = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE m.direction = 'outbound')::int AS sent,
      count(*) FILTER (WHERE m.direction = 'outbound' AND m.status = 'failed')::int AS failures,
      count(*) FILTER (WHERE m.direction = 'inbound'
                       AND m.classification IS DISTINCT FROM 'stop')::int AS replies
    FROM messages m
    WHERE m.provider = 'imessage' AND m.created_at > ${since}
  `)) as { rows?: Record<string, unknown>[] };
  const r = (result.rows ?? [])[0] ?? {};

  const sent = Number(r.sent ?? 0) || 0;
  const replies = Number(r.replies ?? 0) || 0;
  const failures = Number(r.failures ?? 0) || 0;
  const replyRate = sent ? replies / sent : 0;
  const failureRate = sent ? failures / sent : 0;

  if (sent >= MIN_SAMPLE && failureRate > MAX_FAILURE_RATE) {
    return {
      sent,
      replies,
      failures,
      replyRate,
      failureRate,
      healthy: false,
      note: `${Math.round(failureRate * 100)}% of iMessage sends failed over ${sent} attempts - the Apple line is likely throttled`,
    };
  }
  if (sent >= MIN_SAMPLE && replyRate < MIN_REPLY_RATE) {
    return {
      sent,
      replies,
      failures,
      replyRate,
      failureRate,
      healthy: false,
      note: `${(replyRate * 100).toFixed(1)}% reply rate over ${sent} sends - below the ${(MIN_REPLY_RATE * 100).toFixed(0)}% floor`,
    };
  }
  return { sent, replies, failures, replyRate, failureRate, healthy: true, note: "healthy" };
}

// ---------------------------------------------------------------------------
// Replying into an existing thread
// ---------------------------------------------------------------------------

/**
 * Which lane an existing conversation is already running on.
 *
 * CONTINUITY BEATS POLICY. A reply goes back out on the wire the thread is already on,
 * regardless of what the campaign's channel says today. Answer a blue thread over SMS and
 * the candidate's phone splits it into two conversations - one blue, one green, the same
 * recruiter in both - which is both confusing and the single most bot-looking thing we
 * could do. So the campaign setting decides how a conversation STARTS; this decides how it
 * continues.
 *
 * Reads the most recent OUTBOUND message, because that is the wire the candidate has been
 * answering. Falls back to inbound (a thread we only ever received on), then to Telnyx.
 */
export async function threadLane(conversationId: string): Promise<Lane> {
  const [last] = await db
    .select({ provider: messages.provider })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (last) return last.provider;

  const [inbound] = await db
    .select({ provider: messages.provider })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return inbound?.provider ?? "telnyx";
}

export type ThreadReplyResult =
  | { ok: true; lane: Lane; providerId: string; text: string; uncertain: boolean }
  | { ok: false; error: string };

/**
 * Send a reply into an existing thread on that thread's own lane.
 *
 * Shared by the portal's manual reply box and the delayed AI auto-replies, so both obey the
 * same continuity rule and neither can accidentally split a conversation.
 *
 * DELIBERATELY NO SILENT FALLBACK. If the thread is blue and the Mac is unreachable, this
 * FAILS rather than quietly sending green. The recruiter is sitting right there and can
 * decide; and the natural workaround is a good one - texting the candidate from the iPhone
 * directly still lands in this thread, because the bridge webhook mirrors our own outbound
 * messages back into the portal. A split thread, by contrast, cannot be undone.
 */
export async function replyOnThreadLane(args: {
  conversationId: string;
  to: string;
  body: string;
  // Telnyx-side options, ignored on the iMessage lane.
  from?: string;
  telnyxCreds?: { apiKey: string; messagingProfileId?: string };
}): Promise<ThreadReplyResult> {
  const lane = await threadLane(args.conversationId);

  if (lane === "imessage") {
    if (!isBridgeConfigured()) {
      return {
        ok: false,
        error:
          "This thread is on iMessage but the Mac bridge is not configured, so replying here would arrive as a separate SMS thread. Text the candidate from the iPhone instead - it will appear here automatically.",
      };
    }
    const r = await sendOnBridge({ to: args.to, body: args.body });
    if (!r.ok) {
      return {
        ok: false,
        error: `The Mac bridge could not send this reply (${r.error}). Nothing was sent on SMS, because that would split the candidate's thread. Text them from the iPhone and it will appear here.`,
      };
    }
    return { ok: true, lane: "imessage", providerId: r.guid, text: r.text, uncertain: r.uncertain };
  }

  const t = await sendTelnyxForReply(args);
  return t;
}

/** Telnyx half of `replyOnThreadLane`, split out only to keep that function readable. */
async function sendTelnyxForReply(args: {
  to: string;
  body: string;
  from?: string;
  telnyxCreds?: { apiKey: string; messagingProfileId?: string };
}): Promise<ThreadReplyResult> {
  const { sendSms } = await import("./telnyx");
  const r = await sendSms({ to: args.to, body: args.body, from: args.from, creds: args.telnyxCreds });
  return r.ok
    ? { ok: true, lane: "telnyx", providerId: r.telnyxId, text: r.text, uncertain: false }
    : { ok: false, error: r.error };
}
