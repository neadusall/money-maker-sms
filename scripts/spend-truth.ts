import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  // last 24h spend (UTC-safe), by purpose
  const r = await db.execute(sql`
    SELECT purpose, count(*)::int n, coalesce(sum(cost_usd),0)::float c
    FROM usage_events WHERE created_at > now() - interval '24 hours'
    GROUP BY purpose ORDER BY c DESC`);
  console.log("--- last 24h by purpose ---");
  let total24h = 0;
  for (const x of r.rows as any[]) { total24h += Number(x.c); console.log(`  ${String(x.purpose).padEnd(10)} ${String(x.n).padStart(6)} calls   $${Number(x.c).toFixed(4)}`); }
  console.log("24h total: $" + total24h.toFixed(2));
  // all-time
  const a = await db.execute(sql`SELECT coalesce(sum(cost_usd),0)::float c, count(*)::int n FROM usage_events`);
  console.log("all-time LLM spend: $" + Number((a.rows[0] as any).c).toFixed(2), "/", (a.rows[0] as any).n, "calls");
  // most recent score event
  const last = await db.execute(sql`SELECT purpose, created_at, cost_usd, model FROM usage_events WHERE purpose='score' ORDER BY created_at DESC LIMIT 5`);
  console.log("--- last 5 score events ---");
  for (const x of last.rows as any[]) console.log(`  ${x.created_at} | ${x.model} | $${Number(x.cost_usd).toFixed(4)}`);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
