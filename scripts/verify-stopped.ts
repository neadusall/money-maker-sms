import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  for (let i = 0; i < 4; i++) {
    const r = await db.execute(sql`SELECT
      to_char(now() AT TIME ZONE 'America/Chicago','HH24:MI:SS') now,
      count(*) filter (where direction='outbound' and created_at > now() - interval '90 seconds')::int sent_90s
      FROM messages`);
    const sc = await db.execute(sql`SELECT count(*) filter (where status='pending')::int pend, count(*) filter (where created_at > now() - interval '90 seconds')::int created_90s FROM scheduled_messages`);
    const x = r.rows[0] as any, y = sc.rows[0] as any;
    console.log(`[${x.now}] outbound last90s=${x.sent_90s} | scheduled pending=${y.pend} created90s=${y.created_90s}`);
    if (i < 3) await new Promise(res => setTimeout(res, 20000));
  }
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
