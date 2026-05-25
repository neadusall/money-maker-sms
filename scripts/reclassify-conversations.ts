import "dotenv/config";
import { eq, asc } from "drizzle-orm";
import { db } from "../src/db/client";
import { conversations, contacts, messages, suppressedNumbers } from "../src/db/schema";
import { isStopKeyword } from "../src/lib/opt-out";

/**
 * One-time cleanup of existing conversation statuses to match the new inbox model:
 *  - Said STOP (keyword anywhere, or classified "stop", or already opted out) -> opted_out
 *    (also flips the contact to opted_out + adds to suppression so we never re-text them).
 *  - Replied with a NEGATIVE sentiment (not interested / wrong person / etc.) -> closed
 *  - Replied positively/neutrally and the LAST message is theirs (awaiting Ryan) -> needs_attention
 *  - Replied positively/neutrally and Ryan/AI replied last -> active
 *  - Never replied -> left as-is (the inbox will filter these out as "no correspondence yet")
 * The always-allow / seed number (Ryan's own) is never opted out.
 */
const NEGATIVE = new Set(["negative", "not_interested", "wrong_person", "already_employed"]);

function digits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

async function main() {
  const alwaysAllow = new Set(
    [process.env.SEED_CONTACT_PHONE ?? "", ...(process.env.ALWAYS_ALLOW_NUMBERS ?? "").split(",")]
      .map(digits)
      .filter(Boolean),
  );

  const convos = await db.select().from(conversations);
  const counts: Record<string, number> = { opted_out: 0, needs_attention: 0, active: 0, closed: 0, no_reply: 0 };
  let newlyOptedOut = 0;

  for (const c of convos) {
    const msgs = await db
      .select({ direction: messages.direction, body: messages.body })
      .from(messages)
      .where(eq(messages.conversationId, c.id))
      .orderBy(asc(messages.createdAt));
    const inbound = msgs.filter((m) => m.direction === "inbound");
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, c.contactId));
    const isAlways = contact ? alwaysAllow.has(digits(contact.phone)) : false;

    const saidStop = inbound.some((m) => isStopKeyword(m.body)) || c.classification === "stop";

    let status: "opted_out" | "needs_attention" | "active" | "closed" | null = null;

    if (!isAlways && (saidStop || contact?.optedOut)) {
      status = "opted_out";
      if (contact && !contact.optedOut) {
        await db.update(contacts).set({ optedOut: true, status: "opted_out" }).where(eq(contacts.id, contact.id));
        newlyOptedOut++;
      }
      if (contact) {
        await db
          .insert(suppressedNumbers)
          .values({ campaignId: c.campaignId, phone: contact.phone, reason: "opted_out" })
          .onConflictDoNothing({ target: [suppressedNumbers.campaignId, suppressedNumbers.phone] });
      }
    } else if (inbound.length === 0) {
      counts.no_reply++; // leave conversation status untouched
    } else if (NEGATIVE.has(c.classification ?? "")) {
      status = "closed";
    } else {
      const last = msgs[msgs.length - 1];
      status = last && last.direction === "inbound" ? "needs_attention" : "active";
    }

    if (status) {
      await db.update(conversations).set({ status }).where(eq(conversations.id, c.id));
      counts[status]++;
    }
  }

  console.log("Reclassified:", JSON.stringify(counts));
  console.log("Newly opted out (said STOP but weren't flagged):", newlyOptedOut);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
