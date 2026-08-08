import type { ReactNode } from "react";

export function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

type Accent = "zinc" | "sky" | "violet" | "emerald" | "amber" | "rose";

const ACCENT: Record<
  Accent,
  { value: string; bar: string; chipBg: string; chipText: string; iconBg: string; iconText: string }
> = {
  zinc: {
    value: "text-zinc-900",
    bar: "bg-zinc-400",
    chipBg: "bg-zinc-100",
    chipText: "text-zinc-600",
    iconBg: "bg-zinc-100",
    iconText: "text-zinc-500",
  },
  sky: {
    value: "text-sky-700",
    bar: "bg-sky-500",
    chipBg: "bg-sky-50",
    chipText: "text-sky-700",
    iconBg: "bg-sky-50",
    iconText: "text-sky-600",
  },
  violet: {
    value: "text-violet-700",
    bar: "bg-violet-500",
    chipBg: "bg-violet-50",
    chipText: "text-violet-700",
    iconBg: "bg-violet-50",
    iconText: "text-violet-600",
  },
  emerald: {
    value: "text-emerald-700",
    bar: "bg-emerald-500",
    chipBg: "bg-emerald-50",
    chipText: "text-emerald-700",
    iconBg: "bg-emerald-50",
    iconText: "text-emerald-600",
  },
  amber: {
    value: "text-amber-700",
    bar: "bg-amber-500",
    chipBg: "bg-amber-50",
    chipText: "text-amber-700",
    iconBg: "bg-amber-50",
    iconText: "text-amber-600",
  },
  rose: {
    value: "text-rose-700",
    bar: "bg-rose-500",
    chipBg: "bg-rose-50",
    chipText: "text-rose-700",
    iconBg: "bg-rose-50",
    iconText: "text-rose-600",
  },
};

/** Large headline KPI card with an optional rate chip and icon. */
export function KpiCard({
  label,
  value,
  accent = "zinc",
  chip,
  hint,
  icon,
}: {
  label: string;
  value: number | string;
  accent?: Accent;
  chip?: string;
  hint?: string;
  icon?: ReactNode;
}) {
  const a = ACCENT[accent];
  return (
    <div className="rounded-2xl border border-zinc-200 bg-surface p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
        {icon ? (
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${a.iconBg} ${a.iconText}`}>
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className={`text-3xl font-semibold tabular-nums tracking-tight ${a.value}`}>{value}</span>
        {chip ? (
          <span className={`mb-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.chipBg} ${a.chipText}`}>
            {chip}
          </span>
        ) : null}
      </div>
      {hint ? <div className="mt-1 text-xs text-zinc-400">{hint}</div> : null}
    </div>
  );
}

/** A conversion funnel: each stage's bar width is relative to the first stage. */
export function Funnel({
  stages,
}: {
  stages: { label: string; value: number; accent: Accent; rateOf?: number }[];
}) {
  const base = stages[0]?.value || 0;
  return (
    <div className="rounded-2xl border border-zinc-200 bg-surface p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-zinc-700">Conversion funnel</h3>
      <div className="mt-4 space-y-3">
        {stages.map((s, i) => {
          const a = ACCENT[s.accent];
          const widthPct = base ? Math.max(2, Math.round((s.value / base) * 100)) : 0;
          const conv = s.rateOf != null ? pct(s.value, s.rateOf) : null;
          return (
            <div key={s.label}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-zinc-700">{s.label}</span>
                <span className="tabular-nums text-zinc-500">
                  <span className="font-semibold text-zinc-900">{s.value}</span>
                  {conv != null && i > 0 ? <span className="ml-1.5 text-xs text-zinc-400">{conv}%</span> : null}
                </span>
              </div>
              <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className={`h-full rounded-full ${a.bar} transition-[width] duration-700 ease-out`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Segmented sentiment meter: positive / neutral / negative with a legend. */
export function SentimentMeter({
  positive,
  neutral,
  negative,
}: {
  positive: number;
  neutral: number;
  negative: number;
}) {
  const total = positive + neutral + negative;
  const seg = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <div className="rounded-2xl border border-zinc-200 bg-surface p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-700">Reply sentiment</h3>
        <span className="text-xs text-zinc-400">{total} classified</span>
      </div>
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-zinc-100">
        {total === 0 ? null : (
          <>
            <div className="h-full bg-emerald-500 transition-[width] duration-700" style={{ width: `${seg(positive)}%` }} />
            <div className="h-full bg-zinc-300 transition-[width] duration-700" style={{ width: `${seg(neutral)}%` }} />
            <div className="h-full bg-rose-500 transition-[width] duration-700" style={{ width: `${seg(negative)}%` }} />
          </>
        )}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Legend dot="bg-emerald-500" label="Positive" value={positive} sub={total ? `${pct(positive, total)}%` : "-"} />
        <Legend dot="bg-zinc-300" label="Neutral" value={neutral} sub={total ? `${pct(neutral, total)}%` : "-"} />
        <Legend dot="bg-rose-500" label="Negative" value={negative} sub={total ? `${pct(negative, total)}%` : "-"} />
      </div>
    </div>
  );
}

function Legend({ dot, label, value, sub }: { dot: string; label: string; value: number; sub: string }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-2 py-2">
      <div className="flex items-center justify-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      </div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-zinc-900">{value}</div>
      <div className="text-[11px] text-zinc-400">{sub}</div>
    </div>
  );
}

/** Compact secondary stat used in a row of small metrics. */
export function MiniStat({
  label,
  value,
  accent = "zinc",
}: {
  label: string;
  value: number | string;
  accent?: Accent;
}) {
  const a = ACCENT[accent];
  return (
    <div className="rounded-xl border border-zinc-200 bg-surface px-3 py-3">
      <div className={`text-xl font-semibold tabular-nums ${a.value}`}>{value}</div>
      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</div>
    </div>
  );
}
