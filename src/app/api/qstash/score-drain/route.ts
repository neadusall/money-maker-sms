import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts } from "@/db/schema";
import { verifyQStashSignature, enqueueScoreDrain } from "@/lib/schedule";
import { scoreContactDeep } from "@/lib/qualify";
import { isEnrichmentConfigured } from "@/lib/enrich";

export const maxDuration = 60;

const SCORE_BATCH = 12;
// Cheaper/faster model for bulk list scoring.
const BULK_MODEL = "claude-haiku-4-5-20251001";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const ok = await verifyQStashSignature(rawBody, request.headers.get("upstash-signature"));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let campaignId: string | undefined;
  try {
    campaignId = JSON.parse(rawBody).campaignId;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!campaignId) return NextResponse.json({ error: "missing campaignId" }, { status: 400 });

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return NextResponse.json({ ok: true, note: "campaign gone" });

  // When enrichment is configured, process everyone not yet enriched (pull real
  // work history + score on it). Otherwise just score the unscored.
  const enrichOn = isEnrichmentConfigured();
  const needsWork = enrichOn ? isNull(contacts.enrichedAt) : isNull(contacts.qualificationScore);
  const selector = and(eq(contacts.campaignId, campaignId), eq(contacts.optedOut, false), needsWork);

  const batch = await db.select().from(contacts).where(selector).limit(SCORE_BATCH);

  let scored = 0;
  for (const contact of batch) {
    const { score, enriched, fetched } = await scoreContactDeep({ campaign, contact, model: BULK_MODEL }).catch(
      () => ({ score: null, enriched: null, fetched: false }),
    );
    await db
      .update(contacts)
      .set({
        qualificationScore: score ? score.score : 0,
        qualificationReason: score ? score.reason : "could not score",
        // Mark processed so we don't reprocess; cache the fetched profile.
        enrichedAt: new Date(),
        ...(fetched ? { enrichedProfile: (enriched as unknown as Record<string, unknown>) ?? null } : {}),
      })
      .where(eq(contacts.id, contact.id));
    if (score) scored++;
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(contacts)
    .where(selector);

  if (remaining > 0) await enqueueScoreDrain(campaignId, 2);

  console.log(`[score-drain ${campaignId}] scored=${scored} remaining=${remaining}`);
  revalidatePath(`/campaigns/${campaignId}/contacts`);
  return NextResponse.json({ ok: true, scored, remaining });
}
