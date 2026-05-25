import "dotenv/config";
import { db } from "../src/db/client";
import { campaigns, contacts } from "../src/db/schema";
import { eq, and, sql } from "drizzle-orm";

async function main() {
  const id = "49e804e1-2005-4527-8dc2-f4aae0095657";
  await db.update(campaigns).set({ status: "paused" }).where(eq(campaigns.id, id));
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  const [stats] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${contacts.status}='pending')::int`,
      sent: sql<number>`count(*) filter (where ${contacts.status} in ('sent','delivered'))::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(contacts)
    .where(eq(contacts.campaignId, id));
  console.log("CAMPAIGN:", c?.name, "STATUS:", c?.status);
  console.log("STATS:", JSON.stringify(stats));
  process.exit(0);
}
main();
