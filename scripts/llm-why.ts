import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const r = await db.execute(sql`
    SELECT purpose, count(*)::int n, coalesce(sum(cost_usd),0)::float cost
    FROM usage_events GROUP BY purpose ORDER BY cost DESC`);
  let total = 0;
  for (const x of r.rows as any[]) { total += Number(x.cost); console.log(`${String(x.purpose).padEnd(10)} ${String(x.n).padStart(6)} calls   $${Number(x.cost).toFixed(2)}`); }
  console.log("-----------------------------------");
  console.log(`TOTAL LLM spend (all time):          $${total.toFixed(2)}`);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
