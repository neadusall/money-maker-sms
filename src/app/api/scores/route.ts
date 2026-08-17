import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts } from "@/db/schema";
import { campaignTenantIs, normalizeTenant } from "@/lib/tenant-core";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/scores: batch qualification-score lookup for the portal's
 * Candidates tab. Server-to-server (same Bearer ACCESS_TOKEN as /api/import
 * and /api/kpi-stats); the portal proxies per-workspace and passes the
 * resolved tenant, which walls the query to that tenant's campaigns.
 *
 * Body: { tenant?: string, phones?: string[], emails?: string[] } (up to 500
 * of each per call). A contact exists per campaign, so one person can hold
 * several scores; the response carries the BEST score per key (highest, then
 * newest), which is what "how qualified is this person" means to a recruiter.
 *
 * Response: { ok, byPhone: { "<E164>": Hit }, byEmail: { "<lower>": Hit } }
 * where Hit = { score, reason, campaignId, campaignName, scoredAt }.
 */

type Hit = {
  score: number;
  reason: string | null;
  campaignId: string;
  campaignName: string;
  scoredAt: string | null;
};

function bearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

const MAX_KEYS = 500;
const CHUNK = 400;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function better(a: Hit | undefined, b: Hit): boolean {
  if (!a) return true;
  if (b.score !== a.score) return b.score > a.score;
  return (b.scoredAt || "") > (a.scoredAt || "");
}

export async function POST(req: Request) {
  const expected = process.env.ACCESS_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "ACCESS_TOKEN not configured" }, { status: 500 });
  }
  if (bearerToken(req) !== expected) {
    return NextResponse.json({ error: "invalid or missing token" }, { status: 403 });
  }

  let body: { tenant?: string; phones?: string[]; emails?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const tenant = normalizeTenant(body.tenant);
  const phones = Array.from(
    new Set(
      (Array.isArray(body.phones) ? body.phones : [])
        .map((p) => normalizePhone(String(p ?? "")))
        .filter((p): p is string => !!p),
    ),
  ).slice(0, MAX_KEYS);
  const emails = Array.from(
    new Set(
      (Array.isArray(body.emails) ? body.emails : [])
        .map((e) => String(e ?? "").trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  ).slice(0, MAX_KEYS);

  if (!phones.length && !emails.length) {
    return NextResponse.json({ ok: true, byPhone: {}, byEmail: {} });
  }

  const byPhone: Record<string, Hit> = {};
  const byEmail: Record<string, Hit> = {};

  try {
    const phoneChunks = chunk(phones, CHUNK).map((c) => ({ kind: "phone" as const, keys: c }));
    const emailChunks = chunk(emails, CHUNK).map((c) => ({ kind: "email" as const, keys: c }));

    for (const { kind, keys } of [...phoneChunks, ...emailChunks]) {
      const keyMatch =
        kind === "phone"
          ? inArray(contacts.phone, keys)
          : inArray(sql`lower(${contacts.email})`, keys);
      const rows = await db
        .select({
          phone: contacts.phone,
          email: contacts.email,
          score: contacts.qualificationScore,
          reason: contacts.qualificationReason,
          scoredAt: contacts.enrichedAt,
          createdAt: contacts.createdAt,
          campaignId: campaigns.id,
          campaignName: campaigns.name,
        })
        .from(contacts)
        .innerJoin(campaigns, eq(campaigns.id, contacts.campaignId))
        .where(
          and(
            keyMatch,
            isNull(contacts.deletedAt),
            isNotNull(contacts.qualificationScore),
            campaignTenantIs(tenant),
          ),
        );

      for (const r of rows) {
        if (typeof r.score !== "number") continue;
        const hit: Hit = {
          score: r.score,
          reason: r.reason ?? null,
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          scoredAt: (r.scoredAt ?? r.createdAt)?.toISOString?.() ?? null,
        };
        if (r.phone && better(byPhone[r.phone], hit)) byPhone[r.phone] = hit;
        const em = (r.email ?? "").trim().toLowerCase();
        if (em && better(byEmail[em], hit)) byEmail[em] = hit;
      }
    }
  } catch (err) {
    console.error("[scores] lookup failed:", err);
    return NextResponse.json({ error: "scores unavailable" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, byPhone, byEmail });
}
