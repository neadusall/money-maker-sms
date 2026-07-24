import { NextResponse } from "next/server";
import { getHealthReport } from "@/lib/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health — two callers, two contracts, deliberately kept apart.
 *
 * WITHOUT a token: the liveness + right-build probe the ops layers key off —
 * the container healthcheck, the deploy-tick fail-safe, and the standalone
 * watchdog. A 200 from <host>/ostext-app/api/health proves the running build
 * carries the /ostext-app basePath AND the proxy lets the probe through, which
 * is exactly what the 2026-07-27 outage lacked (a stale no-basePath build
 * redirect-looped every request while looking "up"). Deliberately does NO DB
 * or vendor calls, so a Telnyx blip can never flap the container — and it must
 * keep answering a flat 200, because the deploy fail-safe reads anything else
 * as "serving-but-wrong" and starts rebuilding the engine underneath you.
 *
 * WITH ?token=HEALTH_TOKEN: the deep report for an external uptime monitor —
 * Telnyx connection, inbound webhook config, and this app's real send/receive
 * activity, so "sending works but nothing arrives" gets caught.
 *
 *   200 -> "ok" or "degraded"      503 -> "down" (receiving is broken now)
 *
 * The 503 is why the two are split rather than merged: it is the right answer
 * for a monitor and the wrong one for a healthcheck, which reads it as a dead
 * container and restarts a process that is working fine. /api/health is in
 * proxy.ts's PUBLIC_PATHS on the promise that it returns a static ok and
 * nothing sensitive, so the report stays behind the token — never a bare GET.
 *
 * The Status page does not come through here at all: it is a server component
 * and calls getHealthReport() directly.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ ok: true, service: "ostext-engine" });
  }

  const expected = process.env.HEALTH_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const report = await getHealthReport();
  return NextResponse.json(report, { status: report.status === "down" ? 503 : 200 });
}
