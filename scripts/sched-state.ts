import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const s = await db.execute(sql`SELECT status, count(*)::int n FROM scheduled_messages GROUP BY status`);
  console.log("scheduled_messages by status:"); for (const r of s.rows as any[]) console.log("  ", r.status, r.n);
  const pend = await db.execute(sql`SELECT count(*)::int n, to_char(min(send_at) AT TIME ZONE 'America/Chicago','HH24:MI') first_due, to_char(max(send_at) AT TIME ZONE 'America/Chicago','HH24:MI') last_due FROM scheduled_messages WHERE status='pending'`);
  console.log("PENDING now:", JSON.stringify(pend.rows[0]));
  const created = await db.execute(sql`SELECT count(*)::int n FROM scheduled_messages WHERE created_at > now() - interval '15 minutes'`);
  console.log("scheduled created last 15 min:", (created.rows[0] as any).n);
  const last = await db.execute(sql`SELECT to_char(created_at AT TIME ZONE 'America/Chicago','HH24:MI:SS') t, conversation_id, left(body,50) b FROM messages WHERE direction='outbound' ORDER BY created_at DESC LIMIT 6`);
  console.log("--- last 6 outbound ---"); for (const r of last.rows as any[]) console.log(r.t, String(r.conversation_id).slice(0,8), "|", r.b);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
