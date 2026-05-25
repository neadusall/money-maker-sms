import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { campaigns, contacts } from "../src/db/schema";
import { regionForLocation } from "../src/lib/region";

async function main() {
  const CID = "ad981e17-ee13-489e-8ad3-ff6534d660d2";
  await db.update(campaigns).set({ targetRegion: "east" }).where(eq(campaigns.id, CID));
  const targets = ["east"];
  const rows = await db.select().from(contacts).where(eq(contacts.campaignId, CID));
  let matched = 0, known = 0;
  const tally: Record<string, number> = {};
  for (const c of rows) {
    const prof = c.enrichedProfile as { location?: string } | null;
    const loc = prof?.location || c.location || null;
    const region = regionForLocation(loc);
    const match = region != null && targets.includes(region);
    if (region) { known++; tally[region] = (tally[region] ?? 0) + 1; }
    if (match) matched++;
    await db.update(contacts).set({ locationRegion: region, locationMatch: match }).where(eq(contacts.id, c.id));
  }
  console.log(`Target=East. ${matched} in-region, ${known}/${rows.length} locations resolved.`);
  console.log("region tally:", JSON.stringify(tally));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
