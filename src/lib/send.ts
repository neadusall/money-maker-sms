import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, conversations, messages, suppressedNumbers, type Campaign, type Contact } from "@/db/schema";
import { renderTemplate, findUnmergedTokens } from "./merge";
import { sendSms } from "./telnyx";
import { paceForNextSend } from "./pacing";
import { isAlwaysAllowed } from "./always-allow";

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
