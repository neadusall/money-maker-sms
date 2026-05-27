import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts } from "@/db/schema";
import { verifyQStashSignature, enqueueScoreDrain } from "@/lib/schedule";
import { scoreCandidatesBatch } from "@/lib/qualify";
import { ensureRubric } from "@/lib/rubric";
import { regionForLocation } from "@/lib/region";

export const maxDuration = 60;

// Candidates scored per LLM call. Batch scoring amortizes the (cached) rubric
// across the group, cutting cost ~5x vs one-call-per-candidate.
const SCORE_BATCH = 20;
// After this many consecutive zero-progress passes, stop re-enqueuing (the API
// is almost certainly down/throttled) instead of looping forever. Unscored
// contacts stay null so they show as "—" and can be re-scored later.
const MAX_STALLS = 8;
// Model for bulk list scoring.
const BULK_MODEL = "claude-sonnet-4-6";

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

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return NextResponse.json({ ok: true, note: "campaign gone" });

  // Drive off the SCORE, not enrichment: anything without a fit score still needs
  // work. A failed scoring attempt leaves the score null (below), so it's retried
  // on a later pass instead of being permanently marked done.
  const selector = and(
    eq(contacts.campaignId, campaignId),
    eq(contacts.optedOut, false),
    isNull(contacts.qualificationScore),
  );

  const batch = await db.select().from(contacts).where(selector).limit(SCORE_BATCH);

  // Compact rubric (generated once per campaign) keeps each scoring prompt small.
  const rubric = (await ensureRubric(campaign).catch(() => null)) ?? undefined;

  let scored = 0;
  let failed = 0;
  const errors: string[] = [];

  // One LLM call scores the whole batch.
  const scores = await scoreCandidatesBatch({ campaign, contacts: batch, model: BULK_MODEL, rubric }).catch((e) => {
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

  if (remaining > 0) {
    // No progress this pass → likely rate-limited; back off and count the stall.
    const nextStall = scored > 0 ? 0 : stall + 1;
    if (nextStall >= MAX_STALLS) {
      console.warn(`[score-drain ${campaignId}] giving up after ${nextStall} stalled passes; ${remaining} left unscored`);
    } else {
      const delay = nextStall > 0 ? Math.min(60, 8 * nextStall) : 2;
      await enqueueScoreDrain(campaignId, delay, nextStall);
    }
  }

  console.log(`[score-drain ${campaignId}] scored=${scored} failed=${failed} remaining=${remaining} stall=${stall}`);
  revalidatePath(`/campaigns/${campaignId}/contacts`);
  return NextResponse.json({ ok: true, scored, failed, remaining });
}
