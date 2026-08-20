import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Boot-time DDL for the iMessage lane, idempotent, called from instrumentation.
 *
 * This project applies schema changes as boot-time `ADD COLUMN IF NOT EXISTS` (see
 * `ensureTenantSchema`) rather than through generated migration files, so a deploy needs no
 * separate migration step. Every statement here is safe to run on every boot and safe to
 * run against a database that already has the columns.
 *
 * ORDERING MATTERS: these must land before any page renders or any send runs, because the
 * lane router, the comparison query, and the thread view all read them. A missing column
 * would take the whole app down, not just the new lane.
 */
export async function ensureLaneSchema(): Promise<void> {
  // Enum types first: a column referencing a missing type fails.
  await db.execute(sql`DO $$ BEGIN
    CREATE TYPE message_provider AS ENUM ('telnyx', 'imessage');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await db.execute(sql`DO $$ BEGIN
    CREATE TYPE campaign_channel AS ENUM ('sms', 'imessage', 'auto');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  // 'uncertain' status: the bridge timed out AFTER Messages.app may already have sent.
  // ADD VALUE IF NOT EXISTS is idempotent and, unlike most ALTER TYPE work, safe to run
  // inside the normal boot path.
  await db.execute(sql`ALTER TYPE message_status ADD VALUE IF NOT EXISTS 'uncertain'`);

  // messages: which wire carried it, plus the bridge's own message id.
  // The 'telnyx' default is what keeps years of existing SMS history correctly labeled
  // without a backfill pass - every pre-existing row IS a Telnyx SMS.
  await db.execute(
    sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider message_provider NOT NULL DEFAULT 'telnyx'`,
  );
  await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS bluebubbles_guid text`);
  // The reconcile sweep and the webhook dedupe both look messages up by GUID.
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS messages_bluebubbles_guid_idx ON messages (bluebubbles_guid)`,
  );
  // The lane comparison groups by provider over a date window on every dashboard load.
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS messages_provider_idx ON messages (provider, created_at)`,
  );

  // campaigns: lane choice + the day-spreading controls.
  await db.execute(
    sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS channel campaign_channel NOT NULL DEFAULT 'sms'`,
  );
  await db.execute(sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS daily_cap integer`);
  await db.execute(sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ramp_start integer`);
  await db.execute(sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ramp_step integer`);

  // The iMessage capability cache. A hint for routing, never an oracle: availability checks
  // have documented false negatives, so NULL (unknown) is a real state and unknowns route
  // to Telnyx unless policy opts them in.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS handle_capabilities (
    phone text PRIMARY KEY,
    imessage boolean,
    checked_at timestamptz NOT NULL DEFAULT now()
  )`);
}
