import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS campaign_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL UNIQUE,
      llm_mode llm_mode NOT NULL DEFAULT 'draft_only',
      sms_template text NOT NULL,
      position_summary text,
      recruiter_name text,
      recruiter_email text,
      calendar_link text,
      send_window_start text NOT NULL DEFAULT '09:00',
      send_window_end text NOT NULL DEFAULT '19:00',
      target_region text,
      min_score_to_send integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  console.log("ok: campaign_templates ensured");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
