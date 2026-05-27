import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  // New campaigns default to a 60 fit bar.
  await db.execute(
    sql`ALTER TABLE campaigns ALTER COLUMN min_score_to_send SET DEFAULT 60`,
  );
  // Move existing campaigns to the 60 bar: anything unset, or sitting at the
  // prior 65 default, or below 60, becomes 60. (Leave a stricter custom bar > 60.)
  const res = await db.execute(
    sql`UPDATE campaigns
        SET min_score_to_send = 60
        WHERE min_score_to_send IS NULL OR min_score_to_send <= 65`,
  );
  console.log(`ok: default set to 60; campaigns moved to 60: ${res.rowCount ?? "?"}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
