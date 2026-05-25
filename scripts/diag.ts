import "dotenv/config";
import { db } from "../src/db/client";
import { campaigns, contacts, messages, conversations } from "../src/db/schema";
import { desc, eq } from "drizzle-orm";

async function main() {
  const tz = process.env.APP_TIMEZONE ?? "America/New_York";
  const now = new Date();
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).format(now);
  console.log(`\n=== TIME ===`);
  console.log(`UTC now:      ${now.toISOString()}`);
  console.log(`APP_TIMEZONE: ${tz}`);
  console.log(`Local now:    ${local}`);

  const camps = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt));
  console.log(`\n=== CAMPAIGNS (${camps.length}) ===`);
  for (const c of camps) {
    console.log(`\n[${c.name}] id=${c.id}`);
    console.log(`  status=${c.status} mode=${c.llmMode} window=${c.sendWindowStart}-${c.sendWindowEnd} from=${c.fromNumber ?? "(env default)"}`);

    const cs = await db.select().from(contacts).where(eq(contacts.campaignId, c.id));
    const byStatus: Record<string, number> = {};
    for (const ct of cs) byStatus[ct.status] = (byStatus[ct.status] ?? 0) + 1;
    console.log(`  contacts: ${cs.length} ` + JSON.stringify(byStatus));
    for (const ct of cs) {
      console.log(`    - ${ct.firstName ?? ""} ${ct.phone} status=${ct.status} optedOut=${ct.optedOut} err=${ct.lastError ?? ""}`);
    }
  }

  const recentMsgs = await db
    .select()
    .from(messages)
    .orderBy(desc(messages.createdAt))
    .limit(10);
  console.log(`\n=== RECENT MESSAGES (${recentMsgs.length}) ===`);
  for (const m of recentMsgs) {
    console.log(`  ${m.createdAt.toISOString()} ${m.direction} status=${m.status} class=${m.classification ?? ""} telnyx=${m.telnyxId ?? ""} err=${m.error ?? ""}`);
    console.log(`    body: ${m.body.slice(0, 70)}`);
  }

  const convos = await db.select().from(conversations).orderBy(desc(conversations.lastMessageAt)).limit(10);
  console.log(`\n=== CONVERSATIONS (${convos.length}) ===`);
  for (const cv of convos) {
    console.log(`  id=${cv.id} status=${cv.status} class=${cv.classification ?? ""} unread=${cv.unreadCount}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
