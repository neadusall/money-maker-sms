import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runScoreBatch } from "@/lib/drains";
import { verifyQStashSignature, enqueueScoreDrain } from "@/lib/schedule";

export const maxDuration = 60;

// After this many consecutive zero-progress passes, stop re-enqueuing (the API
// is almost certainly down/throttled) instead of looping forever. Unscored
// contacts stay null so they show as "—" and can be re-scored later.
const MAX_STALLS = 8;

export async function POST(request: Request) {
  const rawBody = await request.text();
  const ok = await verifyQStashSignature(rawBody, request.headers.get("upstash-signature"));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let campaignId: string | undefined;
  let stall = 0;
  try {
    const body = JSON.parse(rawBody);
    campaignId = body.campaignId;
    stall = Number(body.stall) || 0;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!campaignId) return NextResponse.json({ error: "missing campaignId" }, { status: 400 });

  const r = await runScoreBatch(campaignId);
  if (r.gone) return NextResponse.json({ ok: true, note: "campaign gone" });

  if (r.remaining > 0) {
    // No progress this pass → likely rate-limited; back off and count the stall.
    const nextStall = r.scored > 0 ? 0 : stall + 1;
    if (nextStall >= MAX_STALLS) {
      console.warn(`[score-drain ${campaignId}] giving up after ${nextStall} stalled passes; ${r.remaining} left unscored`);
    } else {
      const delay = nextStall > 0 ? Math.min(60, 8 * nextStall) : 2;
      await enqueueScoreDrain(campaignId, delay, nextStall);
    }
  }

  console.log(`[score-drain ${campaignId}] scored=${r.scored} failed=${r.failed} remaining=${r.remaining} stall=${stall}`);
  revalidatePath(`/campaigns/${campaignId}/contacts`);
  return NextResponse.json({ ok: true, scored: r.scored, failed: r.failed, remaining: r.remaining });
}
