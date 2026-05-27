import "dotenv/config";
import { sql } from "drizzle-orm";
import { Client } from "@upstash/qstash";
import { db } from "../src/db/client";

// Prod app URL (local .env AUTH_URL is a stale ngrok host, so be explicit).
const PROD = "https://money-maker.87.99.144.161.sslip.io";

async function main() {
  // A real score is always >= 1 (the scorer clamps to 1..100), so score = 0 only
  // ever means the old "could not score" failure. Reset those to null so the
  // fixed, paced drain re-scores them.
  const reset = await db.execute(
    sql`UPDATE contacts
        SET qualification_score = NULL, qualification_reason = NULL
        WHERE qualification_score = 0`,
  );
  console.log(`reset to unscored: ${reset.rowCount ?? "?"}`);

  // Find campaigns that now have unscored, non-opted-out contacts.
  const camps = await db.execute(sql`
    SELECT campaign_id, count(*)::int AS n
    FROM contacts
    WHERE qualification_score IS NULL AND opted_out = false
    GROUP BY campaign_id`);

  const qstash = new Client({ token: process.env.QSTASH_TOKEN! });
  for (const row of camps.rows as { campaign_id: string; n: number }[]) {
    await qstash.publishJSON({
      url: `${PROD}/api/qstash/score-drain`,
      body: { campaignId: row.campaign_id, stall: 0 },
    });
    console.log(`enqueued score-drain for ${row.campaign_id} (${row.n} to score)`);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
