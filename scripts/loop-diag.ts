import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  // outbound per 5-min bucket, last 90 min (CT)
  const buckets = await db.execute(sql`
    SELECT to_char(date_trunc('minute', created_at AT TIME ZONE 'America/Chicago') - (extract(minute from created_at)::int % 5) * interval '1 minute','HH24:MI') bucket,
           count(*)::int n
    FROM messages WHERE direction='outbound' AND created_at > now() - interval '90 minutes'
    GROUP BY 1 ORDER BY 1`);
  console.log("--- outbound per 5-min (CT) ---");
  for (const r of buckets.rows as any[]) console.log(r.bucket, "x".repeat(Math.min(60,r.n)), r.n);
  // conversations with the most outbound (loop detection)
  const loops = await db.execute(sql`
    SELECT conversation_id, count(*)::int n FROM messages WHERE direction='outbound'
    GROUP BY conversation_id ORDER BY n DESC LIMIT 5`);
  console.log("--- top conversations by outbound count ---");
  for (const r of loops.rows as any[]) console.log(r.conversation_id, "=", r.n);
  // sends in last 2 min (post-kill)
  const post = await db.execute(sql`SELECT count(*)::int n, to_char(max(created_at) AT TIME ZONE 'America/Chicago','HH24:MI:SS') last FROM messages WHERE direction='outbound' AND created_at > now() - interval '2 minutes'`);
  console.log("outbound in last 2 min:", (post.rows[0] as any).n, "| last send:", (post.rows[0] as any).last);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
