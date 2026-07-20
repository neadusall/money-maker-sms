import { NextResponse } from "next/server";
import { phoneAccuracyBySource } from "@/lib/phone-accuracy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/phone-accuracy: the phone-accuracy scoreboard, per phone source.
 *
 * Server-to-server (same Bearer ACCESS_TOKEN as /api/import); the RecruitersOS
 * portal proxies this to its Outbound Performance "Phone number accuracy" card.
 * Per source (skiptrace / koldinfo / laxis / landlinedb / finder / unknown):
 * Telnyx cell-check outcomes, contacts texted, deliveries (Telnyx DLR), replies,
 * AI-classified wrong-number replies, and opt-outs.
 */

function bearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

export async function GET(req: Request) {
  const expected = process.env.ACCESS_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "ACCESS_TOKEN not configured" }, { status: 500 });
  }
  if (bearerToken(req) !== expected) {
    return NextResponse.json({ error: "invalid or missing token" }, { status: 403 });
  }
  try {
    const sources = await phoneAccuracyBySource();
    return NextResponse.json({ ok: true, sources });
  } catch (err) {
    console.error("[phone-accuracy] stats failed:", err);
    return NextResponse.json({ error: "stats unavailable" }, { status: 500 });
  }
}
