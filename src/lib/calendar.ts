import nodemailer from "nodemailer";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./anthropic";
import { recordLlmUsage } from "./usage";

// Calendar invites go out over the same (working) SMTP used for login emails.
export function isCalendarConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

// Cheap pre-filter so we only spend an LLM call on replies that plausibly
// propose a time (most replies don't).
const TIME_HINT =
  /\b(\d{1,2}\s*(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)|\d{1,2}:\d{2}|today|tonight|tomorrow|mon(day)?|tues?(day)?|wed(nesday)?|thur?s?(day)?|fri(day)?|sat(urday)?|sun(day)?|morning|afternoon|evening|noon|call me|my cell|give me a call|free at|available)\b/i;

export function mightProposeTime(text: string): boolean {
  return TIME_HINT.test(text);
}

// Either a concrete date+time (→ calendar invite) or a day-only mention like
// "next Tuesday" / "Friday" (→ a highlighted To-do reminder, since there's no
// exact time to book).
export type Schedule =
  | { kind: "time"; startISO: string; durationMin: number; summary: string }
  | { kind: "day"; label: string };

/** Use a cheap model to pull a proposed time OR day out of a free-text reply. */
export async function extractMeeting(
  text: string,
  opts: { nowISO: string; tz: string },
): Promise<Schedule | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const system = `You read a candidate's SMS reply and decide if they proposed when to talk.
Right now it is ${opts.nowISO}. Default timezone if none stated: ${opts.tz}.
Output ONLY JSON, no prose: {"kind":"time"|"day"|"none","startISO":"<ISO8601 w/ offset>"|null,"durationMin":<int>,"label":"<short human label>","summary":"<short>"}.
- "time": they gave a CONCRETE date AND clock time (e.g. "4pm EST today", "Tuesday at 2"). Resolve to an absolute FUTURE datetime in startISO (honor any timezone they state, else default). durationMin defaults 30.
- "day": they named a specific day but NO clock time (e.g. "next Tuesday", "Friday", "tomorrow" with no time). Put a short human label in "label" (e.g. "Tuesday Jun 3").
- "none": vague or no scheduling ("sometime next week", "let me check", no day at all).`;
  try {
    const r = await anthropic().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system,
      messages: [{ role: "user", content: text }],
    });
    await recordLlmUsage({ model: "claude-haiku-4-5-20251001", usage: r.usage, purpose: "calendar" });
    const out = r.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const s = out.indexOf("{");
    const e = out.lastIndexOf("}");
    if (s === -1 || e === -1) return null;
    const obj = JSON.parse(out.slice(s, e + 1)) as {
      kind?: unknown;
      startISO?: unknown;
      durationMin?: unknown;
      label?: unknown;
      summary?: unknown;
    };
    if (obj.kind === "time" && obj.startISO) {
      const start = new Date(String(obj.startISO));
      if (isNaN(start.getTime()) || start.getTime() < Date.now() - 5 * 60_000) {
        // Concrete time but already past / unparseable — treat the day as a reminder.
        return obj.label ? { kind: "day", label: String(obj.label).slice(0, 60) } : null;
      }
      return {
        kind: "time",
        startISO: start.toISOString(),
        durationMin: Number(obj.durationMin) > 0 ? Math.min(240, Number(obj.durationMin)) : 30,
        summary: String(obj.summary ?? "").slice(0, 120),
      };
    }
    if (obj.kind === "day" && obj.label) {
      return { kind: "day", label: String(obj.label).slice(0, 60) };
    }
    return null;
  } catch {
    return null;
  }
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function esc(s: string): string {
  return s.replace(/([\\,;])/g, "\\$1").replace(/\n/g, "\\n");
}

/** Email an .ics invite to `to`; Gmail auto-adds it to that calendar. */
export async function sendCalendarInvite(args: {
  to: string;
  summary: string;
  start: Date;
  durationMin: number;
  description: string;
  location: string;
}): Promise<boolean> {
  if (!isCalendarConfigured()) return false;
  const end = new Date(args.start.getTime() + args.durationMin * 60_000);
  const uid = `mm-${args.start.getTime()}-${Math.random().toString(36).slice(2, 8)}@money-maker`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//money-maker-sms//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(args.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${esc(args.summary)}`,
    `DESCRIPTION:${esc(args.description)}`,
    `LOCATION:${esc(args.location)}`,
    `ORGANIZER;CN=Recruiter:mailto:${args.to}`,
    `ATTENDEE;CN=Recruiter;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${args.to}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "TRIGGER:-PT10M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: args.to,
    subject: `📅 ${args.summary}`,
    text: args.description,
    icalEvent: { method: "REQUEST", filename: "invite.ics", content: ics },
  });
  return true;
}
