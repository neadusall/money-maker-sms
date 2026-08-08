import { and, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts } from "@/db/schema";
import { campaignTenantIs } from "./tenant-core";

/**
 * Cross-recruiter, cross-campaign de-duplication at import time.
 *
 * The unique index on (campaign, phone) only stops a number appearing twice in
 * ONE campaign. It does nothing to stop the same person landing in a teammate's
 * campaign too - and then getting the same (or a very similar) recruiting text
 * from two people on the team. That is the outreach that burns a lead and makes
 * the firm look uncoordinated.
 *
 * This returns the phones from `phones` that are ALREADY held by some OTHER
 * campaign in the same tenant, so the caller can leave them out. The rule is
 * first-campaign-wins: whoever loaded the contact first keeps them; a later
 * import of the same person is silently skipped. It is:
 *
 *   - TENANT-SCOPED: a white-label customer's leads never block the house's
 *     (and vice versa) - each business dedupes only against itself.
 *   - SELF-EXCLUDING: `excludeCampaignId` (the campaign being loaded) is not
 *     counted, so a re-push / top-up of the SAME list still absorbs its own
 *     rows through onConflictDoNothing rather than blocking them here.
 *   - LIVE-ONLY: soft-deleted (archived) rows don't count - if the other
 *     campaign let the contact go, a new campaign may claim them.
 *
 * Residual race: two overlapping imports running at the same instant can both
 * pass this check and both insert. That is acceptable here (imports are cron /
 * human-paced, not concurrent bursts) and is the same query-time guarantee the
 * existing "previously texted" filter relies on; a global unique on phone would
 * wrongly collide with opt-out history and legitimate re-use across time.
 */
const CHUNK = 1000;

export async function phonesClaimedByOtherCampaigns(
  tenant: string,
  excludeCampaignId: string | null,
  phones: string[],
): Promise<Set<string>> {
  const uniq = Array.from(new Set(phones.filter(Boolean)));
  const claimed = new Set<string>();
  if (uniq.length === 0) return claimed;

  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK);
    const conds: (SQL | undefined)[] = [
      inArray(contacts.phone, chunk),
      isNull(contacts.deletedAt),
      campaignTenantIs(tenant),
    ];
    if (excludeCampaignId) conds.push(ne(contacts.campaignId, excludeCampaignId));
    const rows = await db
      .select({ phone: contacts.phone })
      .from(contacts)
      .innerJoin(campaigns, eq(campaigns.id, contacts.campaignId))
      .where(and(...conds));
    for (const r of rows) claimed.add(r.phone);
  }
  return claimed;
}
