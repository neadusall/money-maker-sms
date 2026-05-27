import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const r = await db.execute(sql`
    select c.name, c.min_score_to_send as bar,
      count(*) filter (where ct.status='pending')::int as pending,
      count(*) filter (where ct.status='pending' and ct.opted_out=false and ct.qualification_score >= 60)::int as qual60,
      count(*) filter (where ct.qualification_score >= 60)::int as ge60_all
    from campaigns c join contacts ct on ct.campaign_id=c.id
    group by c.name, c.min_score_to_send`);
  for (const x of r.rows as any[]) console.log(`${x.name}: bar=${x.bar} pending=${x.pending} | qualifying(pending&>=60)=${x.qual60} | total>=60=${x.ge60_all}`);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
