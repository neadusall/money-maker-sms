import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runSendBatch } from "@/lib/drains";
import { verifyQStashSignature, enqueueCampaignDrain } from "@/lib/schedule";

export const maxDuration = 60;

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

  const r = await runSendBatch(campaignId);

  if (r.state === "gone") return NextResponse.json({ ok: true, note: "campaign gone" });
  if (r.state === "stopped") {
    console.log(`[campaign-drain ${campaignId}] campaign is ${r.status}; stopping`);
    return NextResponse.json({ ok: true, note: `campaign ${r.status}; stopped` });
  }
  if (r.state === "waiting_schedule") {
    await enqueueCampaignDrain(campaignId, r.waitSeconds);
    return NextResponse.json({ ok: true, note: "scheduled for future; re-enqueued", retryInSeconds: r.waitSeconds });
  }
  if (r.state === "waiting_window") {
    await enqueueCampaignDrain(campaignId, r.waitSeconds);
    return NextResponse.json({ ok: true, note: "outside send window; re-enqueued", retryInSeconds: r.waitSeconds });
  }
  if (r.state === "waiting_scores") {
    await enqueueCampaignDrain(campaignId, 30);
    return NextResponse.json({ ok: true, note: "waiting for fit scoring", unscored: r.unscored });
  }

  if (r.remaining > 0) {
    // Keep going: re-enqueue another pass shortly.
    await enqueueCampaignDrain(campaignId, 3);
  }

  console.log(
    `[campaign-drain ${campaignId}] sent=${r.sent} failed=${r.failed} skipped=${r.skipped} remaining=${r.remaining}`,
  );

  revalidatePath("/");
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/contacts`);
  revalidatePath(`/campaigns/${campaignId}/inbox`);

  return NextResponse.json({ ok: true, sent: r.sent, failed: r.failed, skipped: r.skipped, remaining: r.remaining });
}
