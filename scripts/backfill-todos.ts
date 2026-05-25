import "dotenv/config";
import { eq, and, ne, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { conversations, contacts, campaigns } from "../src/db/schema";
import { syncTodosForConversation } from "../src/lib/todos";

/**
 * Deep-dive every existing conversation that has correspondence and is not
 * negative/opted-out, and generate the recruiter's open follow-up to-dos.
 * Idempotent: re-running won't duplicate (upsert on conversation + dedupe_key).
 */
async function main() {
  const rows = await db
    .select({ convo: conversations, contact: contacts, campaign: campaigns })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .innerJoin(campaigns, eq(campaigns.id, conversations.campaignId))
    // Skip opted-out and closed (negative) threads — only interested/neutral —
    // and only those where the candidate actually replied.
    .where(
      and(
        ne(conversations.status, "opted_out"),
        ne(conversations.status, "closed"),
        sql`exists (select 1 from messages m where m.conversation_id = ${conversations.id} and m.direction = 'inbound')`,
      ),
    );

  console.log(`Scanning ${rows.length} conversations...`);
  let totalAdded = 0;
  let withTodos = 0;
  let processed = 0;

  for (const r of rows) {
    if (r.contact.optedOut) continue;
    try {
      const added = await syncTodosForConversation({
        campaign: r.campaign,
        contact: r.contact,
        conversationId: r.convo.id,
      });
      if (added > 0) {
        withTodos++;
        totalAdded += added;
        const name = [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || r.contact.phone;
        console.log(`  +${added}  ${name}`);
      }
    } catch (e) {
      console.error(`  ! ${r.convo.id}:`, e instanceof Error ? e.message : e);
    }
    processed++;
    if (processed % 25 === 0) console.log(`  ...${processed}/${rows.length}`);
  }

  console.log(`\nDone. ${totalAdded} to-dos added across ${withTodos} candidates.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
