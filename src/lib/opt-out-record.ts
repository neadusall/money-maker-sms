import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, conversations, suppressedNumbers } from "@/db/schema";

/**
 * Permanent global do-not-text, shared by every opt-out path (STOP keyword,
 * AI-classified stop, backlog triage). Lives apart from opt-out.ts because
 * that module is imported by client components and must stay db-free.
 *
 * The suppression write MUST be an upsert: the sender records a reason "sent"
 * row for the same (campaign, phone) the moment the first text goes out, so a
 * plain insert with onConflictDoNothing always collides with it and the
 * opt-out silently never reaches the ledger. That kept /api/kpi-stats reading
 * 0 opt-outs (it counts reason = 'opted_out') and left STOP numbers passing
 * the import screen (which also filters reason = 'opted_out'). Upgrading the
 * row in place, reason and createdAt both, records WHEN the person opted out,
 * which is what the windowed KPI needs.
 */
export async function recordOptOut(args: {
  campaignId: string;
  phone: string;
  /** When set, the conversation is routed to the opted_out inbox bucket. */
  conversationId?: string;
}): Promise<void> {
  // Opt out EVERY contact row with this number (across all campaigns), so no
  // current or future campaign can message it.
  await db
    .update(contacts)
    .set({ optedOut: true, status: "opted_out" })
    .where(eq(contacts.phone, args.phone));
  await db
    .insert(suppressedNumbers)
    .values({ campaignId: args.campaignId, phone: args.phone, reason: "opted_out" })
    .onConflictDoUpdate({
      target: [suppressedNumbers.campaignId, suppressedNumbers.phone],
      set: { reason: "opted_out", createdAt: new Date() },
    });
  if (args.conversationId) {
    await db
      .update(conversations)
      .set({ status: "opted_out" })
      .where(eq(conversations.id, args.conversationId));
  }
}
