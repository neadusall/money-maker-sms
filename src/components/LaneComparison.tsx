import type { LaneComparison as LaneComparisonData, LaneRow } from "@/lib/lane-stats";

/**
 * "Which lane is actually working?" — the blue-vs-green scoreboard.
 *
 * Design rules this card follows, because the whole point is to make a spending decision:
 *  - Reply rate is the headline, not sends. Volume is easy to buy; answers are not.
 *  - Both rows are always rendered, zeros included. A lane showing 0 is information ("no
 *    blue bubbles have actually gone out yet"); a missing row reads as a bug.
 *  - No winner is declared until BOTH lanes clear the sample floor. An early "iMessage wins"
 *    off forty sends is worse than no answer at all.
 */

const BAR: Record<string, string> = {
  imessage: "bg-[#0b84ff]",
  sms: "bg-[#34c759]",
};
const DOT: Record<string, string> = {
  imessage: "bg-[#0b84ff]",
  sms: "bg-[#34c759]",
};

export function LaneComparison({ data }: { data: LaneComparisonData }) {
  const active = data.rows.filter((r) => r.sent > 0);
  const peak = Math.max(1, ...data.rows.map((r) => r.replyRatePct));

  return (
    <section className="rounded-2xl border border-zinc-200 bg-surface p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-700">iMessage vs SMS</h3>
        <span className="text-xs text-zinc-400">last {data.days} days</span>
      </div>

      <p
        className={
          "mt-2 rounded-lg px-3 py-2 text-xs " +
          (data.verdictReady ? "bg-zinc-50 text-zinc-700" : "bg-amber-50 text-amber-800")
        }
      >
        {data.verdict}
      </p>

      {active.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">
          No sends yet in this window. Once a campaign sends on either lane, the comparison
          fills in here.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {data.rows.map((r) => (
            <LaneLine key={r.lane} row={r} peak={peak} />
          ))}
        </div>
      )}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-zinc-400">
              <th className="pb-2 font-medium">Lane</th>
              <th className="pb-2 text-right font-medium">Sent</th>
              <th className="pb-2 text-right font-medium">Reached</th>
              <th className="pb-2 text-right font-medium">Delivered</th>
              <th className="pb-2 text-right font-medium">Replied</th>
              <th className="pb-2 text-right font-medium">Positive</th>
              <th className="pb-2 text-right font-medium">Opt-outs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {data.rows.map((r) => (
              <tr key={r.lane} className={r.sent === 0 ? "text-zinc-400" : "text-zinc-700"}>
                <td className="py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${DOT[r.lane]}`} />
                    {r.label}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">{r.sent}</td>
                <td className="py-2 text-right tabular-nums">{r.recipients}</td>
                <td className="py-2 text-right tabular-nums">
                  {r.delivered}
                  {r.sent ? <span className="ml-1 text-zinc-400">{r.deliveredRatePct}%</span> : null}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums">
                  {r.replied}
                  {r.recipients ? <span className="ml-1 font-normal text-zinc-400">{r.replyRatePct}%</span> : null}
                </td>
                <td className="py-2 text-right tabular-nums">{r.positive}</td>
                <td className="py-2 text-right tabular-nums">{r.optedOut}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
        Reply rate counts distinct people who answered, excluding STOPs, and credits each
        reply to the lane of the message it answered. iMessage sends leave from our own Mac
        bridge, so a blue row here is a real blue bubble on the candidate&rsquo;s phone.
      </p>
    </section>
  );
}

function LaneLine({ row, peak }: { row: LaneRow; peak: number }) {
  const width = row.recipients ? Math.max(2, Math.round((row.replyRatePct / peak) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium text-zinc-700">
          <span className={`h-2 w-2 rounded-full ${DOT[row.lane]}`} />
          {row.label}
        </span>
        <span className="tabular-nums text-zinc-500">
          <span className="font-semibold text-zinc-900">{row.replyRatePct}%</span>
          <span className="ml-1.5 text-xs text-zinc-400">
            {row.replied}/{row.recipients} replied
          </span>
        </span>
      </div>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`h-full rounded-full ${BAR[row.lane]} transition-[width] duration-700 ease-out`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}
