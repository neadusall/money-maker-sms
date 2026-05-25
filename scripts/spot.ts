import "dotenv/config"; import { sql } from "drizzle-orm"; import { db } from "../src/db/client";
async function main(){
  const r=await db.execute(sql`SELECT first_name,last_name,job_title,company,qualification_score s, (enriched_profile IS NOT NULL) enr, left(qualification_reason,90) why FROM contacts WHERE campaign_id='ad981e17-ee13-489e-8ad3-ff6534d660d2' AND last_name IN ('Ornstein','Tomasik','Degnan','Brazelle','Lesko') ORDER BY qualification_score DESC NULLS LAST`);
  for(const x of ((r as {rows?:Record<string,unknown>[]}).rows??[])) console.log(`${x.s}\t${x.enr?'ENR':'   '}\t${x.first_name} ${x.last_name} (${x.job_title} @ ${x.company})\n\t→ ${x.why}`);
  console.log("=== distribution ===");
  const d=await db.execute(sql`SELECT count(*) FILTER (WHERE qualification_score>=75)::int s75, count(*) FILTER (WHERE qualification_score BETWEEN 50 AND 74)::int s50, count(*) FILTER (WHERE qualification_score BETWEEN 25 AND 49)::int s25, count(*) FILTER (WHERE qualification_score<25)::int slow FROM contacts WHERE campaign_id='ad981e17-ee13-489e-8ad3-ff6534d660d2'`);
  console.log(JSON.stringify(((d as {rows?:unknown[]}).rows??[])[0]));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
