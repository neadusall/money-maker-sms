import { NextResponse } from "next/server";
import { buildId } from "@/lib/build-id";

export const dynamic = "force-dynamic";

/** Which build is live right now. Open tabs poll this (see BuildWatch) and
 *  reload themselves when it no longer matches the build they were served. */
export async function GET() {
  return new NextResponse(buildId(), {
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  });
}
