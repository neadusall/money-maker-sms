import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const camp = await db.execute(sql`SELECT id, name, status FROM campaigns`);
  for (const c of camp.rows as any[]) console.log(`campaign: ${c.name} status=${c.status}`);
  const sent = await db.execute(sql`SELECT count(*) filter (where status in ('sent','delivered','replied'))::int sent, count(*) filter (where status='queued')::int queued FROM contacts`);
  console.log("contacts:", sent.rows[0]);
  // duplicate outbound messages: same conversation, >1 outbound
  const dupes = await db.execute(sql`
    SELECT conversation_id, count(*)::int n
    FROM messages WHERE direction='outbound'
    GROUP BY conversation_id HAVING count(*) > 1
    ORDER BY n DESC LIMIT 10`);
  console.log(`conversations with >1 outbound: ${dupes.rows.length}`);
  for (const d of dupes.rows as any[]) console.log(`  convo ${d.conversation_id}: ${d.n} outbound`);
  const tot = await db.execute(sql`SELECT count(*)::int n FROM messages WHERE direction='outbound'`);
  console.log("total outbound messages:", (tot.rows[0] as any).n);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
