import "dotenv/config";
import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "../src/db/client";
import { contacts, campaigns } from "../src/db/schema";
import { scoreContactDeep } from "../src/lib/qualify";

async function main() {
  const [r] = await db
    .select({ contact: contacts, campaign: campaigns })
    .from(contacts)
    .innerJoin(campaigns, eq(campaigns.id, contacts.campaignId))
    .where(and(eq(contacts.campaignId, "ad981e17-ee13-489e-8ad3-ff6534d660d2"), isNotNull(contacts.linkedinUrl)))
    .limit(1);
  console.log("contact:", r.contact.firstName, r.contact.lastName, "| url:", r.contact.linkedinUrl);
  try {
    const out = await scoreContactDeep({ contact: r.contact, campaign: r.campaign, model: "claude-haiku-4-5-20251001" });
    console.log("fetched:", out.fetched, "| enriched?", !!out.enriched, "| experience count:", out.enriched?.experience.length);
    console.log("score:", JSON.stringify(out.score));
  } catch (e) {
    console.error("THREW:", e instanceof Error ? e.message : e);
  }
  process.exit(0);
}
main().catch((e) => { console.error("OUTER:", e); process.exit(1); });
