import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const now = await db.execute(sql`SELECT now() AT TIME ZONE 'America/Chicago' AS now_ct`);
  console.log("DB now (CT):", (now.rows[0] as any).now_ct);
  // latest outbound sends overall
  const latest = await db.execute(sql`
    SELECT to_char(created_at AT TIME ZONE 'America/Chicago','MM-DD HH24:MI:SS') t, body
    FROM messages WHERE direction='outbound' ORDER BY created_at DESC LIMIT 5`);
  console.log("--- 5 most recent outbound sends (CT) ---");
  for (const r of latest.rows as any[]) console.log(r.t, "|", String(r.body).slice(0,45));
  // outbound in last 60 min
  const recent = await db.execute(sql`SELECT count(*)::int n FROM messages WHERE direction='outbound' AND created_at > now() - interval '60 minutes'`);
  console.log("outbound sent in last 60 min:", (recent.rows[0] as any).n);
  // campaign status
  const c = await db.execute(sql`SELECT name, status FROM campaigns`);
  for (const x of c.rows as any[]) console.log("campaign:", x.name, "=", x.status);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
