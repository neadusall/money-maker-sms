import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness + right-build probe for the ops layers: the container healthcheck,
 * the deploy-tick fail-safe, and the standalone watchdog all key off this.
 *
 * A 200 from <host>/ostext-app/api/health proves the running build carries the
 * /ostext-app basePath AND the proxy lets the probe through, which is exactly
 * what the 2026-07-27 outage lacked (a stale no-basePath build redirect-looped
 * every request while looking "up"). Deliberately does NO DB or vendor calls:
 * it answers "is THIS build serving on the expected base path", nothing more,
 * so a vendor/DB blip can never flap the container.
 */
export function GET() {
  return NextResponse.json({ ok: true, service: "ostext-engine" });
}
