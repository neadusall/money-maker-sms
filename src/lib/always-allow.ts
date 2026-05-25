import { normalizePhone } from "./phone";

/**
 * Numbers that must NEVER be suppressed/skipped — they always receive every
 * campaign's messages (e.g. your own test phone). Configured via the
 * ALWAYS_ALLOW_NUMBERS env var (comma-separated, any format; normalized to E.164).
 */
export function alwaysAllowNumbers(): Set<string> {
  const raw = process.env.ALWAYS_ALLOW_NUMBERS ?? "";
  const set = new Set<string>();
  for (const part of raw.split(",")) {
    const n = normalizePhone(part);
    if (n) set.add(n);
  }
  return set;
}

export function isAlwaysAllowed(phone: string): boolean {
  return alwaysAllowNumbers().has(phone);
}
