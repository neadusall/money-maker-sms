import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, type Campaign } from "@/db/schema";
import { buildScoringRubric } from "./qualify";

/**
 * Return the campaign's compact scoring rubric, generating + caching it from the
 * position summary on first use. Reused for every candidate score so prompts
 * stay small (well within API rate limits).
 */
export async function ensureRubric(campaign: Campaign): Promise<string | null> {
  if (campaign.scoringRubric) return campaign.scoringRubric;
  if (!campaign.positionSummary) return null;
  const r = await buildScoringRubric(campaign.positionSummary);
  if (r) await db.update(campaigns).set({ scoringRubric: r }).where(eq(campaigns.id, campaign.id));
  return r;
}
