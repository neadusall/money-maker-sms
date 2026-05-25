import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  await db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS enriched_profile jsonb`);
  await db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS enriched_at timestamptz`);
  console.log("ok: contacts.enriched_profile + enriched_at ensured");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
