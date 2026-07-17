/**
 * Server-boot hook (Next.js instrumentation convention): arms the in-process
 * drain clock so self-hosted deployments (no QStash) validate, score, and send
 * on their own. Logs a one-line setup readiness report either way.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startInternalClock } = await import("@/lib/internal-clock");
  startInternalClock();
}
