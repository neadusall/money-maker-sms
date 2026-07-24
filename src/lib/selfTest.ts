import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts, conversations, messages } from "@/db/schema";
import { sendSms } from "@/lib/telnyx";
import { normalizePhone } from "@/lib/phone";

/**
 * Two-way SMS self-test.
 *
 * Sends a real text through the SAME send path recruiters use, records it so the
 * Telnyx delivery-receipt webhook updates its status, and then watches for an
 * inbound reply arriving through the SAME inbound webhook + recordInbound path.
 * This confirms, end to end and per sending number:
 *   1. we can send            (Telnyx accepts the message, we get an id)
 *   2. Telnyx confirms sending (a delivery receipt comes back -> "delivered")
 *   3. two-way works          (the reply is received and lands in the inbox)
 *
 * All test traffic is parked in one dedicated "OS Text self-test" campaign so it
 * never mixes with real recruiting campaigns.
 */

const SELF_TEST_CAMPAIGN_NAME = "OS Text self-test";

async function getOrCreateSelfTestCampaign() {
  const [existing] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.name, SELF_TEST_CAMPAIGN_NAME))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(campaigns)
    .values({
      name: SELF_TEST_CAMPAIGN_NAME,
      status: "active",
      smsTemplate: "OS Text self-test. Reply YES to confirm two-way texting works.",
    })
    .returning();
  return created;
}

async function getOrCreateConversation(campaignId: string, contactId: string) {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.campaignId, campaignId), eq(conversations.contactId, contactId)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(conversations).values({ campaignId, contactId }).returning();
  return created;
}

export type RunResult =
  | { ok: true; conversationId: string; messageId: string; telnyxId: string; to: string; from: string | null; sentAt: string }
  | { ok: false; error: string; conversationId?: string };

export async function runSelfTest(opts: { to: string; fromNumber?: string; recruiter?: string }): Promise<RunResult> {
  const to = normalizePhone(opts.to);
  if (!to) return { ok: false, error: "Enter a valid phone number, e.g. +15125550123." };

  const campaign = await getOrCreateSelfTestCampaign();

  let [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.campaignId, campaign.id), eq(contacts.phone, to)))
    .limit(1);
  if (!contact) {
    [contact] = await db
      .insert(contacts)
      .values({ campaignId: campaign.id, phone: to, firstName: "Self-test", status: "pending" })
      .returning();
  }

  const convo = await getOrCreateConversation(campaign.id, contact.id);
  const sentAt = new Date();
  const from = (opts.fromNumber && opts.fromNumber.trim()) || undefined;
  const body = `OS Text self-test${opts.recruiter ? ` from ${opts.recruiter}` : ""}. Reply YES to confirm two-way texting works.`;

  const res = await sendSms({ to, body, from });
  if (!res.ok) {
    return { ok: false, error: res.error, conversationId: convo.id };
  }

  const [msg] = await db
    .insert(messages)
    .values({ conversationId: convo.id, direction: "outbound", status: "sent", body, telnyxId: res.telnyxId })
    .returning();

  return {
    ok: true,
    conversationId: convo.id,
    messageId: msg.id,
    telnyxId: res.telnyxId,
    to,
    from: from ?? null,
    sentAt: sentAt.toISOString(),
  };
}

export type SelfTestStatus = {
  sent: boolean; // Telnyx accepted (we hold a telnyx id)
  outboundStatus: string | null; // queued | sending | sent | delivered | failed
  delivered: boolean; // Telnyx confirmed delivery via receipt
  failed: boolean;
  error: string | null;
  replyReceived: boolean; // an inbound reply arrived after we sent
  replyBody: string | null;
  replyAt: string | null;
};

export async function getSelfTestStatus(conversationId: string, sinceIso: string): Promise<SelfTestStatus> {
  const [out] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound")))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const since = new Date(sinceIso);
  const [inb] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "inbound"), gt(messages.createdAt, since)))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const status = out?.status ?? null;
  return {
    sent: !!out?.telnyxId,
    outboundStatus: status,
    delivered: status === "delivered",
    failed: status === "failed",
    error: out?.error ?? null,
    replyReceived: !!inb,
    replyBody: inb?.body ?? null,
    replyAt: inb ? new Date(inb.createdAt).toISOString() : null,
  };
}
