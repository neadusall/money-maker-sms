import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const r = await db.execute(sql`
    SELECT ct.first_name, ct.last_name, ct.phone, ct.email, ct.job_title, ct.company,
           cp.name campaign, cp.recruiter_name, cp.recruiter_email, cp.calendar_link
    FROM contacts ct JOIN campaigns cp ON cp.id=ct.campaign_id
    WHERE lower(ct.first_name||' '||ct.last_name) LIKE '%trasatti%' OR lower(ct.last_name) LIKE '%trasatti%'
    LIMIT 5`);
  console.log("matches:", r.rows.length);
  for (const x of r.rows as any[]) console.log(JSON.stringify(x));
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
