import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { messages, contacts, conversations } from "@/db/schema";
import { recordInbound } from "@/lib/actions";
import { verifyWebhook } from "@/lib/telnyx";

type InboundPayload = {
  data?: {
    event_type?: string;
    payload?: {
      id?: string;
      from?: { phone_number?: string };
      to?: { phone_number?: string; status?: string }[];
      text?: string;
      direction?: string;
      errors?: { code?: string; title?: string; detail?: string }[];
    };
  };
};

function mapTelnyxStatus(s: string | undefined): "queued" | "sending" | "sent" | "delivered" | "failed" | null {
  switch (s) {
    case "queued":
      return "queued";
    case "sending":
      return "sending";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "delivery_failed":
    case "sending_failed":
    case "delivery_unconfirmed":
      return "failed";
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (process.env.TELNYX_PUBLIC_KEY) {
    const verification = await verifyWebhook({
      rawBody,
      signatureHeader: request.headers.get("telnyx-signature-ed25519"),
      timestampHeader: request.headers.get("telnyx-timestamp"),
    });
    if (!verification.ok) {
      console.warn(`[telnyx-webhook] signature verification failed: ${verification.error}`);
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else {
    const sharedSecret = process.env.TELNYX_WEBHOOK_SECRET;
    if (sharedSecret) {
      const provided = request.headers.get("x-telnyx-shared-secret");
      if (provided !== sharedSecret) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    } else {
      console.warn("[telnyx-webhook] neither TELNYX_PUBLIC_KEY nor TELNYX_WEBHOOK_SECRET is set; accepting unverified");
    }
  }

  let body: InboundPayload;
  try {
    body = JSON.parse(rawBody) as InboundPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const eventType = body.data?.event_type;
  const payload = body.data?.payload;

  try {
    if (eventType === "message.received" && payload?.from?.phone_number && payload.text) {
      await recordInbound({
        fromPhone: payload.from.phone_number,
        body: payload.text,
        telnyxId: payload.id ?? null,
      });
    } else if (
      (eventType === "message.sent" || eventType === "message.finalized") &&
      payload?.id
    ) {
      const recipient = payload.to?.[0];
      const mapped = mapTelnyxStatus(recipient?.status);
      if (mapped) {
        const errorText = (payload.errors ?? [])
          .map((e) => [e.title, e.detail].filter(Boolean).join(": "))
          .join("; ") || null;

        const [updated] = await db
          .update(messages)
          .set({ status: mapped, error: errorText })
          .where(eq(messages.telnyxId, payload.id))
          .returning({ id: messages.id, conversationId: messages.conversationId });

        // Delivery/failure receipts often arrive AFTER a candidate has already
        // replied (or opted out). Only update the contact from a pre-delivery
        // state — never downgrade 'replied'/'opted_out'/'delivered'.
        const PRE_DELIVERY = ["pending", "queued", "sent"] as const;
        if (updated && mapped === "delivered") {
          const [convo] = await db
            .select({ contactId: conversations.contactId })
            .from(conversations)
            .where(eq(conversations.id, updated.conversationId));
          if (convo) {
            await db
              .update(contacts)
              .set({ status: "delivered" })
              .where(and(eq(contacts.id, convo.contactId), inArray(contacts.status, [...PRE_DELIVERY])));
          }
        }
        if (updated && mapped === "failed") {
          const [convo] = await db
            .select({ contactId: conversations.contactId })
            .from(conversations)
            .where(eq(conversations.id, updated.conversationId));
          if (convo) {
            await db
              .update(contacts)
              .set({ status: "failed", lastError: errorText })
              .where(and(eq(contacts.id, convo.contactId), inArray(contacts.status, [...PRE_DELIVERY])));
          }
        }
      }
    }
  } catch (err) {
    console.error("[telnyx-webhook] handler failed:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "Telnyx webhook endpoint. POST inbound + delivery events here." });
}
