import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runValidateBatch } from "@/lib/drains";
import { verifyQStashSignature, enqueueValidationDrain } from "@/lib/schedule";

export const maxDuration = 60;

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

  const r = await runValidateBatch(campaignId);
  if (r.held) {
    console.warn(`[validate-drain ${campaignId}] TELNYX_API_KEY missing: holding contacts as validating, nothing removed`);
    return NextResponse.json({ ok: false, error: "telnyx_key_missing", kept: 0, removed: 0 });
  }

  if (r.remaining > 0) {
    await enqueueValidationDrain(campaignId, 2);
  }

  console.log(`[validate-drain ${campaignId}] kept=${r.kept} removed=${r.removed} remaining=${r.remaining}`);

  revalidatePath("/");
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/contacts`);

  return NextResponse.json({ ok: true, kept: r.kept, removed: r.removed, remaining: r.remaining });
}
