import { Client, Receiver } from "@upstash/qstash";
import { db } from "@/db/client";
import { scheduledMessages } from "@/db/schema";

function qstashClient(): Client {
  return new Client({
    token: process.env.QSTASH_TOKEN!,
    ...(process.env.QSTASH_URL ? { baseUrl: process.env.QSTASH_URL } : {}),
  });
}

/** Verify an incoming QStash callback signature. */
export async function verifyQStashSignature(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey || !signature) return false;
  try {
    const receiver = new Receiver({ currentSigningKey, nextSigningKey });
    return await receiver.verify({ signature, body: rawBody });
  } catch {
    return false;
  }
}

/** Enqueue (or re-enqueue) a campaign drain pass via QStash. */
export async function enqueueCampaignDrain(campaignId: string, delaySeconds: number): Promise<void> {
  await qstashClient().publishJSON({
    url: `${publicBaseUrl()}/api/qstash/campaign-drain`,
    body: { campaignId },
    delay: delaySeconds,
  });
}

/** Enqueue (or re-enqueue) a number-validation drain pass via QStash. */
export async function enqueueValidationDrain(campaignId: string, delaySeconds: number): Promise<void> {
  await qstashClient().publishJSON({
    url: `${publicBaseUrl()}/api/qstash/validate-drain`,
    body: { campaignId },
    delay: delaySeconds,
  });
}

function randInt(minInclusive: number, maxInclusive: number): number {
  return Math.floor(Math.random() * (maxInclusive - minInclusive + 1)) + minInclusive;
}

/**
 * Human-like delay before an auto-reply goes out, in seconds.
 * First reply to a candidate: 3–5 minutes. Subsequent replies: 2–6 minutes.
 */
export function replyDelaySeconds(isFirstResponse: boolean): number {
  return isFirstResponse ? randInt(180, 300) : randInt(120, 360);
}

export function isQStashConfigured(): boolean {
  return !!process.env.QSTASH_TOKEN;
}

function publicBaseUrl(): string {
  return (
    process.env.PUBLIC_APP_URL ??
    process.env.AUTH_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

/**
 * Persist a scheduled outbound reply and ask QStash to call our dispatch
 * endpoint after `delaySeconds`. Returns the scheduled row id.
 */
export async function scheduleReply(args: {
  conversationId: string;
  body: string;
  delaySeconds: number;
}): Promise<string> {
  const sendAt = new Date(Date.now() + args.delaySeconds * 1000);
  const [row] = await db
    .insert(scheduledMessages)
    .values({
      conversationId: args.conversationId,
      body: args.body,
      sendAt,
      status: "pending",
    })
    .returning({ id: scheduledMessages.id });

  await qstashClient().publishJSON({
    url: `${publicBaseUrl()}/api/qstash/dispatch`,
    body: { scheduledMessageId: row.id },
    delay: args.delaySeconds,
  });

  return row.id;
}
