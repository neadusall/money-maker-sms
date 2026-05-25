import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  await db.execute(sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sales_nav_url text`);
  await db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS qualification_score integer`);
  await db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS qualification_reason text`);
  console.log("ok: sales_nav_url + qualification_score/reason ensured");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
