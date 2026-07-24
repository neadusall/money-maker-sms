import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts, suppressedNumbers } from "@/db/schema";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-to-server opt-in ingest. The lumesp.com jobs backend (lume-jobs) POSTs
 * every SMS-opted-in applicant here so consented numbers land as contacts in an
 * outreach campaign instead of only emailing Ryan. Called over the internal
 * Docker network (never exposed publicly by Caddy), authenticated by a shared
 * secret header.
 *
 * The target campaign is created as a DRAFT on first use, so numbers accumulate
 * safely and NOTHING is sent until a template is written and the campaign is
 * activated by hand. The 10DLC consent record (exact language + opt-in URL +
 * timestamp) rides along in customFields as the auditable proof of consent.
 */

function secretOk(provided: string | null): boolean {
  const expected = process.env.INGEST_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function firstNameOnly(s: string | null): string | null {
  if (!s) return null;
  const first = s.trim().split(/\s+/)[0];
  return first || null;
}

async function campaignExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  return !!row;
}

/** body.campaignId -> INGEST_CAMPAIGN_ID -> find-or-create by INGEST_CAMPAIGN_NAME. */
async function resolveCampaignId(explicit: string | null): Promise<string | null> {
  if (explicit && (await campaignExists(explicit))) return explicit;

  const envId = process.env.INGEST_CAMPAIGN_ID;
  if (envId && (await campaignExists(envId))) return envId;

  const name = (process.env.INGEST_CAMPAIGN_NAME || "Website Opt-Ins").trim();
  const [existing] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.name, name))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(campaigns)
    .values({
      name,
      status: "draft",
      smsTemplate:
        "Hi, thanks for reaching out to Lume Search Partners. A recruiter will follow up with you shortly.",
    })
    .returning({ id: campaigns.id });
  return created?.id ?? null;
}

export async function POST(request: Request) {
  if (!process.env.INGEST_SECRET) {
    return NextResponse.json(
      { error: "ingest disabled: INGEST_SECRET not set" },
      { status: 503 },
    );
  }
  if (!secretOk(request.headers.get("x-ingest-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const phone = normalizePhone(String(body.phone ?? ""));
  if (!phone) {
    return NextResponse.json({ error: "invalid or missing phone" }, { status: 400 });
  }

  // Names: accept firstName/lastName, else split a single "name".
  let firstName = body.firstName ? String(body.firstName) : null;
  let lastName = body.lastName ? String(body.lastName) : null;
  if (!firstName && body.name) {
    const parts = String(body.name).trim().split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  }
  firstName = firstNameOnly(firstName);

  const campaignId = await resolveCampaignId(
    body.campaignId ? String(body.campaignId) : null,
  );
  if (!campaignId) {
    return NextResponse.json({ error: "no target campaign" }, { status: 500 });
  }

  // Never re-add a number that already opted out (STOP) anywhere in the app.
  const [optedOut] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.phone, phone), eq(contacts.optedOut, true)))
    .limit(1);
  if (optedOut) return NextResponse.json({ ok: true, status: "opted_out" });

  // Respect this campaign's suppression list (already-sent or manually blocked).
  const [suppressed] = await db
    .select({ id: suppressedNumbers.id })
    .from(suppressedNumbers)
    .where(and(eq(suppressedNumbers.campaignId, campaignId), eq(suppressedNumbers.phone, phone)))
    .limit(1);
  if (suppressed) return NextResponse.json({ ok: true, status: "suppressed" });

  // 10DLC proof-of-consent travels with the contact.
  const customFields: Record<string, string> = {
    source: String(body.source || "lume_opt_in"),
    opt_in: "yes",
    consent_at: String(body.consentAt || new Date().toISOString()),
  };
  if (body.consentText) customFields.consent_text = String(body.consentText).slice(0, 2000);
  if (body.consentUrl) customFields.consent_url = String(body.consentUrl).slice(0, 300);

  const inserted = await db
    .insert(contacts)
    .values({
      campaignId,
      phone,
      firstName,
      lastName,
      email: body.email ? String(body.email).slice(0, 200) : null,
      company: body.company ? String(body.company).slice(0, 200) : null,
      customFields,
    })
    .onConflictDoNothing({ target: [contacts.campaignId, contacts.phone] })
    .returning({ id: contacts.id });

  return NextResponse.json({
    ok: true,
    status: inserted.length ? "created" : "duplicate",
    campaignId,
  });
}
