import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const c = await db.execute(sql`
    SELECT
      count(*)::int total,
      count(*) filter (where status in ('sent','delivered','replied'))::int sent_bucket,
      count(*) filter (where status='delivered')::int delivered_only,
      count(*) filter (where status in ('delivered','replied'))::int delivered_bucket,
      count(*) filter (where status='replied')::int replied,
      count(*) filter (where status='sent')::int sent_only,
      count(*) filter (where status='pending')::int pending,
      count(*) filter (where status='queued')::int queued,
      count(*) filter (where status='failed')::int failed,
      count(*) filter (where status='opted_out')::int opted_out,
      count(*) filter (where opted_out=true)::int opted_flag
    FROM contacts`);
  console.log("CONTACTS by status:", JSON.stringify(c.rows[0]));
  // actual replies = conversations with >=1 inbound, and distinct inbound senders
  const conv = await db.execute(sql`
    SELECT count(*) filter (where exists (select 1 from messages m where m.conversation_id=cv.id and m.direction='inbound'))::int convos_with_reply,
           count(*)::int total_convos
    FROM conversations cv`);
  console.log("CONVERSATIONS:", JSON.stringify(conv.rows[0]));
  // sentiment from classifications
  const cls = await db.execute(sql`SELECT classification, count(*)::int n FROM conversations WHERE classification is not null GROUP BY classification ORDER BY n DESC`);
  console.log("classifications:");
  for (const r of cls.rows as any[]) console.log("  ", r.classification, r.n);
  // outbound message count (dupes inflate this)
  const msg = await db.execute(sql`SELECT count(*) filter (where direction='outbound')::int outbound, count(*) filter (where direction='inbound')::int inbound, count(distinct conversation_id) filter (where direction='inbound')::int convos_inbound FROM messages`);
  console.log("MESSAGES:", JSON.stringify(msg.rows[0]));
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
