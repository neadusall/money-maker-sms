import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  await db.execute(sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_region text`);
  await db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS location_region text`);
  await db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS location_match boolean`);
  console.log("ok: target_region + location_region + location_match ensured");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
