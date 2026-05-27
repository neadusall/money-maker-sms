import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts } from "@/db/schema";
import { verifyQStashSignature, enqueueScoreDrain } from "@/lib/schedule";
import { scoreContactDeep } from "@/lib/qualify";
import { ensureRubric } from "@/lib/rubric";

export const maxDuration = 60;

// Keep concurrency low: too many simultaneous LLM calls trip Anthropic rate
// limits, and a rate-limited call used to get permanently stamped as a failure.
const SCORE_BATCH = 5;
// After this many consecutive zero-progress passes, stop re-enqueuing (the API
// is almost certainly down/throttled) instead of looping forever. Unscored
// contacts stay null so they show as "—" and can be re-scored later.
const MAX_STALLS = 8;
// Cheaper/faster model for bulk list scoring.
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
  await Promise.all(
    batch.map(async (contact) => {
      const { score, enriched, fetched, locationRegion, locationMatch } = await scoreContactDeep({
        campaign,
        contact,
        model: BULK_MODEL,
        rubric,
      }).catch(() => ({ score: null, enriched: null, fetched: false, locationRegion: null, locationMatch: null }));

      if (score) {
        await db
          .update(contacts)
          .set({
            qualificationScore: score.score,
            qualificationReason: score.reason,
            locationRegion,
            locationMatch,
            enrichedAt: new Date(),
            ...(fetched ? { enrichedProfile: (enriched as unknown as Record<string, unknown>) ?? null } : {}),
          })
          .where(eq(contacts.id, contact.id));
        scored++;
      } else {
        // Scoring failed (rate limit / transient). Leave qualificationScore NULL
        // so this contact is retried, but cache any profile we fetched so we
        // don't re-pay the enrichment API on the retry.
        failed++;
        if (fetched) {
          await db
            .update(contacts)
            .set({ enrichedAt: new Date(), enrichedProfile: (enriched as unknown as Record<string, unknown>) ?? null })
            .where(eq(contacts.id, contact.id));
        }
      }
    }),
  );

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(contacts)
    .where(selector);

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
