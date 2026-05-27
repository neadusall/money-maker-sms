import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  await db.execute(
    sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at timestamptz`,
  );
  console.log("ok: campaigns.scheduled_at ensured");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
