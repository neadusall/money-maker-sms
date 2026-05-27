import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
const SMS_OUT = 0.0079, SMS_IN = 0.001, PROFILE_COST = 0.00267, TZ = "America/Chicago";
async function main() {
  const r = await db.execute(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day,
           coalesce(sum(cost),0)::float AS total,
           coalesce(sum(cost) FILTER (WHERE src='llm'),0)::float AS llm
    FROM (
      SELECT (created_at AT TIME ZONE ${TZ})::date AS day, cost_usd::float AS cost, 'llm' AS src FROM usage_events
      UNION ALL
      SELECT (created_at AT TIME ZONE ${TZ})::date, (CASE WHEN direction='outbound' THEN ${SMS_OUT}::float ELSE ${SMS_IN}::float END), 'sms' FROM messages
      UNION ALL
      SELECT (enriched_at AT TIME ZONE ${TZ})::date, ${PROFILE_COST}::float, 'li' FROM contacts WHERE enriched_profile IS NOT NULL AND enriched_at IS NOT NULL
    ) t
    WHERE day >= (now() AT TIME ZONE ${TZ})::date - 13
    GROUP BY day ORDER BY day DESC`);
  const rows = (r as unknown as { rows: Record<string, unknown>[] }).rows;
  console.log("rows:", rows.length);
  for (const x of rows) console.log(x.day, "$" + Number(x.total).toFixed(2), "(llm $" + Number(x.llm).toFixed(2) + ")");
  process.exit(0);
}
main().catch((e) => { console.error("SQL ERROR:", e.message); process.exit(1); });
