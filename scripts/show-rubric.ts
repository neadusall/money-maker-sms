import "dotenv/config"; import { sql, eq } from "drizzle-orm"; import { db } from "../src/db/client";
import { campaigns, contacts } from "../src/db/schema";
async function main(){
  const [c]=await db.select({r:campaigns.scoringRubric}).from(campaigns).where(eq(campaigns.id,'ad981e17-ee13-489e-8ad3-ff6534d660d2'));
  console.log("===== SCORING RUBRIC (what the AI grades against) =====\n");
  console.log(c?.r ?? "(none)");
  console.log("\n===== FULL REASONS (sample) =====");
  const rows=await db.execute(sql`SELECT first_name,last_name,job_title,company,qualification_score s,qualification_reason why FROM contacts WHERE campaign_id='ad981e17-ee13-489e-8ad3-ff6534d660d2' AND qualification_reason IS NOT NULL ORDER BY qualification_score DESC NULLS LAST LIMIT 5`);
  for(const x of ((rows as {rows?:Record<string,unknown>[]}).rows??[])) console.log(`\n[${x.s}] ${x.first_name} ${x.last_name} — ${x.job_title} @ ${x.company}\n${x.why}`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
