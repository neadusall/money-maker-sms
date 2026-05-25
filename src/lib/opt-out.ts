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
