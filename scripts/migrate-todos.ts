import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  await db.execute(sql`DO $$ BEGIN CREATE TYPE todo_channel AS ENUM ('sms','email','linkedin','call','other'); EXCEPTION WHEN duplicate_object THEN null; END $$;`);
  await db.execute(sql`DO $$ BEGIN CREATE TYPE todo_status AS ENUM ('open','done'); EXCEPTION WHEN duplicate_object THEN null; END $$;`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS todos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
      action text NOT NULL,
      channel todo_channel NOT NULL DEFAULT 'other',
      detail text,
      status todo_status NOT NULL DEFAULT 'open',
      source text NOT NULL DEFAULT 'ai',
      dedupe_key text,
      created_at timestamptz NOT NULL DEFAULT now(),
      done_at timestamptz
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS todos_status_idx ON todos (status, created_at);`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS todos_conversation_dedupe_unique ON todos (conversation_id, dedupe_key);`);
  console.log("ok: todos table + enums ensured");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
