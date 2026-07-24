import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getHealthReport } from "@/lib/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health — machine-readable system status for OS Text.
 *
 * Checks the Telnyx API (connection + inbound webhook config) and this app's
 * send/receive activity, then returns a JSON report. Point an uptime monitor
 * (UptimeRobot, BetterStack, a cron, etc.) at it to get alerted the moment
 * sending or receiving breaks:
 *
 *   HTTP 200  -> status "ok" or "degraded"
 *   HTTP 503  -> status "down" (receiving is broken right now)
 *
 * Access: a signed-in session, OR ?token=HEALTH_TOKEN for external monitors.
 * If HEALTH_TOKEN is unset, only a signed-in session can read it.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const expected = process.env.HEALTH_TOKEN;

  let authorized = false;
  if (expected && token && token === expected) {
    authorized = true;
  } else {
    const session = await auth();
    authorized = !!session?.user;
  }
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const report = await getHealthReport();
  const httpStatus = report.status === "down" ? 503 : 200;
  return NextResponse.json(report, { status: httpStatus });
}
