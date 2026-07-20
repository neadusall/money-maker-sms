import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts, suppressedNumbers } from "@/db/schema";
import { normalizePhone } from "@/lib/phone";
import { isQStashConfigured, enqueueValidationDrain, enqueueScoreDrain } from "@/lib/schedule";
import { kickSoon } from "@/lib/internal-clock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/import: server-to-server campaign + contact import.
 *
 * The RecruitersOS portal pushes a Candidates list here in one call: it creates
 * (or reuses, by exact name) a draft campaign and loads the contacts into it,
 * so the recruiter opens OS Text to a campaign that is already ~90% built and
 * only needs a template review before launch.
 *
 * Auth is the same shared secret as /api/enter: `Authorization: Bearer <ACCESS_TOKEN>`.
 * The token never leaves the two servers, so this route is not reachable from a browser.
 *
 * Body:
 *   {
 *     campaign: { name, smsTemplate?, positionSummary?, recruiterName?, recruiterEmail?, location? },
 *     contacts: [{ firstName?, lastName?, company?, jobTitle?, phone, email?, linkedinUrl?, location?, customFields? }],
 *     validate?: boolean   // Telnyx cell-line confirmation; DEFAULTS ON (pass false to skip)
 *   }
 *
 * SAFEGUARD: validation defaults ON and is fail-closed. Contacts land as
 * "validating" (the sender only ever picks "pending", so an unconfirmed number
 * can never be texted) and the Telnyx drain promotes confirmed cells / removes
 * the rest. The drain runs via QStash when configured, else via the internal
 * clock — and if it can't make progress (e.g. TELNYX_API_KEY missing) contacts
 * are NOT silently downgraded to textable; they stay held as "validating".
 *
 * Contact handling mirrors the CSV upload exactly: phones normalized to E.164
 * (invalid rows skipped), deduped by (campaign, phone), and numbers that opted
 * out anywhere are never inserted. Extra data rides in customFields, so every
 * key is available as a {token} in the SMS template.
 */

interface ImportContact {
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  phone?: string;
  email?: string;
  linkedinUrl?: string;
  location?: string;
  customFields?: Record<string, string>;
}

interface ImportBody {
  campaign?: {
    name?: string;
    smsTemplate?: string;
    positionSummary?: string;
    recruiterName?: string;
    recruiterEmail?: string;
    location?: string;
    /** The pushing recruiter's assigned phone line (E.164): the campaign texts
     *  from the same number that recruiter calls from. */
    fromNumber?: string;
  };
  contacts?: ImportContact[];
  validate?: boolean;
}

const MAX_CONTACTS = 25_000;
const INSERT_CHUNK = 500;

// Campaign names arrive as saved-list names ("VP of Operations · Howell, New
// Jersey +50mi (combined)"). Texts should say the ROLE, not the list name:
// keep what's before the separator and drop parentheticals / trailing state codes.
const roleFromName = (name: string) => {
  const cleaned = name.split("·")[0].replace(/\(.*?\)/g, "").replace(/,\s*[A-Z]{2}\b.*$/, "").trim();
  return cleaned || name.trim();
};

// Safe fallback template: uses only {first_name}, which every pushed contact has,
// so no contact is ever failed for a missing merge field before the recruiter edits.
const DEFAULT_TEMPLATE = (name: string) =>
  `Hi {first_name}, I'm recruiting for a ${roleFromName(name)} opening and your background looks like a strong fit. Would you be open to a quick text about it?`;

function bearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

export async function POST(req: Request) {
  const expected = process.env.ACCESS_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "ACCESS_TOKEN not configured" }, { status: 500 });
  }
  if (bearerToken(req) !== expected) {
    return NextResponse.json({ error: "invalid or missing token" }, { status: 403 });
  }

  let body: ImportBody;
  try {
    body = (await req.json()) as ImportBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = clean(body.campaign?.name);
  if (!name) return NextResponse.json({ error: "campaign.name required" }, { status: 422 });
  const rows = Array.isArray(body.contacts) ? body.contacts : [];
  if (rows.length > MAX_CONTACTS) {
    return NextResponse.json({ error: `too many contacts (max ${MAX_CONTACTS})` }, { status: 413 });
  }

  // The sender honors campaign.fromNumber before the shared env number, so a
  // valid pushed number ties this campaign's texts to the recruiter's own line.
  const fromNumber = normalizePhone(clean(body.campaign?.fromNumber) ?? "") || null;

  // Get-or-create the campaign by exact name, so repeat pushes of the same list
  // top the campaign up instead of forking "Name (2)" copies.
  let created = false;
  let [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.name, name))
    .orderBy(desc(campaigns.createdAt))
    .limit(1);
  if (!campaign) {
    // ALWAYS draft. There is deliberately no way to create or launch a sending
    // campaign through this API: sending starts only after a human sets a send
    // date & time inside OS Text (and the sender itself enforces that too).
    [campaign] = await db
      .insert(campaigns)
      .values({
        name,
        status: "draft",
        smsTemplate: clean(body.campaign?.smsTemplate) ?? DEFAULT_TEMPLATE(name),
        positionSummary: clean(body.campaign?.positionSummary),
        recruiterName: clean(body.campaign?.recruiterName),
        recruiterEmail: clean(body.campaign?.recruiterEmail),
        location: clean(body.campaign?.location),
        fromNumber,
      })
      .returning();
    created = true;
  } else if (fromNumber && !campaign.fromNumber) {
    // Top-up of a campaign created before per-recruiter numbers existed: adopt
    // the pushed number. A number someone typed in the UI is never overwritten.
    [campaign] = await db
      .update(campaigns)
      .set({ fromNumber })
      .where(eq(campaigns.id, campaign.id))
      .returning();
  }

  // Normalize + dedupe within the payload, exactly like the CSV path.
  const seen = new Set<string>();
  let invalidPhone = 0;
  let dupInPayload = 0;
  const normalized: (ImportContact & { phone: string })[] = [];
  for (const r of rows) {
    const phone = normalizePhone(r.phone ?? "");
    if (!phone) { invalidPhone++; continue; }
    if (seen.has(phone)) { dupInPayload++; continue; }
    seen.add(phone);
    normalized.push({ ...r, phone });
  }

  // Numbers that opted out ANYWHERE are permanently untouchable.
  const optedOut = new Set<string>();
  const phones = normalized.map((r) => r.phone);
  if (phones.length > 0) {
    const optedContacts = await db
      .select({ phone: contacts.phone })
      .from(contacts)
      .where(and(inArray(contacts.phone, phones), eq(contacts.optedOut, true)));
    const optedSupp = await db
      .select({ phone: suppressedNumbers.phone })
      .from(suppressedNumbers)
      .where(and(inArray(suppressedNumbers.phone, phones), eq(suppressedNumbers.reason, "opted_out")));
    for (const r of optedContacts) optedOut.add(r.phone);
    for (const r of optedSupp) optedOut.add(r.phone);
  }
  const toInsert = normalized.filter((r) => !optedOut.has(r.phone));

  // Default ON, and independent of QStash: an unvalidated contact must never
  // become textable just because the drain queue happens to be unconfigured.
  const validate = body.validate !== false;
  let added = 0;
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK);
    const inserted = await db
      .insert(contacts)
      .values(
        chunk.map((r) => ({
          campaignId: campaign.id,
          firstName: clean(r.firstName),
          lastName: clean(r.lastName),
          company: clean(r.company),
          jobTitle: clean(r.jobTitle),
          phone: r.phone,
          email: clean(r.email),
          linkedinUrl: clean(r.linkedinUrl),
          location: clean(r.location),
          customFields: r.customFields && typeof r.customFields === "object" ? r.customFields : {},
          status: (validate ? "validating" : "pending") as "validating" | "pending",
        })),
      )
      .onConflictDoNothing({ target: [contacts.campaignId, contacts.phone] })
      .returning({ id: contacts.id });
    added += inserted.length;
  }

  if (added > 0) {
    if (isQStashConfigured()) {
      if (validate) await enqueueValidationDrain(campaign.id, 1);
      await enqueueScoreDrain(campaign.id, 3);
    } else {
      // Self-hosted: the internal clock sweeps validation and scoring. Sending
      // is untouched here: it requires a human-set send date & time in OS Text.
      kickSoon();
    }
  }

  return NextResponse.json({
    ok: true,
    campaignId: campaign.id,
    campaignName: campaign.name,
    created,
    received: rows.length,
    added,
    invalidPhone,
    optedOut: optedOut.size,
    // in-payload dupes + already-in-campaign rows the unique index absorbed
    deduped: dupInPayload + (toInsert.length - added),
    // "queued": the Telnyx validation drain is running (QStash or the internal
    // clock). Contacts stay held as "validating" (never textable) until it
    // confirms each number is a cell.
    validation: validate ? "queued" : "off",
  });
}
