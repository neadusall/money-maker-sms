import { NextResponse } from "next/server";
import { kpiStats } from "@/lib/kpi-stats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/kpi-stats?days=30: the engine-wide KPI rollup for the portal's
 * admin "OS Text Performance" tab (funnel, message outcomes, reply
 * classifications, daily trend, spend, engine gauges).
 *
 * Server-to-server (same Bearer ACCESS_TOKEN as /api/import and
 * /api/phone-accuracy); the portal proxies and merges this with the JD
 * Sourcing supply-side stats.
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
  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") || 30) || 30));
  try {
    return NextResponse.json({ ok: true, ...(await kpiStats(days)) });
  } catch (err) {
    console.error("[kpi-stats] rollup failed:", err);
    return NextResponse.json({ error: "stats unavailable" }, { status: 500 });
  }
}
