import { eq, and, isNull, ne, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts, scheduledMessages } from "@/db/schema";
import { isQStashConfigured } from "./schedule";
import { runValidateBatch, runScoreBatch, runSendBatch, dispatchScheduledMessage } from "./drains";
import { sweepReplyAlerts } from "./reply-alerts";
import { runClassifyBacklog } from "./classify-backlog";

/**
 * The in-process clock: the self-hosted replacement for QStash.
 *
 * On Vercel the three drains (validate / score / send) are driven by QStash
 * calling our HTTP endpoints. Self-hosted (the RecruitersOS docker box) there
 * is no QStash, so historically NOTHING ever drained: imported contacts sat in
 * "validating" forever and campaigns never sent. This module arms a plain
 * setInterval on server boot (via src/instrumentation.ts) and sweeps the same
 * drain passes the QStash routes run, so the whole pipeline works with zero
 * external services. When QSTASH_TOKEN is set the clock stands down and QStash
 * keeps the wheel.
 *
 * Concurrency: one sweep at a time (overlap guard); double-send is impossible
 * anyway because processContactSend claims contacts atomically. The interval is
 * unref'd so it never holds the process open.
 */

const SWEEP_MS = (() => {
  const n = Number(process.env.OSTEXT_CLOCK_MS);
  return Number.isFinite(n) && n >= 5_000 ? n : 30_000;
})();

// After this many consecutive zero-progress scoring passes for a campaign, back
// off exponentially (the LLM API is likely down/throttled/unfunded) instead of
// burning a call every sweep forever.
const SCORE_BACKOFF_CAP = 32; // sweeps (~16 min at the default interval)

interface ClockState {
  armed: boolean;
  loggedSetup: boolean;
  standingDown: boolean;
  running: boolean;
  tick: number;
  scoreStalls: Map<string, { stalls: number; skipUntilTick: number }>;
}

// Survive dev hot-reload / multiple imports: one clock per process, ever.
const g = globalThis as typeof globalThis & { __ostextClock?: ClockState };
const state: ClockState = (g.__ostextClock ??= {
  armed: false,
  loggedSetup: false,
  standingDown: false,
  running: false,
  tick: 0,
  scoreStalls: new Map(),
});

/** One-line boot report of every hard dependency, booleans only, so a glance at
 *  `docker logs` says exactly what is wired and what is missing. */
export function logSetupReadiness(): void {
  const has = (k: string) => (process.env[k] || "").trim().length > 0;
  const flag = (k: string) => `${k}=${has(k) ? "set" : "MISSING"}`;
  const fromOk = has("TELNYX_FROM_NUMBER") || has("TELNYX_MESSAGING_PROFILE_ID");
  console.log(
    "[ostext setup] " +
      [
        flag("DATABASE_URL"),
        flag("TELNYX_API_KEY"),
        `TELNYX_FROM_NUMBER|TELNYX_MESSAGING_PROFILE_ID=${fromOk ? "set" : "MISSING"}`,
        flag("TELNYX_PUBLIC_KEY"),
        flag("ANTHROPIC_API_KEY"),
        flag("ACCESS_TOKEN"),
        `QSTASH_TOKEN=${has("QSTASH_TOKEN") ? "set (QStash drives the drains)" : "unset (internal clock drives the drains)"}`,
      ].join(" · "),
  );
}

async function sweep(): Promise<void> {
  if (state.running) return;
  state.running = true;
  state.tick++;
  try {
    // 1. Validation: any campaign holding "validating" contacts gets one batch.
    const validating = await db
      .selectDistinct({ id: contacts.campaignId })
      .from(contacts)
      .where(eq(contacts.status, "validating"));
    for (const { id } of validating) {
      try {
        const r = await runValidateBatch(id);
        if (r.held) {
          console.warn(`[clock validate ${id}] TELNYX_API_KEY missing: ${r.remaining} contacts held as validating`);
        } else {
          console.log(
            `[clock validate ${id}] kept=${r.kept} removed=${r.removed} remaining=${r.remaining}` +
              (r.heldError ? ` heldError=${r.heldError} (Telnyx unreachable, retrying next tick)` : ""),
          );
        }
      } catch (err) {
        console.error(`[clock validate ${id}]`, err);
      }
    }

    // 2. Scoring: campaigns with unscored contacts, but only once their
    // validation has fully drained — scoring a contact validation is about to
    // delete would waste LLM spend. Exponential backoff per campaign when the
    // LLM makes no progress (down, throttled, or out of credit).
    const stillValidating = new Set(validating.map((v) => v.id));
    const unscored = await db
      .selectDistinct({ id: contacts.campaignId })
      .from(contacts)
      .where(and(eq(contacts.optedOut, false), isNull(contacts.qualificationScore), isNull(contacts.deletedAt), ne(contacts.status, "validating")));
    for (const { id } of unscored) {
      if (stillValidating.has(id)) continue;
      const stall = state.scoreStalls.get(id);
      if (stall && state.tick < stall.skipUntilTick) continue;
      try {
        const r = await runScoreBatch(id);
        if (r.gone) { state.scoreStalls.delete(id); continue; }
        if (r.scored > 0) {
          state.scoreStalls.delete(id);
        } else {
          const stalls = (stall?.stalls ?? 0) + 1;
          const wait = Math.min(SCORE_BACKOFF_CAP, 2 ** stalls);
          state.scoreStalls.set(id, { stalls, skipUntilTick: state.tick + wait });
        }
        console.log(
          `[clock score ${id}] scored=${r.scored} failed=${r.failed} remaining=${r.remaining}${r.creditBlocked ? " CREDIT-BLOCKED" : ""}`,
        );
      } catch (err) {
        console.error(`[clock score ${id}]`, err);
      }
    }

    // 3. Sending: one batch per ACTIVE campaign. The batch itself enforces the
    // schedule, the send window, the fit bar, and per-contact atomic claiming.
    const active = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.status, "active"));
    for (const { id } of active) {
      try {
        const r = await runSendBatch(id);
        if (r.state === "ran" && (r.sent || r.failed || r.skipped)) {
          console.log(`[clock send ${id}] sent=${r.sent} failed=${r.failed} skipped=${r.skipped} remaining=${r.remaining}`);
        } else if (r.state === "waiting_window" || r.state === "waiting_schedule" || r.state === "unscheduled") {
          // Quiet: the next sweep re-checks; no need to log every 30s all night.
          // ("unscheduled" = active but no human-set send date & time: the
          // fail-safe holds it, and the campaign page tells the recruiter.)
        } else if (r.state === "waiting_scores") {
          console.log(`[clock send ${id}] waiting on fit scoring (${r.unscored} unscored)`);
        }
      } catch (err) {
        console.error(`[clock send ${id}]`, err);
      }
    }

    // 4. Due scheduled replies (the delayed AI auto-replies): deliver anything
    // whose sendAt has arrived. dispatchScheduledMessage re-checks every kill
    // switch (takeover, paused/manual campaign, opt-out, duplicate guard).
    const due = await db
      .select({ id: scheduledMessages.id })
      .from(scheduledMessages)
      .where(and(eq(scheduledMessages.status, "pending"), lte(scheduledMessages.sendAt, new Date())))
      .limit(50);
    for (const { id } of due) {
      try {
        const r = await dispatchScheduledMessage(id);
        if (!r.ok) console.warn(`[clock reply ${id}] ${r.error}`);
        else if (!r.note) console.log(`[clock reply ${id}] sent`);
      } catch (err) {
        console.error(`[clock reply ${id}]`, err);
      }
    }
    // 5. Recruiter reply alerts: re-text the recruiter's cell for every
    // candidate reply still unanswered past the nag interval, retire alerts
    // that got a human response. Also delivers any first alert whose instant
    // send failed.
    try {
      const r = await sweepReplyAlerts();
      if (r.nagged || r.resolved) {
        console.log(`[clock reply-alerts] nagged=${r.nagged} resolved=${r.resolved}`);
      }
    } catch (err) {
      console.error("[clock reply-alerts]", err);
    }
    // 6. Classification backlog: replies that arrived while the LLM key was
    // missing/broken get triaged now, so the KPI reply mix and opt-out counts
    // heal themselves instead of undercounting forever. No-ops instantly when
    // there is no key or no backlog.
    try {
      const r = await runClassifyBacklog();
      if (r.classified || r.failed) {
        console.log(`[clock classify-backlog] classified=${r.classified} failed=${r.failed} remaining=${r.remaining}`);
      }
    } catch (err) {
      console.error("[clock classify-backlog]", err);
    }
  } catch (err) {
    // One bad sweep must never kill the clock.
    console.error("[clock] sweep error:", err);
  } finally {
    state.running = false;
  }
}

/**
 * Arm the clock (idempotent; called once from instrumentation at boot).
 * Stands down when QStash is configured — one wheel, never two.
 */
export function startInternalClock(): void {
  if (!state.loggedSetup) {
    state.loggedSetup = true;
    logSetupReadiness();
  }
  if (state.armed || state.standingDown) return;
  if (isQStashConfigured()) {
    state.standingDown = true;
    console.log("[clock] QSTASH_TOKEN set: internal clock standing down, QStash drives the drains");
    return;
  }
  state.armed = true;
  const t = setInterval(() => { void sweep(); }, SWEEP_MS);
  if (typeof t === "object" && t && "unref" in t) (t as unknown as { unref: () => void }).unref();
  setTimeout(() => { void sweep(); }, 5_000);
  console.log(`[clock] internal drain clock armed (every ${Math.round(SWEEP_MS / 1000)}s): validate, score, send, no external queue needed`);
}

/**
 * Nudge the clock to sweep now (e.g. right after Activate / an import) instead
 * of waiting for the next interval. No-op when QStash is the driver — callers
 * enqueue through QStash in that case.
 */
export function kickSoon(): void {
  if (isQStashConfigured()) return;
  // Arm lazily too: a server action can land before/without instrumentation.
  startInternalClock();
  setTimeout(() => { void sweep(); }, 1_000);
}
