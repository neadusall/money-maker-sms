import "dotenv/config";
import { sql, eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { conversations } from "../src/db/schema";
async function main() {
  const [camp] = (await db.execute(sql`SELECT id FROM campaigns LIMIT 1`)).rows as any[];
  const id = camp.id;
  // A) the drizzle-interpolated version used in the page
  const a = await db.select({
    replied: sql<number>`count(*) filter (where exists (select 1 from messages m where m.conversation_id = ${conversations.id} and m.direction = 'inbound'))::int`,
  }).from(conversations).where(eq(conversations.campaignId, id));
  console.log("drizzle-interpolated replied:", JSON.stringify(a[0]));
  // B) plain raw correlated
  const b = await db.execute(sql`
    SELECT count(*) filter (where exists (select 1 from messages m where m.conversation_id = cv.id and m.direction='inbound'))::int replied
    FROM conversations cv WHERE cv.campaign_id = ${id}`);
  console.log("raw correlated replied:", JSON.stringify(b.rows[0]));
  process.exit(0);
}
main().catch((e)=>{console.error("ERR:", e.message); process.exit(1);});
