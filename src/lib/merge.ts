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

/* --- Fail-safes so a recruiter cannot break a campaign with a merge token -----
 * A mistyped token used to be invisible until send time, where it failed
 * contacts one at a time and left the campaign reading "0 sent" with no
 * explanation. Three layers now stand between a recruiter and that outcome:
 *   1. canonicalizeTemplate rewrites what they typed into the real field name.
 *   2. auditTemplate says, before anything sends, exactly who would fail and why.
 *   3. the send path's per-contact check (findUnmergedTokens) stays as the floor.
 */

/** The tokens a recruiter can use, in the order they should be offered in the UI. */
export const FIELD_CATALOG: { key: string; label: string; example: string }[] = [
  { key: "first_name", label: "First name", example: "Alex" },
  { key: "last_name", label: "Last name", example: "Rivera" },
  { key: "full_name", label: "Full name", example: "Alex Rivera" },
  { key: "company", label: "Current company", example: "Acme Health" },
  { key: "job_title", label: "Current job title", example: "FP&A Analyst" },
  { key: "location", label: "Location", example: "Woodmere, NY" },
  { key: "email", label: "Email", example: "alex@acme.test" },
  { key: "linkedin_url", label: "LinkedIn URL", example: "linkedin.com/in/alex" },
];

/**
 * Words recruiters actually type that aren't field names. Keys are normalized
 * (lowercase, no underscores). {name} means the person's first name in every
 * real template we've seen, so it resolves there rather than failing.
 */
const TOKEN_ALIASES: Record<string, string> = {
  name: "first_name",
  fname: "first_name",
  firstnames: "first_name",
  givenname: "first_name",
  lname: "last_name",
  surname: "last_name",
  familyname: "last_name",
  fullname: "full_name",
  companyname: "company",
  employer: "company",
  organization: "company",
  org: "company",
  title: "job_title",
  jobtitle: "job_title",
  currenttitle: "job_title",
  role: "job_title",
  position: "job_title",
  city: "location",
  metro: "location",
  linkedin: "linkedin_url",
  linkedinprofile: "linkedin_url",
  emailaddress: "email",
};

/**
 * Damerau-Levenshtein (optimal string alignment) over short token keys.
 * Transposition has to count as ONE edit: "frist_name" for "first_name" is the
 * single most common way these get mistyped, and plain Levenshtein scores that
 * swap as 2, which would leave the most likely typo uncorrected.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * The canonical field a token means, or null if it isn't a standard field.
 * Resolution order: exact/loose field match, then a known alias, then a typo
 * within one edit of a field name ("frist_name", "compnay"). Typo correction is
 * deliberately tight — two edits starts matching the wrong field.
 */
export function canonicalFieldFor(rawKey: string): string | null {
  const n = normalizeKey(rawKey);
  const direct = FIELD_CATALOG.find((f) => normalizeKey(f.key) === n);
  if (direct) return direct.key;
  if (TOKEN_ALIASES[n]) return TOKEN_ALIASES[n];
  // company_name is a real STANDARD_FIELDS key but not offered in the catalog.
  if (STANDARD_BY_NORMALIZED[n]) return n === "companyname" ? "company" : rawKey.toLowerCase();
  let best: { key: string; d: number } | null = null;
  for (const f of FIELD_CATALOG) {
    const d = editDistance(n, normalizeKey(f.key));
    if (d <= 1 && (!best || d < best.d)) best = { key: f.key, d };
  }
  return best?.key ?? null;
}

/**
 * Rewrite a template's tokens into their canonical `{snake_case}` form, so what
 * gets stored is what the merge engine reads. Tokens that aren't standard fields
 * (real custom columns) are left exactly as typed. Called on every write path —
 * the UI form, the JD Sourcing push, and saved campaign templates — so a
 * template can't enter the system in a shape the send path won't understand.
 */
export function canonicalizeTemplate(template: string): string {
  return template.replace(TOKEN, (match, rawKey: string) => {
    const canonical = canonicalFieldFor(rawKey);
    if (!canonical || canonical === rawKey) return match;
    // Preserve the brace style the recruiter used ({x} vs {{x}}).
    return match.trim().startsWith("{{") ? `{{${canonical}}}` : `{${canonical}}`;
  });
}

export type TemplateAudit = {
  /** Contacts checked. */
  total: number;
  /** Contacts whose every token resolves — the ones that would actually send. */
  sendable: number;
  /** Per-token failure counts, worst first. */
  problems: { token: string; missing: number; knownField: boolean }[];
  /** True when nobody at all could receive this template. */
  blocksEveryone: boolean;
};

/**
 * Dry-run a template across real contacts BEFORE anything sends. This is what
 * turns "campaign quietly sent 0" into a number a recruiter can act on.
 */
export function auditTemplate(template: string, contacts: Contact[]): TemplateAudit {
  const tokens = extractTokens(template);
  const missing = new Map<string, number>();
  let sendable = 0;
  for (const c of contacts) {
    let ok = true;
    for (const t of tokens) {
      if (lookup(t, c) == null) {
        missing.set(t, (missing.get(t) ?? 0) + 1);
        ok = false;
      }
    }
    if (ok) sendable++;
  }
  const problems = [...missing.entries()]
    .map(([token, n]) => ({
      token,
      missing: n,
      knownField: canonicalFieldFor(token) != null,
    }))
    .sort((a, b) => b.missing - a.missing);
  return {
    total: contacts.length,
    sendable,
    problems,
    blocksEveryone: contacts.length > 0 && sendable === 0,
  };
}

/** One plain sentence a recruiter can act on, or null when the template is clean. */
export function describeAudit(audit: TemplateAudit): string | null {
  if (!audit.problems.length) return null;
  const worst = audit.problems[0];
  const scope = audit.blocksEveryone
    ? `No one can be texted with this message`
    : `${audit.total - audit.sendable} of ${audit.total} contacts can't be texted with this message`;
  const why = worst.knownField
    ? `${worst.missing} of them have no ${worst.token.replace(/_/g, " ")} on file`
    : `"{${worst.token}}" isn't a field on these contacts`;
  return `${scope}: ${why}. Remove that token or fill the field in.`;
}
