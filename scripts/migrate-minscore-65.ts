import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  // New campaigns default to a 65 fit bar.
  await db.execute(
    sql`ALTER TABLE campaigns ALTER COLUMN min_score_to_send SET DEFAULT 65`,
  );
  // Raise existing campaigns to a 65 floor (leave any already stricter alone).
  const res = await db.execute(
    sql`UPDATE campaigns
        SET min_score_to_send = 65
        WHERE min_score_to_send IS NULL OR min_score_to_send < 65`,
  );
  console.log(`ok: default set to 65; campaigns raised to >=65: ${res.rowCount ?? "?"}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
