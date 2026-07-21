/**
 * Server-boot hook (Next.js instrumentation convention): arms the in-process
 * drain clock so self-hosted deployments (no QStash) validate, score, and send
 * on their own. Logs a one-line setup readiness report either way.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Tenant isolation columns must exist before any page renders (every list
  // query filters on campaigns.tenant). Idempotent DDL; retried because the
  // database container may still be coming up alongside this one.
  const { ensureTenantSchema } = await import("@/lib/tenant");
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await ensureTenantSchema();
      break;
    } catch (err) {
      console.error(`[boot] tenant schema ensure failed (attempt ${attempt}/5):`, err);
      if (attempt < 5) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const { startInternalClock } = await import("@/lib/internal-clock");
  startInternalClock();
}
