import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { contacts, campaigns, type Campaign } from "../src/db/schema";
import { scoreContactDeep } from "../src/lib/qualify";
import { ensureRubric } from "../src/lib/rubric";

const BULK_MODEL = "claude-haiku-4-5-20251001";
const CONCURRENCY = 3;

/**
 * One-time: enrich every contact with a LinkedIn URL (real work history) and
 * re-score against the campaign's compact rubric. Reuses cached profiles (no
 * double RapidAPI charge). Failures are left un-marked so they can be retried.
 */
async function main() {
  const rows = await db
    .select({ contact: contacts, campaign: campaigns })
    .from(contacts)
    .innerJoin(campaigns, eq(campaigns.id, contacts.campaignId))
    .where(eq(contacts.optedOut, false));

  console.log(`Processing ${rows.length} contacts (concurrency ${CONCURRENCY})...`);
  const rubricCache = new Map<string, string | undefined>();
  let enriched = 0;
  let rescored = 0;
  let failed = 0;

  async function getRubric(campaign: Campaign): Promise<string | undefined> {
    if (rubricCache.has(campaign.id)) return rubricCache.get(campaign.id);
    const r = (await ensureRubric(campaign).catch(() => null)) ?? undefined;
    rubricCache.set(campaign.id, r);
    return r;
  }

  async function handle(r: (typeof rows)[number]) {
    const { contact, campaign } = r;
    if (!contact.linkedinUrl) {
      await db.update(contacts).set({ enrichedAt: new Date() }).where(eq(contacts.id, contact.id));
      return;
    }
    try {
      const rubric = await getRubric(campaign);
      const { score, enriched: prof, fetched } = await scoreContactDeep({ campaign, contact, model: BULK_MODEL, rubric });
      if (score) {
        await db
          .update(contacts)
          .set({
            qualificationScore: score.score,
            qualificationReason: score.reason,
            enrichedAt: new Date(),
            ...(fetched ? { enrichedProfile: (prof as unknown as Record<string, unknown>) ?? null } : {}),
          })
          .where(eq(contacts.id, contact.id));
        if (prof) enriched++;
        rescored++;
      } else {
        // Cache the fetched profile but leave enriched_at null so it retries.
        if (fetched && prof) {
          await db.update(contacts).set({ enrichedProfile: prof as unknown as Record<string, unknown> }).where(eq(contacts.id, contact.id));
          enriched++;
        }
        failed++;
      }
    } catch (e) {
      failed++;
      console.error(`  ! ${contact.id}:`, e instanceof Error ? e.message.slice(0, 80) : e);
    }
  }

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(handle));
    const done = Math.min(i + CONCURRENCY, rows.length);
    if (done % 60 === 0 || done === rows.length) {
      console.log(`  ...${done}/${rows.length}  (enriched ${enriched}, rescored ${rescored}, failed ${failed})`);
    }
  }

  console.log(`\nDone. Enriched ${enriched}, re-scored ${rescored}, failed ${failed}.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
