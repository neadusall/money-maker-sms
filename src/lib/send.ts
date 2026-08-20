import { and, eq, ne, or, isNull, inArray, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, conversations, messages, suppressedNumbers, type Campaign, type Contact } from "@/db/schema";
import { renderTemplate, findUnmergedTokens } from "./merge";
import { sendSms } from "./telnyx";
import { telnyxCredsForTenant } from "./tenant-telnyx";
import { resolveLane, sendOnBridge } from "./lane";
import { expandSpintax } from "./spintax";
import { paceForNextSend } from "./pacing";
import { isAlwaysAllowed } from "./always-allow";

/**
 * The cross-campaign fail-safe. Answers: "has ANY other campaign already texted
 * (or been told to stop by) this phone number?" Every successful send writes a
 * suppressedNumbers row (reason "sent"), and opt-outs write "opted_out"/"messaged",
 * so this ledger is the single source of truth for "already contacted."
 *
 * This is what makes overlapping lists safe: activate the combined list AND its
 * subsets and no human is ever texted twice — whichever campaign reaches a number
 * first wins, and every other campaign skips it here, before a message is sent.
 *
 * Race note: prod runs the sequential internal clock (one send at a time across
 * all campaigns), so this read and the post-send suppression insert are effectively
 * atomic. Always-allow numbers (e.g. your own test line) are never blocked.
 *
 * Cooldown: OSTEXT_RECONTACT_COOLDOWN_DAYS > 0 limits the block to a window (so a
 * number may be re-contacted for a different role after N days); unset/0 = never
 * text the same number twice across campaigns. OSTEXT_CROSS_CAMPAIGN_GUARD=off
 * disables the guard entirely (not recommended).
 */
export async function alreadyContactedElsewhere(
  campaignId: string,
  phone: string,
): Promise<{ blocked: boolean; byCampaignId?: string }> {
  if (process.env.OSTEXT_CROSS_CAMPAIGN_GUARD === "off") return { blocked: false };
  if (isAlwaysAllowed(phone)) return { blocked: false };
  const cooldownDays = Number(process.env.OSTEXT_RECONTACT_COOLDOWN_DAYS) || 0;
  const conds = [
    eq(suppressedNumbers.phone, phone),
    // A NULL campaignId is a row whose writing campaign was deleted — that prior
    // contact still counts (SQL `ne` alone silently drops NULL rows).
    or(isNull(suppressedNumbers.campaignId), ne(suppressedNumbers.campaignId, campaignId))!,
    inArray(suppressedNumbers.reason, ["sent", "messaged", "opted_out"]),
  ];
  if (cooldownDays > 0) {
    // The cooldown only ever re-opens "sent"/"messaged" numbers. An opt-out is
    // a legal instruction, not a pacing rule: reason 'opted_out' blocks forever
    // no matter how old the row is.
    conds.push(
      or(
        eq(suppressedNumbers.reason, "opted_out"),
        gte(suppressedNumbers.createdAt, new Date(Date.now() - cooldownDays * 86_400_000)),
      )!,
    );
  }
  const [prior] = await db
    .select({ campaignId: suppressedNumbers.campaignId })
    .from(suppressedNumbers)
    .where(and(...conds))
    .limit(1);
  return prior ? { blocked: true, byCampaignId: prior.campaignId ?? undefined } : { blocked: false };
}

/** Archive a contact that the cross-campaign guard blocked: soft-delete (so it
 *  leaves the sendable pool and the active list, recoverable in Archived) with a
 *  plain-English reason. Never sends, never double-texts. */
async function archiveAsDuplicate(contactId: string): Promise<void> {
  await db
    .update(contacts)
    .set({ deletedAt: new Date(), lastError: "Skipped: this number was already texted by another campaign (duplicate guard)" })
    .where(eq(contacts.id, contactId));
}

export async function getOrCreateConversation(campaignId: string, contactId: string) {
  const existing = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.campaignId, campaignId), eq(conversations.contactId, contactId)))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(conversations)
    .values({ campaignId, contactId })
    .returning();
  return created;
}

/**
 * Render the campaign template for one contact and send it via Telnyx,
 * recording the outbound message and updating the contact's status.
 * Shared by the manual "send batch" action and the QStash drain.
 */
export async function processContactSend(
  campaign: Campaign,
  contact: Contact,
): Promise<"sent" | "failed" | "skipped"> {
  // CROSS-CAMPAIGN FAIL-SAFE (first, before we claim or send): never text a
  // number another campaign already texted. Archives the duplicate so it leaves
  // this campaign's sendable pool and shows in Archived with the reason.
  const dup = await alreadyContactedElsewhere(campaign.id, contact.phone);
  if (dup.blocked) {
    await archiveAsDuplicate(contact.id);
    return "skipped";
  }

  // Atomically CLAIM this contact before doing anything else: flip pending->queued
  // only if it's still pending. If another concurrent pass already claimed it,
  // this returns 0 rows and we skip — so a contact can never be sent twice even
  // if the drain runs in parallel or Send is clicked multiple times.
  const claimed = await db
    .update(contacts)
    .set({ status: "queued" })
    .where(and(eq(contacts.id, contact.id), eq(contacts.status, "pending")))
    .returning({ id: contacts.id });
  if (claimed.length === 0) return "skipped";

  // SPINTAX FIRST, merge fields second. `expandSpintax` protects `{{token}}` during
  // expansion, so a merge field can live inside a spin branch; running the merge first
  // would instead let a candidate's company name containing a brace corrupt the spin parse.
  // The seed is the contact id: the same person always renders the same wording, so a
  // retry after a network blip cannot deliver a second, differently-worded copy.
  const spun = expandSpintax(campaign.smsTemplate, contact.id);
  const body = renderTemplate(spun, contact);
  // Check the SPUN template, not the raw one: a token that only appears in an unchosen
  // branch is not actually missing from this recipient's message.
  const missing = findUnmergedTokens(spun, contact);
  if (missing.length > 0) {
    await db
      .update(contacts)
      .set({ status: "failed", lastError: `missing merge fields: ${missing.join(", ")}` })
      .where(eq(contacts.id, contact.id));
    return "skipped";
  }

  // Which lane carries this one. `resolveLane` is the ONLY place that knows both providers
  // exist; everything below just does what it says.
  const decision = await resolveLane(campaign, contact);
  if (decision.lane === "hold") {
    // Release the claim so a later sweep retries. Deliberately NOT "failed": the contact is
    // fine, our bridge or its config is not, and burning a candidate over that is
    // unacceptable. A sleeping Mac must cost us a delay, never a lead.
    await db
      .update(contacts)
      .set({ status: "pending", lastError: `Holding: ${decision.reason}` })
      .where(eq(contacts.id, contact.id));
    return "skipped";
  }

  await paceForNextSend();

  // Both lanes are normalized to the same shape here so everything below is lane-agnostic.
  let outcome:
    | { ok: true; lane: "telnyx" | "imessage"; providerId: string; text: string; uncertain: boolean }
    | { ok: false; error: string };

  if (decision.lane === "imessage") {
    const r = await sendOnBridge({ to: contact.phone, body });
    if (r.ok) {
      outcome = { ok: true, lane: "imessage", providerId: r.guid, text: r.text, uncertain: r.uncertain };
    } else if (r.definite && campaign.channel === "auto") {
      // The bridge is CERTAIN nothing was delivered, and this campaign allows the green
      // lane, so the same call falls through to Telnyx rather than costing us the contact.
      // Only ever on a definite failure: an ambiguous one returns ok+uncertain above and
      // never reaches here, which is what stops a candidate being texted twice.
      console.warn(`[imessage] definite send failure (${r.error}); falling back to Telnyx`);
      const t = await sendSms({
        to: contact.phone,
        body,
        from: campaign.fromNumber ?? undefined,
        creds: telnyxCredsForTenant(campaign.tenant),
      });
      outcome = t.ok
        ? { ok: true, lane: "telnyx", providerId: t.telnyxId, text: t.text, uncertain: false }
        : { ok: false, error: t.error };
    } else {
      outcome = { ok: false, error: r.error };
    }
  } else {
    const t = await sendSms({
      to: contact.phone,
      body,
      from: campaign.fromNumber ?? undefined,
      creds: telnyxCredsForTenant(campaign.tenant),
    });
    outcome = t.ok
      ? { ok: true, lane: "telnyx", providerId: t.telnyxId, text: t.text, uncertain: false }
      : { ok: false, error: t.error };
  }

  if (!outcome.ok) {
    await db
      .update(contacts)
      .set({ status: "failed", lastError: outcome.error })
      .where(eq(contacts.id, contact.id));
    return "failed";
  }

  const convo = await getOrCreateConversation(campaign.id, contact.id);
  await db.insert(messages).values({
    conversationId: convo.id,
    direction: "outbound",
    // 'uncertain' means the bridge timed out after Messages.app may already have sent.
    // The reconcile sweep settles it; nothing resends in the meantime.
    status: outcome.uncertain ? "uncertain" : "sent",
    // What the provider actually delivered, opt-out footer included - not the
    // pre-footer render. The thread and any compliance export then show the
    // recipient's real message.
    body: outcome.text,
    provider: outcome.lane,
    ...(outcome.lane === "imessage"
      ? { blueBubblesGuid: outcome.providerId }
      : { telnyxId: outcome.providerId }),
  });
  await db.update(contacts).set({ status: "sent", lastError: null }).where(eq(contacts.id, contact.id));
  await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, convo.id));

  // Remember we've messaged this number so future uploads to this campaign skip it
  // — unless it's an always-allow number, which should keep receiving every campaign.
  if (!isAlwaysAllowed(contact.phone)) {
    await db
      .insert(suppressedNumbers)
      .values({ campaignId: campaign.id, phone: contact.phone, reason: "sent" })
      .onConflictDoNothing({ target: [suppressedNumbers.campaignId, suppressedNumbers.phone] });
  }

  return "sent";
}
