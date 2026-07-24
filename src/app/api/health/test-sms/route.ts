import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runSelfTest, getSelfTestStatus } from "@/lib/selfTest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Two-way SMS self-test, driven from the Status page.
 *
 * POST  -> send a real test text (from a chosen recruiter number) to a phone.
 * GET   -> poll the round-trip status (?conversationId=&since=): sent ->
 *          Telnyx-delivered -> reply-received.
 *
 * Signed-in recruiters only. Uses the server's own Telnyx key, so no one has to
 * share credentials to run the check.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { to?: string; fromNumber?: string; recruiter?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.to) return NextResponse.json({ error: "missing 'to' phone number" }, { status: 400 });

  const result = await runSelfTest({ to: body.to, fromNumber: body.fromNumber, recruiter: body.recruiter });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  const since = url.searchParams.get("since");
  if (!conversationId || !since) {
    return NextResponse.json({ error: "missing conversationId or since" }, { status: 400 });
  }

  const status = await getSelfTestStatus(conversationId, since);
  return NextResponse.json(status);
}
