import { and, eq, ne, inArray, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, conversations, messages, suppressedNumbers, type Campaign, type Contact } from "@/db/schema";
import { renderTemplate, findUnmergedTokens } from "./merge";
import { sendSms } from "./telnyx";
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
    ne(suppressedNumbers.campaignId, campaignId),
    inArray(suppressedNumbers.reason, ["sent", "messaged", "opted_out"]),
  ];
  if (cooldownDays > 0) {
    conds.push(gte(suppressedNumbers.createdAt, new Date(Date.now() - cooldownDays * 86_400_000)));
  }
  const [prior] = await db
    .select({ campaignId: suppressedNumbers.campaignId })
    .from(suppressedNumbers)
    .where(and(...conds))
    .limit(1);
  return prior ? { blocked: true, byCampaignId: prior.campaignId } : { blocked: false };
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

  const body = renderTemplate(campaign.smsTemplate, contact);
  const missing = findUnmergedTokens(campaign.smsTemplate, contact);
  if (missing.length > 0) {
    await db
      .update(contacts)
      .set({ status: "failed", lastError: `missing merge fields: ${missing.join(", ")}` })
      .where(eq(contacts.id, contact.id));
    return "skipped";
  }

  await paceForNextSend();
  const result = await sendSms({ to: contact.phone, body, from: campaign.fromNumber ?? undefined });

  if (!result.ok) {
    await db
      .update(contacts)
      .set({ status: "failed", lastError: result.error })
      .where(eq(contacts.id, contact.id));
    return "failed";
  }

  const convo = await getOrCreateConversation(campaign.id, contact.id);
  await db.insert(messages).values({
    conversationId: convo.id,
    direction: "outbound",
    status: "sent",
    body,
    telnyxId: result.telnyxId,
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
