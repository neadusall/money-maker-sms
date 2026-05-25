import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts } from "@/db/schema";
import { verifyQStashSignature, enqueueScoreDrain } from "@/lib/schedule";
import { scoreCandidate } from "@/lib/qualify";

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

  // Unscored contacts in this campaign (skip opted-out).
  const batch = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.campaignId, campaignId),
        isNull(contacts.qualificationScore),
        eq(contacts.optedOut, false),
      ),
    )
    .limit(SCORE_BATCH);

  let scored = 0;
  for (const contact of batch) {
    const sc = await scoreCandidate({ campaign, contact, model: BULK_MODEL }).catch(() => null);
    // Store the score; on failure mark 0 so we don't loop forever on the same row.
    await db
      .update(contacts)
      .set({
        qualificationScore: sc ? sc.score : 0,
        qualificationReason: sc ? sc.reason : "could not score",
      })
      .where(eq(contacts.id, contact.id));
    if (sc) scored++;
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(contacts)
    .where(
      and(
        eq(contacts.campaignId, campaignId),
        isNull(contacts.qualificationScore),
        eq(contacts.optedOut, false),
      ),
    );

  if (remaining > 0) await enqueueScoreDrain(campaignId, 2);

  console.log(`[score-drain ${campaignId}] scored=${scored} remaining=${remaining}`);
  revalidatePath(`/campaigns/${campaignId}/contacts`);
  return NextResponse.json({ ok: true, scored, remaining });
}
