import type { CapState } from "@/lib/daily-cap";

/**
 * "Is today's volume actually spread out?" — the day-spreading gauge.
 *
 * A daily cap is only protection if the sends are distributed across the window. This card
 * shows the two numbers that prove it: how far through the send window we are, and how much
 * of today's allowance has gone out. When the bars track each other, the line is pacing.
 * When the sent bar runs far ahead of the clock bar, something is blasting.
 *
 * It also surfaces the warm-up ramp honestly. On day three of a 20/step ramp the allowance
 * is 60, not 200, and a recruiter wondering why "only 60 went out" deserves to see that
 * written down rather than filing a bug.
 */
export function SendPacing({
  cap,
  windowStart,
  windowEnd,
  byLane,
}: {
  cap: CapState;
  windowStart: string;
  windowEnd: string;
  byLane: { telnyx: number; imessage: number };
}) {
  if (!cap.capped) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-surface p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-zinc-700">Daily pacing</h3>
        <p className="mt-2 text-sm text-zinc-500">
          No daily cap set: this campaign sends as fast as the batch drain allows.
        </p>
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          On a single business line that is the fastest way to lose the number. Set a daily
          cap in campaign settings and the sends spread evenly across the {windowStart} to{" "}
          {windowEnd} window instead of going out as one burst.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <LaneCount label="Sent today on iMessage" value={byLane.imessage} dot="bg-[#0b84ff]" />
          <LaneCount label="Sent today on SMS" value={byLane.telnyx} dot="bg-[#34c759]" />
        </div>
      </section>
    );
  }

  const sentPct = cap.allowance ? Math.min(100, Math.round((cap.sentToday / cap.allowance) * 100)) : 0;
  const clockPct = cap.allowance ? Math.min(100, Math.round((cap.earned / cap.allowance) * 100)) : 0;
  // Running more than a fifth of the day's budget ahead of the clock is the shape that
  // precedes a filtered number.
  const ahead = sentPct - clockPct >= 20;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-surface p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-700">Daily pacing</h3>
        <span className="text-xs text-zinc-400">
          {windowStart}&ndash;{windowEnd}
        </span>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <span className="text-3xl font-semibold tabular-nums tracking-tight text-zinc-900">
          {cap.sentToday}
        </span>
        <span className="mb-1 text-sm text-zinc-500">of {cap.allowance} today</span>
        {cap.releasable > 0 ? (
          <span className="mb-1 ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            {cap.releasable} ready to go
          </span>
        ) : (
          <span className="mb-1 ml-auto rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
            paced &mdash; waiting
          </span>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <Bar label="Sent so far" pct={sentPct} bar={ahead ? "bg-rose-500" : "bg-sky-500"} />
        <Bar label="Window elapsed" pct={clockPct} bar="bg-zinc-300" />
      </div>

      {ahead ? (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          Sending is running ahead of the clock. That is the burst pattern carriers score and
          Apple blocks lines for.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <LaneCount label="Sent today on iMessage" value={byLane.imessage} dot="bg-[#0b84ff]" />
        <LaneCount label="Sent today on SMS" value={byLane.telnyx} dot="bg-[#34c759]" />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
        Day {cap.dayIndex + 1} of sending.
        {cap.allowance > 0 ? ` Today's allowance is ${cap.allowance}` : ""}
        {cap.allowance > 0
          ? ", released a share at a time as the send window elapses, with random spacing between each message."
          : ""}
      </p>
    </section>
  );
}

function Bar({ label, pct, bar }: { label: string; pct: number; bar: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-zinc-600">{label}</span>
        <span className="tabular-nums text-zinc-400">{pct}%</span>
      </div>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`h-full rounded-full ${bar} transition-[width] duration-700 ease-out`}
          style={{ width: `${Math.max(pct ? 2 : 0, pct)}%` }}
        />
      </div>
    </div>
  );
}

function LaneCount({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</span>
      </div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-zinc-900">{value}</div>
    </div>
  );
}
