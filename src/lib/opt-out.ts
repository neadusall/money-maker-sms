const STOP_KEYWORDS = [
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "remove",
  "remove me",
  "opt out",
  "opt-out",
];

const HELP_KEYWORDS = ["help", "info"];

export function isStopKeyword(body: string): boolean {
  const normalized = body.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (STOP_KEYWORDS.includes(normalized)) return true;
  const firstWord = normalized.split(/\s+/)[0];
  return STOP_KEYWORDS.includes(firstWord);
}

export function isHelpKeyword(body: string): boolean {
  const normalized = body.trim().toLowerCase().replace(/[.!?]+$/, "");
  return HELP_KEYWORDS.includes(normalized);
}

// ---- Outbound opt-out footer (10DLC compliance) ----
// Appended to every outbound SMS at the send chokepoint. Lives here (no Telnyx
// SDK import) so UI can show the exact text recipients receive.

export const OPT_OUT_LINE = "Reply STOP to opt out.";

/** True if the text already carries STOP opt-out language (so we don't double it). */
export function hasOptOut(text: string): boolean {
  return /\bstop\b[\s\S]*?opt[\s-]?out/i.test(text);
}

/** Append the opt-out line to a message body. Idempotent. */
export function withOptOut(body: string): string {
  const text = body.trimEnd();
  if (hasOptOut(text)) return text;
  return `${text}\n\n${OPT_OUT_LINE}`;
}
