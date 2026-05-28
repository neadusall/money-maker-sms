import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  await db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS contacts_deleted_at_idx ON contacts (deleted_at) WHERE deleted_at IS NOT NULL`);
  console.log("ok: contacts.deleted_at + partial index ensured");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
