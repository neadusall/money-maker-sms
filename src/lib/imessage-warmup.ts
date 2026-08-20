import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { messages, conversations, contacts } from "@/db/schema";

/**
 * Warm-up + hard sending limits for the iMessage lane (the owner's personal
 * Apple line through the BlueBubbles Mac bridge).
 *
 * The ceilings are HARD-CODED to the per-line limits Sendblue publishes for
 * its commercial iMessage service (docs.sendblue.com/limits): 50 NEW contacts
 * per line per day and 15 new contacts per rolling hour, where a "new
 * contact" is someone with no conversation in either direction in the last
 * 30 days. Sendblue operates the largest legitimate iMessage fleet in
 * existence, so their numbers are the best public signal of what Apple
 * tolerates from one line — env config may LOWER these, never raise them.
 *
 * On top of the ceilings sits a warm-up ramp. Carrier and iMessage guidance
 * agree a fresh line must earn volume gradually over 2-3 weeks (Kixie,
 * DailyStory, PhoneBurner all document ramp-don't-jump for new numbers; the
 * iMessage ecosystem guidance is start ~20-30/day AFTER the first week).
 * Day 1 of the ramp is the line's first iMessage send through OS Text, read
 * from the messages table — no clock to configure, and a line that has been
 * quietly texting for a month arrives already warm.
 *
 * What deliberately does NOT count against any cap: replies and follow-ups
 * inside a conversation that had activity (either direction) in the last 30
 * days. Two-way conversation is what builds a line's reputation — throttling
 * replies would make the line look WORSE, and Sendblue's own accounting
 * exempts them for the same reason.
 */

export const IMESSAGE_HARD_DAILY_CEILING = 50;
export const IMESSAGE_HARD_HOURLY_CEILING = 15;

// Days are 1-based since the line's first iMessage send. Each entry applies
// from its day until the next entry takes over.
export const WARMUP_SCHEDULE: ReadonlyArray<{ fromDay: number; cap: number }> = [
  { fromDay: 1, cap: 5 },   // days 1-3: introductions only
  { fromDay: 4, cap: 10 },  // rest of week 1
  { fromDay: 8, cap: 20 },  // week 2: the "start 20-30/day" band
  { fromDay: 15, cap: 35 }, // week 3
  { fromDay: 22, cap: IMESSAGE_HARD_DAILY_CEILING }, // fully warm
];

/** Daily new-contact cap for a line N days into its life (N is 1-based). */
export function warmupDailyCap(daysSinceFirstSend: number): number {
  if (process.env.OSTEXT_IMESSAGE_WARMUP === "off") return IMESSAGE_HARD_DAILY_CEILING;
  let cap = WARMUP_SCHEDULE[0].cap;
  for (const step of WARMUP_SCHEDULE) {
    if (daysSinceFirstSend >= step.fromDay) cap = step.cap;
  }
  return cap;
}

/**
 * Rolling-hour cap scaled to the day's budget (~30%, the same ratio as
 * Sendblue's 15-per-hour against 50-per-day), so a cold line can't burn its
 * whole daily allowance in one burst — bursts are the classic flag trigger.
 */
export function hourlyCap(dailyCap: number): number {
  return Math.min(IMESSAGE_HARD_HOURLY_CEILING, Math.max(2, Math.round(dailyCap * 0.3)));
}

export type ImessageGate = { allowed: true; reason: "engaged" | "budget" } | { allowed: false; reason: string };

/** Any conversation activity (either direction, any provider) with this
 *  number in the last 30 days = an engaged contact, exempt from caps. */
async function isEngagedContact(toE164: string): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(and(eq(contacts.phone, toE164), gte(messages.createdAt, new Date(Date.now() - 30 * 86_400_000))))
    .limit(1);
  return Boolean(row);
}

/** 1-based day number of the line's life; day 1 until the first send exists. */
async function lineAgeDays(): Promise<number> {
  const r = (await db.execute(sql`
    SELECT min(created_at) AS first_at FROM messages
    WHERE provider = 'imessage' AND direction = 'outbound'
  `)) as { rows?: { first_at?: unknown }[] };
  const first = (r.rows ?? [])[0]?.first_at;
  if (!first) return 1;
  return Math.floor((Date.now() - new Date(first as string).getTime()) / 86_400_000) + 1;
}

/** New-contact sends in a window = conversations whose FIRST-ever outbound
 *  iMessage happened inside it. Later messages in the same thread are the
 *  engaged-contact traffic the caps deliberately ignore. */
async function newContactOpens(windowMs: number): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const r = (await db.execute(sql`
    SELECT count(*)::int AS n FROM (
      SELECT conversation_id, min(created_at) AS first_at
      FROM messages
      WHERE provider = 'imessage' AND direction = 'outbound'
      GROUP BY conversation_id
    ) t
    WHERE t.first_at >= ${since}
  `)) as { rows?: { n?: unknown }[] };
  return Number((r.rows ?? [])[0]?.n ?? 0);
}

/**
 * May the iMessage lane take this recipient right now? A `false` is never an
 * error — the router just sends via Telnyx instead, and tomorrow's budget
 * picks up where the ramp left off.
 */
export async function imessageSendAllowed(toE164: string): Promise<ImessageGate> {
  if (await isEngagedContact(toE164)) return { allowed: true, reason: "engaged" };

  const envCap = Number(process.env.OSTEXT_IMESSAGE_DAILY_CAP);
  const configured = Number.isFinite(envCap) && envCap > 0 ? envCap : IMESSAGE_HARD_DAILY_CEILING;
  const dailyCap = Math.min(
    IMESSAGE_HARD_DAILY_CEILING, // env may lower, never raise
    configured,
    warmupDailyCap(await lineAgeDays()),
  );

  const sentToday = await newContactOpens(24 * 60 * 60 * 1000);
  if (sentToday >= dailyCap) {
    return { allowed: false, reason: `daily new-contact cap reached (${sentToday}/${dailyCap})` };
  }
  const sentThisHour = await newContactOpens(60 * 60 * 1000);
  const hCap = hourlyCap(dailyCap);
  if (sentThisHour >= hCap) {
    return { allowed: false, reason: `hourly new-contact cap reached (${sentThisHour}/${hCap})` };
  }
  return { allowed: true, reason: "budget" };
}
