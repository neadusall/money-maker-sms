import { normalizePhone } from "./phone";

export type SeedContact = { firstName: string | null; phone: string };

/**
 * Contacts automatically added to every campaign (e.g. your own number) so you
 * always receive the blast and can preview what candidates see.
 * Configured via SEED_CONTACT_PHONE (+ optional SEED_CONTACT_NAME).
 * Multiple numbers may be comma-separated in SEED_CONTACT_PHONE.
 */
export function seedContacts(): SeedContact[] {
  const phonesRaw = process.env.SEED_CONTACT_PHONE ?? "";
  const name = process.env.SEED_CONTACT_NAME?.trim() || null;
  const out: SeedContact[] = [];
  for (const part of phonesRaw.split(",")) {
    const phone = normalizePhone(part);
    if (phone) out.push({ firstName: name, phone });
  }
  return out;
}
