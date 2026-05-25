import "dotenv/config";
import { db } from "../src/db/client";
import { contacts, conversations, messages } from "../src/db/schema";
import { sql, eq } from "drizzle-orm";

async function main() {
  const contactAgg = await db.select({
    campaignId: contacts.campaignId,
    total: sql<number>`count(*)::int`,
    sent: sql<number>`count(*) filter (where ${contacts.status} in ('sent','delivered','replied'))::int`,
  }).from(contacts).groupBy(contacts.campaignId);
  console.log("CONTACT AGG:", JSON.stringify(contactAgg));

  const msgAgg = await db.select({
    campaignId: conversations.campaignId,
    inbound: sql<number>`count(*) filter (where ${messages.direction}='inbound')::int`,
    outbound: sql<number>`count(*) filter (where ${messages.direction}='outbound')::int`,
  }).from(messages).innerJoin(conversations, eq(conversations.id, messages.conversationId)).groupBy(conversations.campaignId);
  console.log("MSG AGG:", JSON.stringify(msgAgg));

  const convoAgg = await db.select({
    campaignId: conversations.campaignId,
    total: sql<number>`count(*)::int`,
    needsAttention: sql<number>`count(*) filter (where ${conversations.status}='needs_attention')::int`,
  }).from(conversations).groupBy(conversations.campaignId);
  console.log("CONVO AGG:", JSON.stringify(convoAgg));
  process.exit(0);
}
main();
