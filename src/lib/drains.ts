import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts, conversations, messages, scheduledMessages } from "@/db/schema";
import { lookupLineType, sendSms } from "./telnyx";
import { isAlwaysAllowed } from "./always-allow";
import { recordPhoneCheck, latestPhoneVerdicts } from "./phone-accuracy";
import { processContactSend } from "./send";
import { isWithinSendWindow } from "./send-window";
import { scoreCandidatesBatch } from "./qualify";
import { ensureRubric } from "./rubric";
import { regionForLocation } from "./region";
import { paceForNextSend } from "./pacing";

/**
 * The three drain passes, one batch per call: number validation, fit scoring,
 * and campaign sending. Extracted from the QStash route handlers so BOTH clocks
 * can drive them: the QStash HTTP callbacks (routes add signature verification
 * and self-re-enqueue) and the in-process internal clock (internal-clock.ts,
 * the self-hosted fallback that just calls again on its next sweep).
 *
 * Nothing here touches revalidatePath — that is request-scoped and would throw
 * from a background interval. The routes revalidate; pages the clock affects
 * are dynamic and self-refresh (AutoRefresh), so they stay live either way.
 */

export const VALIDATE_BATCH = 25;
export const SCORE_BATCH = 20;
export const SEND_BATCH = 20;
// Model for bulk list scoring.
export const BULK_SCORE_MODEL = "claude-sonnet-4-6";

export interface ValidateBatchResult {
  /** Set when the pass refused to run (contacts left untouched as "validating"). */
  held?: "telnyx_key_missing";
  kept: number;
  removed: number;
  remaining: number;
  /** Contacts left as "validating" because Telnyx could not be reached (outage,
   *  rate limit, auth). The next clock tick retries them; they are never
   *  deleted on an outage and never textable while held. */
  heldError?: number;
}

/** One Telnyx line-type validation batch: promote confirmed mobiles
 *  validating -> pending, delete everything else. Fail-closed on a missing key. */
export async function runValidateBatch(campaignId: string): Promise<ValidateBatchResult> {
  // SAFEGUARD: with no Telnyx key every lookup would come back "unknown" and the
  // strict keep-mobiles-only rule below would delete the ENTIRE batch. Refuse to
  // run instead: contacts stay "validating" (never textable) until the key is set.
  if (!process.env.TELNYX_API_KEY) {
    const [{ remaining }] = await db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(contacts)
      .where(and(eq(contacts.campaignId, campaignId), eq(contacts.status, "validating")));
    return { held: "telnyx_key_missing", kept: 0, removed: 0, remaining };
  }

  // Fresh contacts first: rows held back by a Telnyx outage carry a lastError
  // stamp (below) and yield the batch to never-tried numbers, so a few
  // persistently erroring rows can never starve a growing campaign.
  const batch = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.campaignId, campaignId), eq(contacts.status, "validating")))
    .orderBy(sql`${contacts.lastError} IS NOT NULL`, contacts.id)
    .limit(VALIDATE_BATCH);

  // A line-type verdict is a fact about the NUMBER, not the campaign: when the
  // same number was already checked (another campaign, an earlier push), reuse
  // that verdict instead of buying a second Telnyx lookup.
  const cachedVerdicts = await latestPhoneVerdicts(batch.map((c) => c.phone)).catch((err) => {
    console.warn("[validate] verdict cache unavailable, doing live lookups:", err);
    return new Map<string, boolean>();
  });

  let kept = 0;
  let removed = 0;
  let heldError = 0;
  for (const contact of batch) {
    // Never validate-away an always-allow number (e.g. your own).
    if (isAlwaysAllowed(contact.phone)) {
      await db.update(contacts).set({ status: "pending", lastError: null }).where(eq(contacts.id, contact.id));
      kept++;
      continue;
    }
    const cached = cachedVerdicts.get(contact.phone);
    if (cached !== undefined) {
      // Apply the prior verdict without re-recording it: the accuracy ledger
      // counts real Telnyx checks, not replays.
      if (cached) {
        await db.update(contacts).set({ status: "pending", lastError: null }).where(eq(contacts.id, contact.id));
        kept++;
      } else {
        await db.delete(contacts).where(eq(contacts.id, contact.id));
        removed++;
      }
      continue;
    }
    let lineType: string;
    try {
      lineType = await lookupLineType(contact.phone);
    } catch {
      // Telnyx could not be asked (outage, rate limit, auth): NOT a verdict.
      // Leave the contact "validating" (never textable) for the next tick to
      // retry; deleting here would drop real cells on a blip. The lastError
      // stamp pushes this row behind never-tried numbers in later batches.
      // After a few failures assume Telnyx-wide trouble and stop hammering
      // this tick.
      await db
        .update(contacts)
        .set({ lastError: "cell check pending: Telnyx unreachable, will retry" })
        .where(eq(contacts.id, contact.id))
        .catch(() => {});
      heldError++;
      if (heldError >= 3) break;
      continue;
    }
    // Phone-accuracy ledger: a failed number's contact row is deleted below, so
    // the verdict (and the source that supplied the number) is recorded FIRST.
    // Best-effort: bookkeeping must never block validation.
    await recordPhoneCheck({
      campaignId,
      phone: contact.phone,
      phoneSource: contact.customFields?.phone_source ?? null,
      lineType,
      kept: lineType === "mobile",
    }).catch(() => {});
    // Strict: keep ONLY confirmed mobile numbers. Everything else (landline,
    // toll-free, VoIP, or unverifiable) is removed.
    if (lineType === "mobile") {
      await db.update(contacts).set({ status: "pending", lastError: null }).where(eq(contacts.id, contact.id));
      kept++;
    } else {
      await db.delete(contacts).where(eq(contacts.id, contact.id));
      removed++;
    }
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.campaignId, campaignId), eq(contacts.status, "validating")));

  return { kept, removed, remaining, ...(heldError ? { heldError } : {}) };
}

export interface ScoreBatchResult {
  gone?: boolean;
  scored: number;
  failed: number;
  remaining: number;
  creditBlocked: boolean;
}

/** One LLM fit-scoring batch for a campaign's unscored contacts. Also maintains
 *  campaign.scoringError so the UI is honest about why scoring is stalled. */
export async function runScoreBatch(campaignId: string): Promise<ScoreBatchResult> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return { gone: true, scored: 0, failed: 0, remaining: 0, creditBlocked: false };

  // Drive off the SCORE, not enrichment: anything without a fit score still needs
  // work. A failed scoring attempt leaves the score null (below), so it's retried
  // on a later pass instead of being permanently marked done.
  const selector = and(
    eq(contacts.campaignId, campaignId),
    eq(contacts.optedOut, false),
    isNull(contacts.qualificationScore),
  );

  // Without an AI key every scoring call is doomed: don't burn an attempt per
  // clock tick forever, and stamp WHY scoring is stalled so the campaign page
  // stops showing an eternal "scoring..." spinner.
  if (!(process.env.ANTHROPIC_API_KEY || "").trim()) {
    const [{ remaining: rem }] = await db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(contacts)
      .where(selector);
    if (rem > 0 && campaign.scoringError !== "no_key") {
      await db.update(campaigns).set({ scoringError: "no_key" }).where(eq(campaigns.id, campaignId));
    }
    return { scored: 0, failed: 0, remaining: rem, creditBlocked: false };
  }

  const batch = await db.select().from(contacts).where(selector).limit(SCORE_BATCH);

  // Compact rubric (generated once per campaign) keeps each scoring prompt small.
  const rubric = (await ensureRubric(campaign).catch(() => null)) ?? undefined;

  let scored = 0;
  let failed = 0;
  const errors: string[] = [];

  // One LLM call scores the whole batch.
  const scores = await scoreCandidatesBatch({ campaign, contacts: batch, model: BULK_SCORE_MODEL, rubric }).catch((e) => {
    errors.push(e instanceof Error ? e.message : String(e));
    return new Map<string, { score: number; reason: string }>();
  });

  const targets = campaign.targetRegion ? campaign.targetRegion.split(",") : null;
  for (const contact of batch) {
    const s = scores.get(contact.id);
    if (!s) {
      // Omitted/failed this pass → leave NULL so it's retried next pass.
      failed++;
      continue;
    }
    // Modest location nudge (free, local): +3 in target region, -6 if knowably out.
    const locationRegion = regionForLocation(contact.location);
    let locationMatch: boolean | null = null;
    let finalScore = s.score;
    if (targets) {
      locationMatch = locationRegion != null && targets.includes(locationRegion);
      const adj = locationMatch ? 3 : locationRegion != null ? -6 : 0;
      finalScore = Math.max(1, Math.min(100, finalScore + adj));
    }
    await db
      .update(contacts)
      .set({ qualificationScore: finalScore, qualificationReason: s.reason, locationRegion, locationMatch, enrichedAt: new Date() })
      .where(eq(contacts.id, contact.id));
    scored++;
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(contacts)
    .where(selector);

  // Surface a hard billing block to the UI so the banner is honest about why
  // scoring isn't progressing. Cleared as soon as any contact scores.
  const creditBlocked = errors.some((m) => /credit balance|too low|billing|insufficient|payment|quota/i.test(m));
  if (scored > 0) {
    if (campaign.scoringError) {
      await db.update(campaigns).set({ scoringError: null }).where(eq(campaigns.id, campaignId));
    }
  } else if (creditBlocked && campaign.scoringError !== "credit") {
    await db.update(campaigns).set({ scoringError: "credit" }).where(eq(campaigns.id, campaignId));
  }

  return { scored, failed, remaining, creditBlocked };
}

export type SendBatchResult =
  | { state: "gone" }
  | { state: "stopped"; status: string }
  | { state: "unscheduled" }
  | { state: "waiting_schedule"; waitSeconds: number }
  | { state: "waiting_window"; waitSeconds: number }
  | { state: "waiting_scores"; unscored: number }
  | { state: "ran"; sent: number; failed: number; skipped: number; remaining: number };

const clampWait = (ms: number) => Math.min(6 * 3600, Math.max(60, Math.ceil(ms / 1000)));

/** One sending batch for an ACTIVE campaign, honoring every gate: status,
 *  one-time schedule, send window, and the fit-score bar / score-first rule. */
export async function runSendBatch(campaignId: string, limit = SEND_BATCH): Promise<SendBatchResult> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return { state: "gone" };

  // Stop sending if the campaign was paused / set back to draft (e.g. list cleared).
  if (campaign.status !== "active") return { state: "stopped", status: campaign.status };

  // FAIL-SAFE: nothing ever sends without a send date & time a human set inside
  // OS Text (the Schedule field, or the Send button which stamps "now"). No
  // schedule = no sending, no matter how the campaign became active (Activate
  // click, portal push, top-up of an old campaign, background sweeper). Once it
  // has fired on an ACTIVE campaign, that schedule is STANDING APPROVAL (user
  // mandate 2026-07-21): contacts that arrive later (enrichment top-ups, Boost
  // phones) validate, score, and send with the same setup, hands-free. Pause is
  // the off switch; a paused/draft campaign holds everything.
  if (!campaign.scheduledAt) return { state: "unscheduled" };
  if (campaign.scheduledAt.getTime() > Date.now()) {
    return { state: "waiting_schedule", waitSeconds: clampWait(campaign.scheduledAt.getTime() - Date.now()) };
  }

  // Respect the send window — outside it, report when it opens.
  const window = isWithinSendWindow(campaign.sendWindowStart, campaign.sendWindowEnd);
  if (!window.ok) {
    return { state: "waiting_window", waitSeconds: clampWait(window.openAt.getTime() - Date.now()) };
  }

  // Only text contacts meeting the campaign's minimum fit score (if set).
  const minScore = campaign.minScoreToSend;

  // Score-first: when no fit threshold is set, never text contacts that haven't
  // been scored yet — wait for background scoring to finish first. (With a
  // threshold set, unscored contacts are already excluded by the query below.)
  // Late-pushed contacts count here too: a top-up briefly pauses the batch
  // until the scoring drain (same sweep) catches up, then everyone sends.
  if (!minScore) {
    const [{ unscored }] = await db
      .select({ unscored: sql<number>`count(*)::int` })
      .from(contacts)
      .where(
        and(
          eq(contacts.campaignId, campaignId),
          eq(contacts.status, "pending"),
          eq(contacts.optedOut, false),
          sql`${contacts.qualificationScore} is null`,
        ),
      );
    if (unscored > 0) return { state: "waiting_scores", unscored };
  }

  const sendable = and(
    eq(contacts.campaignId, campaignId),
    eq(contacts.status, "pending"),
    eq(contacts.optedOut, false),
    isNull(contacts.deletedAt),
    // No created-at cutoff: the human-set schedule on this ACTIVE campaign is
    // standing approval, so contacts pushed after it (enrichment top-ups, Boost
    // phones) send automatically once cell-validated and scored. Every other
    // gate above (status, schedule set + reached, send window, fit bar) still
    // screens them like the original batch.
    minScore ? sql`${contacts.qualificationScore} >= ${minScore}` : undefined,
  );

  const pending = await db.select().from(contacts).where(sendable).limit(limit);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const contact of pending) {
    try {
      const outcome = await processContactSend(campaign, contact);
      if (outcome === "sent") sent++;
      else if (outcome === "failed") failed++;
      else skipped++;
    } catch (err) {
      console.error(`[send-batch ${campaignId}] send error for ${contact.phone}:`, err);
      failed++;
    }
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(contacts)
    .where(sendable);

  return { state: "ran", sent, failed, skipped, remaining };
}

/**
 * Send one due scheduled reply (the delayed AI auto-replies), honoring every
 * kill switch: human takeover, paused/manual campaign, opt-out, and the
 * 60-second duplicate guard. Extracted from the QStash dispatch route so the
 * internal clock can deliver due replies without QStash.
 */
export async function dispatchScheduledMessage(scheduledMessageId: string): Promise<{ ok: boolean; note?: string; error?: string }> {
  const [scheduled] = await db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.id, scheduledMessageId));

  if (!scheduled) return { ok: true, note: "not found" };
  if (scheduled.status !== "pending") return { ok: true, note: `already ${scheduled.status}` };

  const [convo] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, scheduled.conversationId));
  if (!convo) {
    await db.update(scheduledMessages).set({ status: "canceled", error: "conversation gone" }).where(eq(scheduledMessages.id, scheduled.id));
    return { ok: true, note: "conversation gone" };
  }

  // If the recruiter has taken over this conversation, do not auto-send.
  if (convo.humanTakeover) {
    await db
      .update(scheduledMessages)
      .set({ status: "canceled", error: "human takeover" })
      .where(eq(scheduledMessages.id, scheduled.id));
    return { ok: true, note: "human takeover; canceled" };
  }

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, convo.contactId));
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, convo.campaignId));

  // Hard stop: never auto-send if the campaign is paused or in manual mode. This
  // makes "pause" / "manual" an instant kill switch for queued auto-replies too.
  if (!campaign || campaign.status !== "active" || campaign.llmMode === "manual") {
    await db
      .update(scheduledMessages)
      .set({ status: "canceled", error: "campaign paused or manual" })
      .where(eq(scheduledMessages.id, scheduled.id));
    return { ok: true, note: "campaign paused/manual; canceled" };
  }

  // Don't pile on: if we already sent to this conversation in the last 60s, skip
  // (guards against rapid duplicate auto-replies).
  const [recent] = await db
    .select({ at: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.conversationId, scheduled.conversationId), eq(messages.direction, "outbound")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (recent && Date.now() - new Date(recent.at).getTime() < 60_000) {
    await db
      .update(scheduledMessages)
      .set({ status: "canceled", error: "recent outbound; deduped" })
      .where(eq(scheduledMessages.id, scheduled.id));
    return { ok: true, note: "recent outbound; skipped" };
  }

  if (!contact || contact.optedOut) {
    await db
      .update(scheduledMessages)
      .set({ status: "canceled", error: "contact opted out or missing" })
      .where(eq(scheduledMessages.id, scheduled.id));
    return { ok: true, note: "opted out" };
  }

  await paceForNextSend();
  const result = await sendSms({
    to: contact.phone,
    body: scheduled.body,
    from: campaign?.fromNumber ?? undefined,
  });

  if (!result.ok) {
    await db
      .update(scheduledMessages)
      .set({ status: "failed", error: result.error })
      .where(eq(scheduledMessages.id, scheduled.id));
    return { ok: false, error: result.error };
  }

  await db.insert(messages).values({
    conversationId: scheduled.conversationId,
    direction: "outbound",
    status: "sent",
    body: scheduled.body,
    telnyxId: result.telnyxId,
  });
  // Do NOT clear the conversation flag when the AI auto-replies. The recruiter
  // must personally lay eyes on every thread before it leaves "Needs attention";
  // status is downgraded only when they open it (see markConversationRead).
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, scheduled.conversationId));
  await db
    .update(scheduledMessages)
    .set({ status: "sent" })
    .where(eq(scheduledMessages.id, scheduled.id));

  return { ok: true };
}
