import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  // Propagate opt-out to ALL rows of any phone that has opted out anywhere.
  const r = await db.execute(sql`
    UPDATE contacts SET opted_out=true, status='opted_out'
    WHERE opted_out=false AND phone IN (SELECT DISTINCT phone FROM contacts WHERE opted_out=true)`);
  console.log(`propagated opt-out to ${r.rowCount ?? 0} additional rows`);
  const tot = await db.execute(sql`SELECT count(distinct phone)::int n FROM contacts WHERE opted_out=true`);
  console.log(`total opted-out numbers (global do-not-text): ${(tot.rows[0] as any).n}`);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
