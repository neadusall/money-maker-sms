import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  // Today's LLM spend (Central) — pre-top-up calls returned 400 and weren't
  // charged, so today's total ≈ what we spent against the $12 top-up.
  const today = await db.execute(sql`
    SELECT
      coalesce(sum(cost_usd),0)::float today_usd,
      count(*)::int calls,
      coalesce(sum(input_tokens),0)::bigint in_tok,
      coalesce(sum(output_tokens),0)::bigint out_tok
    FROM usage_events
    WHERE created_at >= (now() AT TIME ZONE 'America/Chicago')::date AT TIME ZONE 'America/Chicago'`);
  const r = (today.rows[0] ?? {}) as any;
  const spent = Number(r.today_usd);
  console.log("Today's LLM spend on Anthropic: $" + spent.toFixed(4));
  console.log("  calls:", r.calls, "| input tokens:", String(r.in_tok), "| output tokens:", String(r.out_tok));
  const remaining = 12 - spent;
  console.log("Estimated remaining of the $12 top-up: $" + remaining.toFixed(2));
  // breakdown by purpose
  const byp = await db.execute(sql`
    SELECT purpose, count(*)::int n, coalesce(sum(cost_usd),0)::float c
    FROM usage_events WHERE created_at >= (now() AT TIME ZONE 'America/Chicago')::date AT TIME ZONE 'America/Chicago'
    GROUP BY purpose ORDER BY c DESC`);
  console.log("--- today by purpose ---");
  for (const x of byp.rows as any[]) console.log("  ", String(x.purpose).padEnd(10), String(x.n).padStart(5), "calls  $" + Number(x.c).toFixed(4));
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
