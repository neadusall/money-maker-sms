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

/**
 * True if the text already tells the recipient how to stop hearing from us, in
 * ANY of the phrasings carriers accept - not just our own footer's wording.
 *
 * The old check demanded the literal shape "stop ... opt out", so a template
 * that already said "Reply STOP to unsubscribe" or "Text STOP to end" got a
 * SECOND instruction stapled on: two contradictory footers, and an extra
 * segment billed on every message. Recognizing the whole family keeps the
 * append idempotent for real-world templates.
 *
 * Deliberately narrow in one direction: the STOP keyword must appear as its own
 * word, so prose like "stop by the office" is not mistaken for a notice and the
 * footer still gets added.
 */
export function hasOptOut(text: string): boolean {
  // "reply/text/send STOP", optionally "reply STOP to <anything>".
  if (/\b(reply|text|send|txt)\s+["']?stop\b/i.test(text)) return true;
  // "STOP to opt out / unsubscribe / cancel / end / quit".
  if (/\bstop\b\s*(to|=|:)?\s*(opt[\s-]?out|unsubscribe|cancel|end|quit)/i.test(text)) return true;
  // Our own footer, or any wording that pairs STOP with opting out later in the line.
  return /\bstop\b[\s\S]{0,40}?opt[\s-]?out/i.test(text);
}

/** Append the opt-out line to a message body. Idempotent. */
export function withOptOut(body: string): string {
  const text = body.trimEnd();
  if (hasOptOut(text)) return text;
  return `${text}\n\n${OPT_OUT_LINE}`;
}
