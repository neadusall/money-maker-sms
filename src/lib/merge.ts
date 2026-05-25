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

export function renderTemplate(template: string, contact: Contact): string {
  return template.replace(TOKEN, (match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const std = STANDARD_FIELDS[key];
    if (std) {
      const v = std(contact);
      return v ?? "";
    }
    const custom = contact.customFields?.[key] ?? contact.customFields?.[rawKey];
    if (custom != null) return String(custom);
    return "";
  });
}

export function findUnmergedTokens(template: string, contact: Contact): string[] {
  const unresolved: string[] = [];
  for (const m of template.matchAll(TOKEN)) {
    const key = m[1].toLowerCase();
    if (STANDARD_FIELDS[key]) {
      if (!STANDARD_FIELDS[key](contact)) unresolved.push(m[1]);
      continue;
    }
    if (
      contact.customFields?.[key] == null &&
      contact.customFields?.[m[1]] == null
    ) {
      unresolved.push(m[1]);
    }
  }
  return unresolved;
}

export function extractTokens(template: string): string[] {
  const set = new Set<string>();
  for (const m of template.matchAll(TOKEN)) set.add(m[1]);
  return [...set];
}
