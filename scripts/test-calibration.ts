import "dotenv/config";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { campaigns, contacts } from "../src/db/schema";
import { scoreContactDeep } from "../src/lib/qualify";
import { ensureRubric } from "../src/lib/rubric";
async function main() {
  const CID = "ad981e17-ee13-489e-8ad3-ff6534d660d2";
  await db.update(campaigns).set({ scoringRubric: null }).where(eq(campaigns.id, CID)); // force regen with new prompt
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, CID));
  const rubric = (await ensureRubric(campaign).catch(() => null)) ?? undefined;
  console.log("===== NEW RUBRIC =====\n" + rubric + "\n===== SCORES =====");
  const rows = await db.select().from(contacts).where(and(eq(contacts.campaignId, CID), inArray(contacts.lastName, ["Brazelle", "Ornstein", "Tomasik", "Lopez", "Krempasky", "Lington"])));
  for (const c of rows) {
    const { score } = await scoreContactDeep({ campaign, contact: c, model: "claude-sonnet-4-6", rubric });
    console.log(`[${score?.score}] ${c.firstName} ${c.lastName} (${c.jobTitle} @ ${c.company}) — ${score?.reason}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
