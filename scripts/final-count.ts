import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const r = await db.execute(sql`
    SELECT c.name, c.min_score_to_send bar,
      count(ct.*)::int total,
      count(ct.qualification_score)::int scored,
      count(*) filter (where ct.qualification_score is null and ct.opted_out=false)::int unscored,
      count(*) filter (where ct.qualification_score >= 50)::int ge50,
      count(*) filter (where ct.qualification_score >= 50 and ct.status='pending' and ct.opted_out=false)::int ge50_pending,
      count(*) filter (where ct.qualification_score >= 60 and ct.status='pending' and ct.opted_out=false)::int ge60_pending,
      round(avg(ct.qualification_score))::int avg
    FROM campaigns c LEFT JOIN contacts ct ON ct.campaign_id=c.id
    GROUP BY c.name, c.min_score_to_send`);
  for (const x of r.rows as any[]) console.log(JSON.stringify(x, null, 0));
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
