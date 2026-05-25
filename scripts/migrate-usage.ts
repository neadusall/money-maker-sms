import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS usage_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL,
      model text,
      purpose text,
      input_tokens integer NOT NULL DEFAULT 0,
      output_tokens integer NOT NULL DEFAULT 0,
      cost_usd double precision NOT NULL DEFAULT 0,
      campaign_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS usage_events_created_idx ON usage_events (created_at);`);
  console.log("ok: usage_events ensured");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
