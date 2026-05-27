import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const r = await db.execute(sql`SELECT now() AT TIME ZONE 'America/Chicago' nowct,
    count(*) filter (where created_at > now() - interval '3 minutes')::int last3,
    count(*) filter (where created_at > now() - interval '10 minutes')::int last10,
    to_char(max(created_at) AT TIME ZONE 'America/Chicago','HH24:MI:SS') last_send
    FROM messages WHERE direction='outbound'`);
  const x = r.rows[0] as any;
  console.log(`now=${x.nowct} | outbound last 3min=${x.last3} last 10min=${x.last10} | most recent send=${x.last_send}`);
  const camp = await db.execute(sql`SELECT name, status, llm_mode FROM campaigns`);
  for (const c of camp.rows as any[]) console.log(`campaign: ${c.name} status=${c.status} mode=${c.llm_mode}`);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
