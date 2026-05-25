import "dotenv/config"; import { sql } from "drizzle-orm"; import { db } from "../src/db/client";
async function main(){
  const CID="ad981e17-ee13-489e-8ad3-ff6534d660d2";
  const d=await db.execute(sql`SELECT count(*) FILTER (WHERE qualification_score>=85)::int s85, count(*) FILTER (WHERE qualification_score BETWEEN 70 AND 84)::int s70, count(*) FILTER (WHERE qualification_score BETWEEN 55 AND 69)::int s55, count(*) FILTER (WHERE qualification_score BETWEEN 40 AND 54)::int s40, count(*) FILTER (WHERE qualification_score<40)::int slow, round(avg(qualification_score))::int avg FROM contacts WHERE campaign_id=${CID}`);
  console.log("DISTRIBUTION:", JSON.stringify(((d as {rows?:unknown[]}).rows??[])[0]));
  const top=await db.execute(sql`SELECT first_name,last_name,job_title,company,qualification_score s FROM contacts WHERE campaign_id=${CID} ORDER BY qualification_score DESC NULLS LAST LIMIT 8`);
  console.log("TOP 8:");
  for(const x of ((top as {rows?:Record<string,unknown>[]}).rows??[])) console.log(`  ${x.s}  ${x.first_name} ${x.last_name} — ${x.job_title} @ ${x.company}`);
  const u=await db.execute(sql`SELECT coalesce(sum(cost_usd),0)::float c, count(*)::int n FROM usage_events`);
  console.log("LLM SPEND:", JSON.stringify(((u as {rows?:unknown[]}).rows??[])[0]));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
