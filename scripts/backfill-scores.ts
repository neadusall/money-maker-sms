import "dotenv/config";
import { eq, and, ne, isNull, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { contacts, campaigns, conversations, messages } from "../src/db/schema";
import { scoreCandidate } from "../src/lib/qualify";

/** Score fit (1-100) for existing interested candidates (replied, not opted out, unscored). */
async function main() {
  const rows = await db
    .select({ contact: contacts, campaign: campaigns, convoId: conversations.id })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .innerJoin(campaigns, eq(campaigns.id, conversations.campaignId))
    .where(
      and(
        isNull(contacts.qualificationScore),
        eq(contacts.optedOut, false),
        ne(conversations.status, "opted_out"),
        sql`exists (select 1 from messages m where m.conversation_id = ${conversations.id} and m.direction = 'inbound')`,
      ),
    );

  console.log(`Scoring ${rows.length} candidates...`);
  let done = 0;
  for (const r of rows) {
    const history = await db
      .select({ direction: messages.direction, body: messages.body })
      .from(messages)
      .where(eq(messages.conversationId, r.convoId))
      .orderBy(messages.createdAt);
    try {
      const sc = await scoreCandidate({ campaign: r.campaign, contact: r.contact, recentHistory: history });
      if (sc) {
        await db
          .update(contacts)
          .set({ qualificationScore: sc.score, qualificationReason: sc.reason })
          .where(eq(contacts.id, r.contact.id));
        const name = [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || r.contact.phone;
        console.log(`  ${String(sc.score).padStart(3)}  ${name} — ${sc.reason.slice(0, 70)}`);
        done++;
      }
    } catch (e) {
      console.error(`  ! ${r.contact.id}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`\nDone. Scored ${done}.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
