import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  await db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS todos_reviewed_at timestamptz`);
  console.log("ok: contacts.todos_reviewed_at ensured");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
