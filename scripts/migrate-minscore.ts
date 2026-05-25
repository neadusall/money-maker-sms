import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  await db.execute(sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS min_score_to_send integer`);
  console.log("ok: campaigns.min_score_to_send ensured");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
