import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts, conversations, messages } from "@/db/schema";
import { classifyReply } from "./classify";
import { sentimentOf } from "./sentiment";
import { recordOptOut } from "./opt-out-record";

/**
 * Stats self-heal: triage inbound replies that never got classified, because
 * ANTHROPIC_API_KEY was missing/invalid when they arrived or the live classify
 * call failed. Without this, every such reply is invisible to the KPI tab's
 * reply mix, positive counts, and wrong-number counts forever.
 *
 * Runs on the internal clock in small batches. Deliberately triage-only: it
 * stamps the message and conversation classification and routes stop/negative
 * conversations, but never auto-replies, never opens to-dos, and never scores;
 * those side effects belong to the live inbound path where the reply is fresh.
 */

export const BACKLOG_WINDOW_MS = 90 * 24 * 3600_000;
// When the key is set but the API rejects it (or is down), do not burn a call
// every sweep forever: after a fully-failed batch, sleep the backlog.
const FAILURE_PAUSE_MS = 10 * 60_000;
let pausedUntil = 0;

export async function runClassifyBacklog(limit = 4): Promise<{ classified: number; failed: number; remaining: number }> {
  if (!(process.env.ANTHROPIC_API_KEY || "").trim()) return { classified: 0, failed: 0, remaining: 0 };
  if (Date.now() < pausedUntil) return { classified: 0, failed: 0, remaining: 0 };
  const cutoff = new Date(Date.now() - BACKLOG_WINDOW_MS);

  const rows = await db
    .select({ msg: messages, convo: conversations, contact: contacts, campaign: campaigns })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .innerJoin(campaigns, eq(campaigns.id, conversations.campaignId))
    .where(and(eq(messages.direction, "inbound"), isNull(messages.classification), gt(messages.createdAt, cutoff)))
    .orderBy(asc(messages.createdAt))
    .limit(limit);
  if (rows.length === 0) return { classified: 0, failed: 0, remaining: 0 };

  let classified = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const history = await db
        .select({ direction: messages.direction, body: messages.body })
        .from(messages)
        .where(eq(messages.conversationId, row.convo.id))
        .orderBy(desc(messages.createdAt))
        .limit(8);
      const classification = await classifyReply({
        campaign: row.campaign,
        inboundBody: row.msg.body,
        recentHistory: history.reverse(),
      });
      await db.update(messages).set({ classification: classification.label }).where(eq(messages.id, row.msg.id));
      await db.update(conversations).set({ classification: classification.label }).where(eq(conversations.id, row.convo.id));
      if (classification.label === "stop") {
        await recordOptOut({ campaignId: row.campaign.id, phone: row.contact.phone, conversationId: row.convo.id });
      } else if (sentimentOf(classification.label) === "negative" && row.convo.status === "active") {
        await db.update(conversations).set({ status: "closed" }).where(eq(conversations.id, row.convo.id));
      }
      classified++;
    } catch (err) {
      failed++;
      console.error(`[classify-backlog] message ${row.msg.id} failed:`, err);
    }
  }
  if (failed > 0 && classified === 0) pausedUntil = Date.now() + FAILURE_PAUSE_MS;

  const [rem] = (
    (await db.execute(sql`SELECT count(*)::int AS n FROM messages
      WHERE direction = 'inbound' AND classification IS NULL AND created_at > ${cutoff.toISOString()}`)) as { rows?: { n: number }[] }
  ).rows ?? [];
  return { classified, failed, remaining: Number(rem?.n ?? 0) };
}
