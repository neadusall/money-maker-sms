import Papa from "papaparse";
import { normalizePhone } from "./phone";

export type ImportedContact = {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  phone: string;
  email: string | null;
  linkedinUrl: string | null;
  location: string | null;
  customFields: Record<string, string>;
};

export type ImportResult = {
  rows: ImportedContact[];
  skipped: { rowIndex: number; reason: string; raw: Record<string, string> }[];
  totalRead: number;
};

const STANDARD_KEYS: Record<string, keyof Omit<ImportedContact, "customFields">> = {
  firstname: "firstName",
  first_name: "firstName",
  "first name": "firstName",
  fname: "firstName",

  lastname: "lastName",
  last_name: "lastName",
  "last name": "lastName",
  lname: "lastName",
  surname: "lastName",

  company: "company",
  company_name: "company",
  "company name": "company",
  employer: "company",
  organization: "company",

  title: "jobTitle",
  jobtitle: "jobTitle",
  job_title: "jobTitle",
  "job title": "jobTitle",
  position: "jobTitle",
  role: "jobTitle",

  phone: "phone",
  "phone number": "phone",
  phonenumber: "phone",
  mobile: "phone",
  cell: "phone",
  cellphone: "phone",
  number: "phone",

  email: "email",
  "email address": "email",
  emailaddress: "email",
  mail: "email",

  linkedin: "linkedinUrl",
  linkedin_url: "linkedinUrl",
  "linkedin url": "linkedinUrl",
  li: "linkedinUrl",

  location: "location",
  city: "location",
  state: "location",
  region: "location",
  geo: "location",
};

function normKey(s: string): string {
  return s.trim().toLowerCase();
}

/** Keep only the first name — strip anything after the first space (last name, middle initial, etc.). */
export function firstNameOnly(s: string | null | undefined): string | null {
  if (!s) return null;
  const first = s.trim().split(/\s+/)[0];
  return first || null;
}

export function parseCsv(text: string): ImportResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const rows: ImportedContact[] = [];
  const skipped: ImportResult["skipped"] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const raw = parsed.data[i];
    if (!raw || typeof raw !== "object") continue;

    const standard: Partial<ImportedContact> = {};
    const custom: Record<string, string> = {};

    for (const [k, v] of Object.entries(raw)) {
      const val = typeof v === "string" ? v.trim() : "";
      if (!val) continue;
      const mapped = STANDARD_KEYS[normKey(k)];
      if (mapped) {
        standard[mapped] = val as never;
      } else {
        custom[normKey(k).replace(/\s+/g, "_")] = val;
      }
    }

    if (!standard.phone) {
      skipped.push({ rowIndex: i, reason: "missing phone", raw });
      continue;
    }

    const e164 = normalizePhone(standard.phone);
    if (!e164) {
      skipped.push({ rowIndex: i, reason: `invalid phone: ${standard.phone}`, raw });
      continue;
    }

    rows.push({
      firstName: firstNameOnly(standard.firstName),
      lastName: standard.lastName ?? null,
      company: standard.company ?? null,
      jobTitle: standard.jobTitle ?? null,
      phone: e164,
      email: standard.email ?? null,
      linkedinUrl: standard.linkedinUrl ?? null,
      location: standard.location ?? null,
      customFields: custom,
    });
  }

  return { rows, skipped, totalRead: parsed.data.length };
}
