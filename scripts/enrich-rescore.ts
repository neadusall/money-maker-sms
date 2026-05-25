import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { db } from "../src/db/client";
import { contacts, campaigns } from "../src/db/schema";
import { scoreContactDeep } from "../src/lib/qualify";

const BULK_MODEL = "claude-haiku-4-5-20251001";
const CONCURRENCY = 6;

/**
 * One-time: enrich every contact that has a LinkedIn URL (real work history)
 * and re-score them. Contacts without a URL keep their title+company score and
 * are just marked enriched_at so they aren't reprocessed.
 */
async function main() {
  const rows = await db
    .select({ contact: contacts, campaign: campaigns })
    .from(contacts)
    .innerJoin(campaigns, eq(campaigns.id, contacts.campaignId))
    .where(eq(contacts.optedOut, false));

  console.log(`Processing ${rows.length} contacts (concurrency ${CONCURRENCY})...`);
  let enriched = 0;
  let rescored = 0;
  let done = 0;

  async function handle(r: (typeof rows)[number]) {
    const { contact, campaign } = r;
    if (!contact.linkedinUrl) {
      await db.update(contacts).set({ enrichedAt: new Date() }).where(eq(contacts.id, contact.id));
      return;
    }
    try {
      const { score, enriched: prof, fetched } = await scoreContactDeep({ campaign, contact, model: BULK_MODEL });
      await db
        .update(contacts)
        .set({
          qualificationScore: score ? score.score : contact.qualificationScore,
          qualificationReason: score ? score.reason : contact.qualificationReason,
          enrichedAt: new Date(),
          ...(fetched ? { enrichedProfile: (prof as unknown as Record<string, unknown>) ?? null } : {}),
        })
        .where(eq(contacts.id, contact.id));
      if (prof) enriched++;
      if (score) rescored++;
    } catch (e) {
      console.error(`  ! ${contact.id}:`, e instanceof Error ? e.message : e);
      await db.update(contacts).set({ enrichedAt: new Date() }).where(eq(contacts.id, contact.id));
    }
  }

  // Simple concurrency pool.
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(handle));
    done = Math.min(i + CONCURRENCY, rows.length);
    if (done % 60 === 0 || done === rows.length) {
      console.log(`  ...${done}/${rows.length}  (enriched ${enriched}, rescored ${rescored})`);
    }
  }

  console.log(`\nDone. Enriched ${enriched} profiles, re-scored ${rescored}.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
