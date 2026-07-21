import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  campaigns,
  contacts,
  conversations,
  messages,
  replyAlerts,
  type Campaign,
  type Contact,
} from "@/db/schema";
import { sendSms } from "./telnyx";
import { normalizePhone } from "./phone";

/**
 * Recruiter cell-phone alerts for candidate replies.
 *
 * The moment a candidate texts back, the campaign's recruiter gets an SMS on
 * their personal cell ("get in the tool and respond"), then one reminder
 * OSTEXT_ALERT_NAG_MINUTES later (default 30) if they still haven't replied
 * from the inbox, then one final reminder OSTEXT_ALERT_FINAL_HOURS after that
 * (default 24h) if there is still no reply. After that the alert goes quiet;
 * a new message from the candidate starts a fresh cycle. A human reply,
 * closing the conversation, or a candidate opt-out also retires the alert.
 *
 * Recipients per alert:
 *   - OSTEXT_ALERT_ALWAYS_CELL: one cell that gets EVERY alert regardless of
 *     campaign owner. Defaults to Ryan's cell; set to "off" to disable.
 *   - OSTEXT_ALERT_CELLS: per-recruiter map keyed by the campaign's
 *     recruiterEmail, e.g. "noah@lumesp.com=+15551230000,josh@lumesp.com=+15551231111".
 *
 * "Responded" means a real human reply: an outbound message sent after the
 * candidate's message while the conversation is in human takeover (which is
 * exactly what sending from the inbox sets). AI auto-replies never silence an
 * alert, and neither does merely opening the thread.
 */

// Ryan's cell. Overridable (or "off") via OSTEXT_ALERT_ALWAYS_CELL.
const DEFAULT_ALWAYS_CELL = "+19153737987";

// If the candidate double-texts, don't fire two instant alerts back to back.
const IMMEDIATE_DEBOUNCE_MS = 5 * 60_000;

function nagMinutes(): number {
  const n = Number(process.env.OSTEXT_ALERT_NAG_MINUTES);
  return Number.isFinite(n) && n >= 5 ? n : 30;
}

/** Parse "email=+1555...,email2=+1555..." into a lowercase-email -> E.164 map. */
export function parseCellMap(raw: string | undefined | null): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of (raw ?? "").split(/[,;\n]/)) {
    const idx = pair.indexOf("=");
    if (idx < 1) continue;
    const email = pair.slice(0, idx).trim().toLowerCase();
    const cell = normalizePhone(pair.slice(idx + 1).trim());
    if (email && cell) map[email] = cell;
  }
  return map;
}

/** Cells to alert for a campaign: the always-on cell plus the owner's mapped cell. */
export function alertRecipients(recruiterEmail: string | null | undefined): string[] {
  const out: string[] = [];

  const always = (process.env.OSTEXT_ALERT_ALWAYS_CELL ?? DEFAULT_ALWAYS_CELL).trim();
  if (always && always.toLowerCase() !== "off") {
    const n = normalizePhone(always);
    if (n) out.push(n);
  }

  const email = (recruiterEmail ?? "").trim().toLowerCase();
  if (email) {
    const mapped = parseCellMap(process.env.OSTEXT_ALERT_CELLS)[email];
    if (mapped) out.push(mapped);
  }

  return [...new Set(out)];
}

function candidateName(contact: Contact): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.phone;
}

/** "5 min" / "3 hours" / "2 days": how long the candidate has been waiting. */
function waitingLabel(sinceMs: number): string {
  const mins = Math.max(1, Math.round(sinceMs / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

function snippet(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3)}...`;
}

async function deliver(args: {
  recipients: string[];
  body: string;
  fromNumber: string | null;
}): Promise<boolean> {
  let anyOk = false;
  for (const to of args.recipients) {
    const res = await sendSms({
      to,
      body: args.body,
      from: args.fromNumber ?? undefined,
      internal: true,
    });
    if (res.ok) anyOk = true;
    else console.warn(`[reply-alerts] send to ${to} failed: ${res.error}`);
  }
  return anyOk;
}

/**
 * Called from recordInbound on every non-STOP candidate reply: (re)open the
 * alert for this conversation and text the recruiter immediately.
 */
export async function recordReplyAlert(args: {
  campaign: Campaign;
  contact: Contact;
  conversationId: string;
  inboundBody: string;
  inboundAt?: Date;
}): Promise<void> {
  const { campaign, contact, conversationId, inboundBody } = args;
  const recipients = alertRecipients(campaign.recruiterEmail);
  if (recipients.length === 0) return;

  const inboundAt = args.inboundAt ?? new Date();

  const [existing] = await db
    .select()
    .from(replyAlerts)
    .where(eq(replyAlerts.conversationId, conversationId))
    .limit(1);

  // A previously-resolved alert re-opening for a new candidate message starts
  // a fresh cycle: the send cap (instant + one reminder) counts from zero.
  const freshCycle = Boolean(existing?.resolvedAt);
  if (existing) {
    await db
      .update(replyAlerts)
      .set({
        lastInboundAt: inboundAt,
        resolvedAt: null,
        ...(freshCycle ? { alertCount: 0 } : {}),
      })
      .where(eq(replyAlerts.id, existing.id));
  } else {
    await db
      .insert(replyAlerts)
      .values({ conversationId, lastInboundAt: inboundAt })
      .onConflictDoUpdate({
        target: replyAlerts.conversationId,
        set: { lastInboundAt: inboundAt, resolvedAt: null },
      });
  }

  // Debounce: an open alert texted minutes ago doesn't need a second instant
  // ping for a double-text. The clock's reminder covers the follow-up.
  const recentlyAlerted =
    existing &&
    !existing.resolvedAt &&
    existing.lastAlertAt &&
    Date.now() - existing.lastAlertAt.getTime() < IMMEDIATE_DEBOUNCE_MS;
  if (recentlyAlerted) return;

  // No links or platform names in the alert: just who replied and what they
  // said, so the text can never leak a tool URL.
  const body =
    `New reply: ${candidateName(contact)} (${campaign.name}) said "${snippet(inboundBody)}". ` +
    `They are waiting on you. Get in the tool and respond.`;

  const sent = await deliver({ recipients, body, fromNumber: campaign.fromNumber });
  if (sent) {
    const priorCount = freshCycle ? 0 : (existing?.alertCount ?? 0);
    await db
      .update(replyAlerts)
      .set({ lastAlertAt: new Date(), alertCount: priorCount + 1 })
      .where(eq(replyAlerts.conversationId, conversationId));
    console.log(`[reply-alerts] alerted ${recipients.join(", ")} for conversation ${conversationId}`);
  }
}

/**
 * Clock sweep: send the follow-up reminders for alerts still unanswered, and
 * retire alerts that got a human reply (or whose conversation was closed /
 * opted out). Also catches alerts whose instant text failed to send
 * (lastAlertAt null). Each cycle sends at most MAX_SENDS_PER_CYCLE texts:
 * the instant alert, one reminder after the nag interval (default 30 min),
 * and one final reminder OSTEXT_ALERT_FINAL_HOURS after that (default 24h)
 * if the recruiter still hasn't replied. Then the alert retires quietly.
 */
const MAX_SENDS_PER_CYCLE = 3;

function finalReminderMs(): number {
  const h = Number(process.env.OSTEXT_ALERT_FINAL_HOURS);
  return (Number.isFinite(h) && h >= 1 ? h : 24) * 3_600_000;
}
export async function sweepReplyAlerts(): Promise<{ nagged: number; resolved: number }> {
  const cutoff = new Date(Date.now() - nagMinutes() * 60_000);
  const due = await db
    .select({ alert: replyAlerts, convo: conversations, contact: contacts, campaign: campaigns })
    .from(replyAlerts)
    .innerJoin(conversations, eq(conversations.id, replyAlerts.conversationId))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .innerJoin(campaigns, eq(campaigns.id, conversations.campaignId))
    .where(
      and(
        isNull(replyAlerts.resolvedAt),
        or(isNull(replyAlerts.lastAlertAt), lte(replyAlerts.lastAlertAt, cutoff)),
      ),
    )
    .limit(50);

  let nagged = 0;
  let resolved = 0;

  for (const { alert, convo, contact, campaign } of due) {
    const retire = async () => {
      await db.update(replyAlerts).set({ resolvedAt: new Date() }).where(eq(replyAlerts.id, alert.id));
      resolved++;
    };

    // Conversation no longer needs a human: closed by the recruiter or the
    // candidate opted out.
    if (convo.status === "closed" || convo.status === "opted_out" || contact.optedOut) {
      await retire();
      continue;
    }

    // The recruiter replied: an outbound message after the candidate's last
    // message, in human takeover (sending from the inbox sets takeover; AI
    // auto-replies never run while takeover is on, so this outbound is human).
    if (convo.humanTakeover) {
      const [humanReply] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, convo.id),
            eq(messages.direction, "outbound"),
            gt(messages.createdAt, alert.lastInboundAt),
          ),
        )
        .limit(1);
      if (humanReply) {
        await retire();
        continue;
      }
    }

    // All sends done (instant + 30-min reminder + 24h final reminder): go
    // quiet. A new candidate message re-opens the alert with a fresh cycle.
    if (alert.alertCount >= MAX_SENDS_PER_CYCLE) {
      await retire();
      continue;
    }

    // The last send of a cycle waits the long interval: after the 30-min
    // reminder, hold off OSTEXT_ALERT_FINAL_HOURS before the final text.
    const isFinal = alert.alertCount === MAX_SENDS_PER_CYCLE - 1;
    if (
      isFinal &&
      alert.lastAlertAt &&
      Date.now() - alert.lastAlertAt.getTime() < finalReminderMs()
    ) {
      continue;
    }

    const recipients = alertRecipients(campaign.recruiterEmail);
    if (recipients.length === 0) {
      // Nobody configured to remind: park the alert instead of looping forever.
      await retire();
      continue;
    }

    const body =
      `${isFinal ? "Final reminder" : "Reminder"}: ${candidateName(contact)} (${campaign.name}) replied ${waitingLabel(Date.now() - alert.lastInboundAt.getTime())} ago ` +
      `and still has no response from you. Get in the tool and reply.`;

    const sent = await deliver({ recipients, body, fromNumber: campaign.fromNumber });
    if (sent) {
      await db
        .update(replyAlerts)
        .set({ lastAlertAt: new Date(), alertCount: alert.alertCount + 1 })
        .where(eq(replyAlerts.id, alert.id));
      nagged++;
    }
  }

  return { nagged, resolved };
}
