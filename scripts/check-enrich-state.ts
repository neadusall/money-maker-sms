import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const r = await db.execute(sql`
    SELECT count(*)::int total,
      count(*) FILTER (WHERE qualification_score IS NOT NULL)::int scored,
      count(*) FILTER (WHERE enriched_at IS NOT NULL)::int enriched,
      count(*) FILTER (WHERE linkedin_url IS NOT NULL)::int has_url,
      count(*) FILTER (WHERE opted_out=false)::int active
    FROM contacts WHERE campaign_id='ad981e17-ee13-489e-8ad3-ff6534d660d2'`);
  console.log(JSON.stringify(((r as {rows?:unknown[]}).rows ?? [])[0]));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
