import nodemailer from "nodemailer";
import type { Campaign, Contact } from "@/db/schema";

/**
 * Auto-emails a candidate the full position details when they reply to the SMS
 * outreach with their email address. Sent from a dedicated mailbox (e.g.
 * ryan@tal.co) configured separately from the auth/magic-link mailer.
 *
 * Env:
 *   POSITION_EMAIL_USER  — SMTP username / mailbox (e.g. ryan@tal.co)
 *   POSITION_EMAIL_PASS  — SMTP password (Google Workspace: an App Password)
 *   POSITION_EMAIL_FROM  — From header (default: POSITION_EMAIL_USER)
 *   POSITION_EMAIL_HOST  — SMTP host (default: smtp.gmail.com)
 *   POSITION_EMAIL_PORT  — SMTP port (default: 465)
 */
export function isPositionEmailConfigured(): boolean {
  return Boolean(process.env.POSITION_EMAIL_USER && process.env.POSITION_EMAIL_PASS);
}

// Conservative email matcher — first plausible address in the message body.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function extractEmail(text: string): string | null {
  const m = text.match(EMAIL_RE);
  if (!m) return null;
  // Strip trailing punctuation a user might type after the address.
  return m[0].replace(/[.,;:>)\]]+$/, "").toLowerCase();
}

/** Subject = the first non-empty line of the position summary (the role title). */
export function subjectFromPositionSummary(summary: string | null | undefined, fallback: string): string {
  if (!summary) return fallback;
  for (const line of summary.split(/\r?\n/)) {
    const t = line.trim();
    if (t) return t;
  }
  return fallback;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toHtmlParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px;">${escapeHtml(block.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function buildPositionEmail(
  campaign: Campaign,
  contact: Contact,
): { subject: string; text: string; html: string } {
  const greetingName = contact.firstName?.trim() || "there";
  const summary = (campaign.positionSummary ?? "").trim();
  const subject = subjectFromPositionSummary(summary, campaign.name);

  const signLines: string[] = [];
  if (campaign.recruiterName) {
    signLines.push("", "Best,", campaign.recruiterName);
  }
  if (campaign.calendarLink) {
    signLines.push("", `Grab a time that works for you: ${campaign.calendarLink}`);
  }
  const signoff = signLines.join("\n");

  const text = `Hi ${greetingName},\n\n${summary}${signoff ? "\n" + signoff : ""}`;

  const htmlSignoff = signLines.length
    ? `<p style="margin:0 0 14px;">${escapeHtml(signLines.filter(Boolean).join("\n")).replace(/\n/g, "<br>")}</p>`
    : "";
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#18181b;">
<p style="margin:0 0 14px;">Hi ${escapeHtml(greetingName)},</p>
${toHtmlParagraphs(summary)}
${htmlSignoff}
</div>`;

  return { subject, text, html };
}

export async function sendPositionEmail(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const user = process.env.POSITION_EMAIL_USER;
  const pass = process.env.POSITION_EMAIL_PASS;
  if (!user || !pass) {
    return { ok: false, error: "POSITION_EMAIL_USER/PASS not configured" };
  }
  const host = process.env.POSITION_EMAIL_HOST || "smtp.gmail.com";
  const port = Number(process.env.POSITION_EMAIL_PORT ?? 465);
  const from = process.env.POSITION_EMAIL_FROM || user;

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    const info = await transporter.sendMail({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
