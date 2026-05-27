import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const rows = await db.execute(sql`
    select c.id, c.name, c.min_score_to_send,
      count(ct.*)::int as total,
      count(ct.qualification_score)::int as scored,
      count(*) filter (where ct.enriched_at is not null)::int as enriched,
      count(*) filter (where ct.qualification_score >= 65)::int as ge65,
      count(*) filter (where ct.status = 'pending' and ct.opted_out = false)::int as pending
    from campaigns c left join contacts ct on ct.campaign_id = c.id
    group by c.id, c.name, c.min_score_to_send
    order by total desc`);
  for (const r of rows.rows as any[]) {
    console.log(`${r.name} | bar=${r.min_score_to_send ?? "off"} total=${r.total} scored=${r.scored} enriched=${r.enriched} >=65=${r.ge65} pending=${r.pending}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
