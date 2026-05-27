import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  await db.execute(sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scoring_error text`);
  console.log("ok: campaigns.scoring_error ensured");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
