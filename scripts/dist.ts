import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const r = await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where qualification_score is null)::int as nullscore,
      count(*) filter (where qualification_score = 0)::int as zero,
      count(*) filter (where qualification_score between 1 and 39)::int as b1_39,
      count(*) filter (where qualification_score between 40 and 59)::int as b40_59,
      count(*) filter (where qualification_score between 60 and 74)::int as b60_74,
      count(*) filter (where qualification_score >= 75)::int as b75plus,
      round(avg(qualification_score))::int as avg,
      count(*) filter (where enriched_profile is not null)::int as has_profile
    from contacts`);
  console.log(r.rows[0]);
  // a few sample low scorers to eyeball
  const s = await db.execute(sql`select job_title, company, qualification_score as score, left(coalesce(qualification_reason,''),90) as why
    from contacts where qualification_score < 60 order by created_at desc limit 6`);
  console.log("--- recent sub-60 samples ---");
  for (const x of s.rows as any[]) console.log(`[${x.score}] ${x.job_title ?? "?"} @ ${x.company ?? "?"} :: ${x.why}`);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
