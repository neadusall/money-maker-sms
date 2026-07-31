import type { Contact } from "@/db/schema";

const STANDARD_FIELDS: Record<string, (c: Contact) => string | null | undefined> = {
  first_name: (c) => c.firstName,
  last_name: (c) => c.lastName,
  full_name: (c) => [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
  company: (c) => c.company,
  company_name: (c) => c.company,
  job_title: (c) => c.jobTitle,
  email: (c) => c.email,
  location: (c) => c.location,
  linkedin_url: (c) => c.linkedinUrl,
};

const TOKEN = /\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g;

/**
 * Token keys are matched on letters+digits only: case AND underscores are
 * ignored, so {first_name}, {First_Name}, {FirstName} and {firstname} are one
 * token. Lowercasing alone was not enough — a recruiter who typed the natural
 * CamelCase {FirstName} missed `first_name` in STANDARD_FIELDS, fell through to
 * the custom-field lookup, and EVERY contact in the campaign was marked
 * "failed: missing merge fields" before a single text went out (2026-07-31,
 * Hill Valley - FP&A: 70 of 125 contacts failed this way). A merge token must
 * never fail a send over its punctuation.
 */
function normalizeKey(raw: string): string {
  return raw.toLowerCase().replace(/_/g, "");
}

/** STANDARD_FIELDS re-keyed by normalizeKey, built once (keys are collision-free). */
const STANDARD_BY_NORMALIZED: Record<string, (c: Contact) => string | null | undefined> =
  Object.fromEntries(Object.entries(STANDARD_FIELDS).map(([k, v]) => [normalizeKey(k), v]));

/** A contact's custom fields re-keyed the same way, so {PhoneSource} finds `phone_source`. */
function customByNormalized(contact: Contact): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(contact.customFields ?? {})) {
    const n = normalizeKey(k);
    // First writer wins: an exact-form key must not be shadowed by a later variant.
    if (!(n in out)) out[n] = v;
  }
  return out;
}

/** Resolve one token against standard fields then custom fields. Returns null when unresolved. */
function lookup(rawKey: string, contact: Contact): string | null {
  const std = STANDARD_BY_NORMALIZED[normalizeKey(rawKey)];
  if (std) {
    const v = std(contact);
    return v == null || v === "" ? null : v;
  }
  const exact = contact.customFields?.[rawKey.toLowerCase()] ?? contact.customFields?.[rawKey];
  if (exact != null) return String(exact);
  const loose = customByNormalized(contact)[normalizeKey(rawKey)];
  return loose == null ? null : String(loose);
}

export function renderTemplate(template: string, contact: Contact): string {
  return template.replace(TOKEN, (_match, rawKey: string) => lookup(rawKey, contact) ?? "");
}

export function findUnmergedTokens(template: string, contact: Contact): string[] {
  const unresolved: string[] = [];
  for (const m of template.matchAll(TOKEN)) {
    if (lookup(m[1], contact) == null) unresolved.push(m[1]);
  }
  return unresolved;
}

export function extractTokens(template: string): string[] {
  const set = new Set<string>();
  for (const m of template.matchAll(TOKEN)) set.add(m[1]);
  return [...set];
}
