import Telnyx from "telnyx";
import { TelnyxWebhook } from "telnyx";
import { withOptOut } from "./opt-out";

let cached: Telnyx | null = null;

function client(): Telnyx {
  if (cached) return cached;
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error("TELNYX_API_KEY is not set");
  cached = new Telnyx({ apiKey: key });
  return cached;
}

export type SendResult =
  | { ok: true; telnyxId: string }
  | { ok: false; error: string };

export async function sendSms(args: {
  to: string;
  body: string;
  from?: string;
  // Internal notifications to our own recruiters: skip the candidate-facing
  // opt-out footer (a STOP instruction on an internal alert invites the
  // recruiter to opt their own cell out of the platform).
  internal?: boolean;
}): Promise<SendResult> {
  const profileId = process.env.TELNYX_MESSAGING_PROFILE_ID;
  const from = args.from ?? process.env.TELNYX_FROM_NUMBER;
  if (!profileId && !from) {
    return { ok: false, error: "Set TELNYX_FROM_NUMBER or TELNYX_MESSAGING_PROFILE_ID" };
  }
  try {
    const res = await client().messages.send({
      to: args.to,
      text: args.internal ? args.body : withOptOut(args.body),
      ...(from ? { from } : {}),
      ...(profileId ? { messaging_profile_id: profileId } : {}),
    });
    const id = res.data?.id;
    if (!id) return { ok: false, error: "Telnyx response missing message id" };
    return { ok: true, telnyxId: id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export type LineType = "mobile" | "landline" | "voip" | "toll_free" | "unknown";

/**
 * Look up a number's line type via Telnyx Number Lookup (carrier data).
 *
 * Returns a VERDICT about the number: "unknown" means Telnyx answered but
 * could not class the line (or rejected the number itself as unroutable), and
 * the strict mobile-only rule may act on that. THROWS when Telnyx could not be
 * asked at all (network failure, rate limit, auth, 5xx): that is an outage,
 * not a fact about the number, so callers must hold the contact for a retry
 * rather than treat it as "not a cell".
 */
export async function lookupLineType(phone: string): Promise<LineType> {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error("TELNYX_API_KEY is not set");
  let lastFailure = "";
  // One retry so a transient blip doesn't get a real mobile number dropped.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(
        `https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(phone)}?type=carrier`,
        { headers: { Authorization: `Bearer ${key}` } },
      );
      if (res.ok) {
        const json = (await res.json()) as { data?: { carrier?: { type?: string } } };
        const raw = (json.data?.carrier?.type ?? "").toLowerCase();
        if (raw.includes("mobile") || raw.includes("wireless")) return "mobile";
        if (raw.includes("landline") || raw.includes("fixed")) return "landline";
        if (raw.includes("voip")) return "voip";
        if (raw.includes("toll")) return "toll_free";
        return "unknown";
      }
      // A plain 4xx (not auth or rate limit) is Telnyx's real answer for THIS
      // number (malformed, unroutable): a verdict, not an outage.
      if (res.status >= 400 && res.status < 500 && ![401, 403, 429].includes(res.status)) {
        return "unknown";
      }
      lastFailure = `HTTP ${res.status}`;
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
    }
  }
  console.warn(`[number-lookup] failed for ${phone}: ${lastFailure}`);
  throw new Error(`number lookup unavailable: ${lastFailure}`);
}

export type WebhookVerifyResult =
  | { ok: true }
  | { ok: false; error: string };

let cachedVerifier: TelnyxWebhook | null = null;

function verifier(): TelnyxWebhook | null {
  if (cachedVerifier) return cachedVerifier;
  const publicKey = process.env.TELNYX_PUBLIC_KEY;
  if (!publicKey) return null;
  cachedVerifier = new TelnyxWebhook(publicKey);
  return cachedVerifier;
}

export async function verifyWebhook(args: {
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
}): Promise<WebhookVerifyResult> {
  const v = verifier();
  if (!v) return { ok: false, error: "TELNYX_PUBLIC_KEY not configured" };
  if (!args.signatureHeader || !args.timestampHeader) {
    return { ok: false, error: "missing signature headers" };
  }
  try {
    await v.verify(args.rawBody, {
      "telnyx-signature-ed25519": args.signatureHeader,
      "telnyx-timestamp": args.timestampHeader,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
