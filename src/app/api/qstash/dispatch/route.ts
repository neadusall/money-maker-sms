import { NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  scheduledMessages,
  conversations,
  contacts,
  campaigns,
  messages,
} from "@/db/schema";
import { sendSms } from "@/lib/telnyx";
import { paceForNextSend } from "@/lib/pacing";

async function verify(rawBody: string, signature: string | null): Promise<boolean> {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    console.warn("[qstash-dispatch] signing keys not configured");
    return false;
  }
  if (!signature) return false;
  try {
    const receiver = new Receiver({ currentSigningKey, nextSigningKey });
    return await receiver.verify({ signature, body: rawBody });
  } catch (err) {
    console.warn("[qstash-dispatch] signature verification failed:", err);
    return false;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const ok = await verify(rawBody, request.headers.get("upstash-signature"));
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let scheduledMessageId: string | undefined;
  try {
    scheduledMessageId = JSON.parse(rawBody).scheduledMessageId;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!scheduledMessageId) {
    return NextResponse.json({ error: "missing scheduledMessageId" }, { status: 400 });
  }

  const [scheduled] = await db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.id, scheduledMessageId));

  if (!scheduled) {
    return NextResponse.json({ ok: true, note: "not found" });
  }
  if (scheduled.status !== "pending") {
    return NextResponse.json({ ok: true, note: `already ${scheduled.status}` });
  }

  const [convo] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, scheduled.conversationId));
  if (!convo) {
    await db.update(scheduledMessages).set({ status: "canceled", error: "conversation gone" }).where(eq(scheduledMessages.id, scheduled.id));
    return NextResponse.json({ ok: true, note: "conversation gone" });
  }

  // If the recruiter has taken over this conversation, do not auto-send.
  if (convo.humanTakeover) {
    await db
      .update(scheduledMessages)
      .set({ status: "canceled", error: "human takeover" })
      .where(eq(scheduledMessages.id, scheduled.id));
    return NextResponse.json({ ok: true, note: "human takeover; canceled" });
  }

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, convo.contactId));
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, convo.campaignId));

  if (!contact || contact.optedOut) {
    await db
      .update(scheduledMessages)
      .set({ status: "canceled", error: "contact opted out or missing" })
      .where(eq(scheduledMessages.id, scheduled.id));
    return NextResponse.json({ ok: true, note: "opted out" });
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
    return NextResponse.json({ error: result.error }, { status: 500 });
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

  return NextResponse.json({ ok: true });
}
