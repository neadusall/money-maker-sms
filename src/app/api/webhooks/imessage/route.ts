import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { messages, contacts, conversations } from "@/db/schema";
import { recordInbound } from "@/lib/actions";
import { normalizePhone } from "@/lib/phone";

/**
 * POST /api/webhooks/imessage — the BlueBubbles Mac bridge calls this for
 * every Messages.app event. Configure the webhook in BlueBubbles Server as:
 *
 *   https://<host>/ostext-app/api/webhooks/imessage?token=<BLUEBUBBLES_WEBHOOK_SECRET>
 *
 * Two cases land here:
 *  - Candidate replies (isFromMe=false): recorded through the SAME
 *    recordInbound path Telnyx uses — classification, STOP handling, reply
 *    alerts, position emails, the works. One thread per phone number no
 *    matter which wire carried the reply.
 *  - The owner texting from their own iPhone/Mac directly (isFromMe=true):
 *    mirrored into an existing thread as an outbound message, so the portal
 *    shows the full back-and-forth even when the recruiter answered from
 *    their pocket. Router-sent messages also echo back here; the GUID dedupe
 *    keeps them from appearing twice. Numbers OS Text has never contacted
 *    are ignored — the portal is not a mirror of the owner's personal life.
 *
 * Fail-closed auth: no BLUEBUBBLES_WEBHOOK_SECRET configured = every request
 * rejected. BlueBubbles can't sign requests, so the shared secret in the URL
 * (over HTTPS through the tunnel) is the authentication.
 */

type BBMessage = {
  guid?: unknown;
  text?: unknown;
  isFromMe?: unknown;
  handle?: { address?: unknown };
  address?: unknown;
};

function extract(payload: unknown): { type: string; message: BBMessage | null } {
  const p = payload as { type?: unknown; event?: unknown; data?: unknown };
  const type = String(p?.type ?? p?.event ?? "");
  const d = p?.data as (BBMessage & { message?: BBMessage }) | undefined;
  const message = (d?.message ?? d ?? null) as BBMessage | null;
  return { type, message };
}

async function mirrorOwnOutbound(args: { phone: string; body: string; guid: string }): Promise<boolean> {
  const [dup] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.blueBubblesGuid, args.guid))
    .limit(1);
  if (dup) return true;

  // Most recently active existing thread for this number. No thread = no-op.
  const [row] = await db
    .select({ conversationId: conversations.id })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(contacts.phone, args.phone))
    .orderBy(sql`${conversations.lastMessageAt} DESC NULLS LAST`)
    .limit(1);
  if (!row) return false;

  await db.insert(messages).values({
    conversationId: row.conversationId,
    direction: "outbound",
    status: "sent",
    body: args.body,
    provider: "imessage",
    blueBubblesGuid: args.guid,
  });
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, row.conversationId));
  return true;
}

export async function POST(request: Request) {
  const secret = process.env.BLUEBUBBLES_WEBHOOK_SECRET;
  const url = new URL(request.url);
  const provided = url.searchParams.get("token") ?? request.headers.get("x-webhook-token");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { type, message } = extract(payload);
  if (!/new-message|updated-message/i.test(type) || !message) {
    return new Response(null, { status: 204 });
  }

  const guid = typeof message.guid === "string" ? message.guid : null;
  const body = typeof message.text === "string" ? message.text : "";
  const rawAddress =
    (typeof message.handle?.address === "string" && message.handle.address) ||
    (typeof message.address === "string" && message.address) ||
    null;
  if (!guid || !rawAddress || !body.trim()) {
    // Attachments-only messages and system events carry no text — nothing to thread.
    return new Response(null, { status: 204 });
  }
  const phone = normalizePhone(rawAddress);
  if (!phone) return new Response(null, { status: 204 });

  try {
    if (message.isFromMe === true) {
      await mirrorOwnOutbound({ phone, body, guid });
    } else if (/new-message/i.test(type)) {
      await recordInbound({ fromPhone: phone, body, provider: "imessage", blueBubblesGuid: guid });
    }
  } catch (err) {
    console.error("[imessage-webhook] handler failed:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "BlueBubbles webhook endpoint. Configure the BB server to POST new-message events here with ?token=.",
  });
}
