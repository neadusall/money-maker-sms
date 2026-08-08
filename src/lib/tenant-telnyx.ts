/**
 * Per-tenant Telnyx credentials.
 *
 * The shared OS Text engine sends every workspace's SMS through one Telnyx
 * account by default (the house account in the global TELNYX_* env). A
 * white-label tenant that brings its OWN Telnyx account (its own 10DLC numbers)
 * must send through THAT account, or Telnyx rejects its numbers as an invalid
 * source. This resolves the sending credentials by the campaign's tenant.
 *
 * Config lives in ONE env var, TENANT_TELNYX_CREDS, a JSON map keyed by tenant
 * slug (the same value campaigns.tenant carries, e.g. "lumesp.com"):
 *
 *   TENANT_TELNYX_CREDS={"lumesp.com":{"apiKey":"KEY...","messagingProfileId":"40019f8b-..."}}
 *
 * Returns undefined for the house tenant, unknown tenants, blank input, or a
 * malformed config (every one of those falls back to the global env keys), so
 * the house workspace's sending is byte-for-byte unchanged and a bad config can
 * never take texting down for everyone.
 */
export interface TelnyxCreds {
  apiKey: string;
  messagingProfileId?: string;
}

export function telnyxCredsForTenant(tenant: string | null | undefined): TelnyxCreds | undefined {
  const t = (tenant ?? "").trim().toLowerCase();
  if (!t || t === "house") return undefined;
  const raw = process.env.TENANT_TELNYX_CREDS;
  if (!raw) return undefined;
  try {
    const map = JSON.parse(raw) as Record<string, { apiKey?: string; messagingProfileId?: string }>;
    const c = map[t];
    if (c && typeof c.apiKey === "string" && c.apiKey.trim()) {
      return { apiKey: c.apiKey.trim(), messagingProfileId: c.messagingProfileId?.trim() || undefined };
    }
  } catch {
    // Malformed JSON must never break sending for everyone: fall back to house.
  }
  return undefined;
}
