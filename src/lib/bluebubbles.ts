import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { handleCapabilities } from "@/db/schema";

/**
 * BlueBubbles Mac bridge client. The Mac runs BlueBubbles Server signed into
 * the owner's Apple ID; this module is the only place OS Text talks to it.
 *
 * Everything here is fail-safe by construction: with no BLUEBUBBLES_URL /
 * BLUEBUBBLES_PASSWORD configured, isBridgeConfigured() is false and the
 * router never calls any of these — the app behaves exactly as the
 * Telnyx-only build did.
 *
 * Endpoint shapes were written against BlueBubbles Server v1.9 REST docs and
 * MUST be verified against the actual server installed on the Mac before the
 * iMessage lane is enabled (payloads have drifted between BB releases; see
 * reconcile below for why we never guess).
 */

const DEFAULT_TIMEOUT_MS = 12_000;
const AVAILABILITY_TTL_MS = 24 * 60 * 60 * 1000;

export function isBridgeConfigured(): boolean {
  return Boolean(process.env.BLUEBUBBLES_URL && process.env.BLUEBUBBLES_PASSWORD);
}

function bridgeUrl(path: string): URL {
  const base = process.env.BLUEBUBBLES_URL!;
  const u = new URL(path, base.endsWith("/") ? base : `${base}/`);
  u.searchParams.set("password", process.env.BLUEBUBBLES_PASSWORD!);
  return u;
}

class BridgeTimeoutError extends Error {
  constructor(ms: number) {
    super(`BlueBubbles request timed out after ${ms}ms`);
    this.name = "BridgeTimeoutError";
  }
}

export function isAmbiguousBridgeError(err: unknown): boolean {
  if (err instanceof BridgeTimeoutError) return true;
  // Socket died mid-flight: the request may still have reached Messages.app.
  const msg = err instanceof Error ? err.message : String(err);
  return /timed? ?out|ECONNRESET|socket hang up|aborted/i.test(msg);
}

async function bridgeFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = Number(process.env.BLUEBUBBLES_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(bridgeUrl(path), {
      ...init,
      signal: ctl.signal,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
    const raw = await res.text();
    let data: unknown;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }
    if (!res.ok) {
      const d = data as { error?: { message?: string }; message?: string };
      throw new Error(d?.error?.message || d?.message || `BlueBubbles HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new BridgeTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export type BridgeHealth = {
  configured: boolean;
  healthy: boolean;
  latencyMs: number | null;
  error: string | null;
};

export async function bridgeHealth(): Promise<BridgeHealth> {
  if (!isBridgeConfigured()) {
    return { configured: false, healthy: false, latencyMs: null, error: null };
  }
  const start = Date.now();
  try {
    await bridgeFetch("api/v1/server/info", { method: "GET" }, 5_000);
    return { configured: true, healthy: true, latencyMs: Date.now() - start, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { configured: true, healthy: false, latencyMs: Date.now() - start, error: message };
  }
}

/**
 * Can this handle receive iMessage? true / false / null (unknown).
 *
 * Cached in handle_capabilities for 24h so campaign batches don't hammer the
 * Mac. BB's availability check has documented false negatives, so a `false`
 * here only means "route to Telnyx", never "this person has no iPhone".
 * Any bridge error caches null — the router treats null as "use Telnyx".
 */
export async function checkIMessageAvailability(phoneE164: string): Promise<boolean | null> {
  const [cached] = await db
    .select()
    .from(handleCapabilities)
    .where(eq(handleCapabilities.phone, phoneE164))
    .limit(1);
  if (cached && Date.now() - cached.checkedAt.getTime() < AVAILABILITY_TTL_MS) {
    return cached.imessage;
  }
  let available: boolean | null = null;
  try {
    const data = (await bridgeFetch(
      `api/v1/handle/availability/imessage?address=${encodeURIComponent(phoneE164)}`,
      { method: "GET" },
      8_000,
    )) as { data?: { available?: unknown } ; available?: unknown };
    const value = data?.data?.available ?? data?.available;
    available = typeof value === "boolean" ? value : null;
  } catch {
    available = null;
  }
  await db
    .insert(handleCapabilities)
    .values({ phone: phoneE164, imessage: available, checkedAt: new Date() })
    .onConflictDoUpdate({
      target: handleCapabilities.phone,
      set: { imessage: available, checkedAt: new Date() },
    });
  return available;
}

export type BridgeSendResult = { guid: string | null };

/**
 * Send a 1:1 text through Messages.app. `tempGuid` is OUR key for the attempt:
 * if the HTTP call dies ambiguously, reconcileSend(tempGuid) is the only
 * evidence of whether the iMessage actually left the Mac.
 */
export async function sendBridgeText(
  phoneE164: string,
  body: string,
  tempGuid: string,
): Promise<BridgeSendResult> {
  const method = process.env.BLUEBUBBLES_METHOD === "private-api" ? "private-api" : "apple-script";
  const data = (await bridgeFetch("api/v1/message/text", {
    method: "POST",
    body: JSON.stringify({
      chatGuid: `any;-;${phoneE164}`,
      tempGuid,
      message: body,
      method,
    }),
  })) as { data?: { guid?: unknown }; guid?: unknown };
  const guid = data?.data?.guid ?? data?.guid;
  return { guid: typeof guid === "string" ? guid : null };
}

/**
 * Did an ambiguous send actually go out? Deliberately conservative: only a
 * confirmed GUID counts as "found". Every error path answers found:false,
 * which keeps the message in 'uncertain' (never a Telnyx resend) until a
 * later sweep or a human resolves it.
 *
 * NOTE: the lookup path varies across BlueBubbles releases. Verify against
 * the installed server (GET /api/v1/message/:guid vs message query search)
 * when the Mac is stood up — this is the one function the scaffold and we
 * both refuse to guess at.
 */
export async function reconcileSend(tempGuid: string): Promise<{ found: boolean; guid?: string }> {
  try {
    const data = (await bridgeFetch(
      `api/v1/message/${encodeURIComponent(tempGuid)}`,
      { method: "GET" },
      Number(process.env.BLUEBUBBLES_RECONCILE_MS) || 6_000,
    )) as { data?: { guid?: unknown }; guid?: unknown };
    const guid = data?.data?.guid ?? data?.guid;
    return typeof guid === "string" ? { found: true, guid } : { found: false };
  } catch {
    return { found: false };
  }
}
