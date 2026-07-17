import { NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { dispatchScheduledMessage } from "@/lib/drains";

async function verify(rawBody: string, signature: string | null): Promise<boolean> {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    console.warn("[qstash-dispatch] signing keys not configured");
    return false;
  }
  if (!signature) return false;
  try {
    const receiver = new Receiver({ currentSigningKey, nextSigningKey });
    return await receiver.verify({ signature, body: rawBody });
  } catch (err) {
    console.warn("[qstash-dispatch] signature verification failed:", err);
    return false;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const ok = await verify(rawBody, request.headers.get("upstash-signature"));
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let scheduledMessageId: string | undefined;
  try {
    scheduledMessageId = JSON.parse(rawBody).scheduledMessageId;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!scheduledMessageId) {
    return NextResponse.json({ error: "missing scheduledMessageId" }, { status: 400 });
  }

  const r = await dispatchScheduledMessage(scheduledMessageId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  return NextResponse.json(r);
}
