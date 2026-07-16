import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts } from "@/db/schema";
import { lookupLineType } from "@/lib/telnyx";
import { verifyQStashSignature, enqueueValidationDrain } from "@/lib/schedule";
import { isAlwaysAllowed } from "@/lib/always-allow";

export const maxDuration = 60;

const VALIDATE_BATCH = 25;

export async function POST(request: Request) {
  const rawBody = await request.text();
  const ok = await verifyQStashSignature(rawBody, request.headers.get("upstash-signature"));
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let campaignId: string | undefined;
  try {
    campaignId = JSON.parse(rawBody).campaignId;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!campaignId) {
    return NextResponse.json({ error: "missing campaignId" }, { status: 400 });
  }

  // SAFEGUARD: with no Telnyx key every lookup would come back "unknown" and the
  // strict keep-mobiles-only rule below would delete the ENTIRE batch. Refuse to
  // run instead: contacts stay "validating" (never textable) until the key is set.
  if (!process.env.TELNYX_API_KEY) {
    console.warn(`[validate-drain ${campaignId}] TELNYX_API_KEY missing — holding contacts as validating, nothing removed`);
    return NextResponse.json({ ok: false, error: "telnyx_key_missing", kept: 0, removed: 0 });
  }

  const batch = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.campaignId, campaignId), eq(contacts.status, "validating")))
    .limit(VALIDATE_BATCH);

  let kept = 0;
  let removed = 0;
  for (const contact of batch) {
    // Never validate-away an always-allow number (e.g. your own).
    if (isAlwaysAllowed(contact.phone)) {
      await db.update(contacts).set({ status: "pending", lastError: null }).where(eq(contacts.id, contact.id));
      kept++;
      continue;
    }
    let lineType: string;
    try {
      lineType = await lookupLineType(contact.phone);
    } catch {
      lineType = "unknown";
    }
    // Strict: keep ONLY confirmed mobile numbers. Everything else (landline,
    // toll-free, VoIP, or unverifiable) is removed.
    if (lineType === "mobile") {
      await db.update(contacts).set({ status: "pending", lastError: null }).where(eq(contacts.id, contact.id));
      kept++;
    } else {
      await db.delete(contacts).where(eq(contacts.id, contact.id));
      removed++;
    }
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.campaignId, campaignId), eq(contacts.status, "validating")));

  if (remaining > 0) {
    await enqueueValidationDrain(campaignId, 2);
  }

  console.log(`[validate-drain ${campaignId}] kept=${kept} removed=${removed} remaining=${remaining}`);

  revalidatePath("/");
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/contacts`);

  return NextResponse.json({ ok: true, kept, removed, remaining });
}
