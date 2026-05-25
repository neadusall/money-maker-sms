import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts } from "@/db/schema";
import { processContactSend } from "@/lib/send";
import { verifyQStashSignature, enqueueCampaignDrain } from "@/lib/schedule";
import { isWithinSendWindow } from "@/lib/send-window";

export const maxDuration = 60;

const DRAIN_BATCH = 20;

export async function POST(request: Request) {
  const rawBody = await request.text();
  const ok = await verifyQStashSignature(rawBody, request.headers.get("upstash-signature"));
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let campaignId: string | undefined;
  try {
    campaignId = JSON.parse(rawBody).campaignId;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!campaignId) {
    return NextResponse.json({ error: "missing campaignId" }, { status: 400 });
  }

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) {
    return NextResponse.json({ ok: true, note: "campaign gone" });
  }

  // Stop sending if the campaign was paused / set back to draft (e.g. list cleared).
  if (campaign.status !== "active") {
    console.log(`[campaign-drain ${campaignId}] campaign is ${campaign.status}; stopping`);
    return NextResponse.json({ ok: true, note: `campaign ${campaign.status}; stopped` });
  }

  // Respect the send window — if we're outside it, re-enqueue for when it opens.
  const window = isWithinSendWindow(campaign.sendWindowStart, campaign.sendWindowEnd);
  if (!window.ok) {
    const secs = Math.min(6 * 3600, Math.max(60, Math.ceil((window.openAt.getTime() - Date.now()) / 1000)));
    await enqueueCampaignDrain(campaignId, secs);
    return NextResponse.json({ ok: true, note: "outside send window; re-enqueued", retryInSeconds: secs });
  }

  // Only text contacts meeting the campaign's minimum fit score (if set).
  const minScore = campaign.minScoreToSend;
  const sendable = and(
    eq(contacts.campaignId, campaignId),
    eq(contacts.status, "pending"),
    eq(contacts.optedOut, false),
    minScore ? sql`${contacts.qualificationScore} >= ${minScore}` : undefined,
  );

  const pending = await db.select().from(contacts).where(sendable).limit(DRAIN_BATCH);

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
      console.error(`[campaign-drain ${campaignId}] send error for ${contact.phone}:`, err);
      failed++;
    }
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(contacts)
    .where(sendable);

  if (remaining > 0) {
    // Keep going: re-enqueue another pass shortly.
    await enqueueCampaignDrain(campaignId, 3);
  }

  console.log(
    `[campaign-drain ${campaignId}] sent=${sent} failed=${failed} skipped=${skipped} remaining=${remaining}`,
  );

  revalidatePath("/");
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/contacts`);
  revalidatePath(`/campaigns/${campaignId}/inbox`);

  return NextResponse.json({ ok: true, sent, failed, skipped, remaining });
}
