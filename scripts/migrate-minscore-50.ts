import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  await db.execute(sql`ALTER TABLE campaigns ALTER COLUMN min_score_to_send SET DEFAULT 50`);
  const res = await db.execute(
    sql`UPDATE campaigns
        SET min_score_to_send = 50
        WHERE min_score_to_send IS NULL OR min_score_to_send <= 65`,
  );
  console.log(`ok: default set to 50; campaigns moved to 50: ${res.rowCount ?? "?"}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
