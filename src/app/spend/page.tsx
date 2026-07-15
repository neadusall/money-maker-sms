import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LiveBadge } from "@/components/LiveBadge";
import { KpiCard, MiniStat } from "@/components/Stats";

export const dynamic = "force-dynamic";

// Per-unit cost assumptions (override via env). Shown on the page so they're auditable.
const SMS_OUT = Number(process.env.SMS_OUT_COST ?? "0.0079");
const SMS_IN = Number(process.env.SMS_IN_COST ?? "0.001");
const PROFILE_COST = Number(process.env.RAPIDAPI_PROFILE_COST ?? "0.00267");
const HETZNER_MO = Number(process.env.HETZNER_MONTHLY ?? "8");
const RAPIDAPI_MO = Number(process.env.RAPIDAPI_MONTHLY ?? "40");
const TZ = process.env.APP_TIMEZONE ?? "America/Chicago";
// Chars added to every outbound body at send time: "\n\nReply STOP to opt out."
const OPT_OUT_LEN = 24;
// SQL: estimated Telnyx segment count for an outbound `body` (GSM-7 assumption).
const OUTBOUND_SEGMENTS = sql`CASE WHEN char_length(body) + ${OPT_OUT_LEN} <= 160 THEN 1 ELSE ceil((char_length(body) + ${OPT_OUT_LEN})::numeric / 153) END`;

function usd(n: number): string {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function one(q: Parameters<typeof db.execute>[0]): Promise<Record<string, number | string | null>> {
  const r = (await db.execute(q)) as { rows?: Record<string, number | string | null>[] };
  return (r.rows ?? [])[0] ?? {};
}
async function many(q: Parameters<typeof db.execute>[0]): Promise<Record<string, number | string | null>[]> {
  const r = (await db.execute(q)) as { rows?: Record<string, number | string | null>[] };
  return r.rows ?? [];
}

export default async function SpendPage() {
  const llm = await one(sql`
    SELECT coalesce(sum(cost_usd),0)::float AS total,
           coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())),0)::float AS mtd,
           coalesce(sum(input_tokens + output_tokens),0)::bigint AS tokens,
           count(*)::int AS calls
    FROM usage_events`);
  const byPurpose = await many(sql`
    SELECT purpose, coalesce(sum(cost_usd),0)::float c, count(*)::int n
    FROM usage_events GROUP BY purpose ORDER BY c DESC`);
  // Telnyx bills per SEGMENT, not per message: 1 segment <=160 chars, else 153
  // chars/segment. Outbound bodies are stored without the appended opt-out line,
  // so add its length (OPT_OUT_LEN) to estimate the real billed segment count.
  const msg = await one(sql`
    SELECT count(*) FILTER (WHERE direction='outbound')::int outb,
           count(*) FILTER (WHERE direction='inbound')::int inb,
           coalesce(sum(${OUTBOUND_SEGMENTS}) FILTER (WHERE direction='outbound'),0)::int outb_seg,
           coalesce(sum(${OUTBOUND_SEGMENTS}) FILTER (WHERE direction='outbound' AND created_at >= date_trunc('month', now())),0)::int outb_seg_m,
           count(*) FILTER (WHERE direction='outbound' AND created_at >= date_trunc('month', now()))::int outb_m,
           count(*) FILTER (WHERE direction='inbound' AND created_at >= date_trunc('month', now()))::int inb_m
    FROM messages`);
  const li = await one(sql`
    SELECT count(*) FILTER (WHERE enriched_profile IS NOT NULL)::int enriched,
           count(*) FILTER (WHERE enriched_profile IS NOT NULL AND enriched_at >= date_trunc('month', now()))::int enriched_m
    FROM contacts`);

  // Per-day spend (in the app timezone) across all three usage sources, last 14 days.
  const daily = await many(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day,
           coalesce(sum(cost),0)::float AS total,
           coalesce(sum(cost) FILTER (WHERE src='llm'),0)::float AS llm,
           coalesce(sum(cost) FILTER (WHERE src='sms'),0)::float AS sms,
           coalesce(sum(cost) FILTER (WHERE src='li'),0)::float AS li
    FROM (
      SELECT (created_at AT TIME ZONE ${TZ})::date AS day, cost_usd::float AS cost, 'llm' AS src FROM usage_events
      UNION ALL
      SELECT (created_at AT TIME ZONE ${TZ})::date, (CASE WHEN direction='outbound' THEN (${OUTBOUND_SEGMENTS}) * ${SMS_OUT}::float ELSE ${SMS_IN}::float END), 'sms' FROM messages
      UNION ALL
      SELECT (enriched_at AT TIME ZONE ${TZ})::date, ${PROFILE_COST}::float, 'li' FROM contacts WHERE enriched_profile IS NOT NULL AND enriched_at IS NOT NULL
    ) t
    WHERE day >= (now() AT TIME ZONE ${TZ})::date - 13
    GROUP BY day ORDER BY day DESC`);

  const outb = Number(msg.outb ?? 0), inb = Number(msg.inb ?? 0), outbM = Number(msg.outb_m ?? 0), inbM = Number(msg.inb_m ?? 0);
  const outbSeg = Number(msg.outb_seg ?? 0), outbSegM = Number(msg.outb_seg_m ?? 0);
  const enriched = Number(li.enriched ?? 0), enrichedM = Number(li.enriched_m ?? 0);
  const llmTotal = Number(llm.total ?? 0), llmMonth = Number(llm.mtd ?? 0);

  // Outbound billed by segment; inbound per message.
  const smsCost = outbSeg * SMS_OUT + inb * SMS_IN;
  const smsCostM = outbSegM * SMS_OUT + inbM * SMS_IN;
  const liCost = enriched * PROFILE_COST;
  const liCostM = enrichedM * PROFILE_COST;

  const monthVariable = smsCostM + llmMonth + liCostM;
  const monthTotal = monthVariable + HETZNER_MO + RAPIDAPI_MO;
  const allVariable = smsCost + llmTotal + liCost;

  // Today's spend (app timezone) pulled from the daily series.
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const todayRow = daily.find((d) => String(d.day) === todayStr);
  const todayTotal = Number(todayRow?.total ?? 0);
  const todayLlm = Number(todayRow?.llm ?? 0);
  const maxDay = Math.max(0.01, ...daily.map((d) => Number(d.total)));

  // What's driving spend: largest LLM purpose + per-contact scoring rate.
  const scoreRow = byPurpose.find((p) => String(p.purpose) === "score");
  const scoreCost = Number(scoreRow?.c ?? 0);
  const scoreCalls = Number(scoreRow?.n ?? 0);
  const perScore = scoreCalls > 0 ? scoreCost / scoreCalls : 0;
  const topPurpose = byPurpose[0];

  const purposeLabel: Record<string, string> = {
    score: "Candidate scoring",
    rubric: "Rubric generation",
    classify: "Reply classification",
    draft: "Reply drafting",
    todos: "To-do extraction",
  };

  return (
    <section className="grid gap-6">
      <AutoRefresh intervalMs={10000} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Spend</h1>
            <LiveBadge />
          </div>
          <p className="mt-1 text-sm text-zinc-600">Real-time cost tracking across Telnyx, LLM, and LinkedIn enrichment.</p>
        </div>
      </div>

      {/* Headline: running total, today, this month */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Running total (all-time)" value={usd(allVariable)} accent="zinc" hint="usage across all services" />
        <KpiCard label="Today" value={usd(todayTotal)} accent="amber" chip={`${usd(todayLlm)} LLM`} hint={`since midnight ${TZ}`} />
        <KpiCard label="This month" value={usd(monthTotal)} accent="sky" hint="usage + fixed costs" />
        <KpiCard label="LLM (Anthropic)" value={usd(llmTotal)} accent="violet" chip={`${Number(llm.calls ?? 0)} calls`} hint="all-time: scoring + replies" />
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat label="Telnyx SMS (all)" value={usd(smsCost)} accent="sky" />
        <MiniStat label="LinkedIn (all)" value={usd(liCost)} accent="emerald" />
        <MiniStat label="Usage this mo" value={usd(monthVariable)} accent="amber" />
        <MiniStat label="Hetzner + RapidAPI (mo)" value={usd(HETZNER_MO + RAPIDAPI_MO)} />
        <MiniStat label="LLM tokens" value={Number(llm.tokens ?? 0).toLocaleString()} />
      </div>

      {/* What's driving the spend */}
      <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
        <h3 className="text-sm font-semibold text-violet-900">What&apos;s driving your spend</h3>
        <p className="mt-1.5 text-sm text-violet-900/90">
          The biggest cost is <strong>{purposeLabel[String(topPurpose?.purpose)] ?? "candidate scoring"}</strong>. Every
          contact you upload is scored once by Claude against the job description{" "}
          {perScore > 0 ? (
            <>
              : about <strong>{usd(perScore)}</strong> per candidate ({scoreCalls.toLocaleString()} scored so far ={" "}
              {usd(scoreCost)}).
            </>
          ) : (
            <>(charged per candidate scored).</>
          )}{" "}
          Reply <em>classification</em> and <em>drafting</em> add a small cost each time a candidate texts back, and a
          one-time <em>rubric</em> is generated per campaign. SMS is billed per message through Telnyx; LinkedIn
          enrichment is billed per profile pulled through RapidAPI.
        </p>
        <p className="mt-2 text-xs text-violet-800/80">
          LLM spend is metered from real token usage on every call, so this updates the moment scoring or a reply runs.
          Scoring a large new list is the main thing that moves this number, and what can exhaust your Anthropic credit
          balance if it isn&apos;t topped up.
        </p>
      </div>

      {/* Daily spend, last 14 days */}
      <div className="rounded-2xl border border-zinc-200 bg-surface p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-zinc-700">Daily spend</h3>
          <span className="text-[10px] uppercase tracking-wide text-zinc-400">last 14 days · {TZ}</span>
        </div>
        <div className="mt-3 space-y-1.5">
          {daily.length === 0 ? (
            <div className="text-xs text-zinc-400">No usage recorded yet.</div>
          ) : (
            daily.map((d) => {
              const total = Number(d.total);
              const w = `${Math.max(2, (total / maxDay) * 100)}%`;
              const isToday = String(d.day) === todayStr;
              return (
                <div key={String(d.day)} className="flex items-center gap-3 text-sm">
                  <span className={"w-28 shrink-0 tabular-nums " + (isToday ? "font-semibold text-zinc-900" : "text-zinc-500")}>
                    {new Date(String(d.day) + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                    {isToday ? " ·today" : ""}
                  </span>
                  <div className="relative h-4 flex-1 overflow-hidden rounded bg-zinc-100">
                    <div className="absolute inset-y-0 left-0 rounded bg-violet-500/80" style={{ width: w }} />
                  </div>
                  <span className="w-20 shrink-0 text-right tabular-nums font-medium text-zinc-900">{usd(total)}</span>
                </div>
              );
            })
          )}
        </div>
        <p className="mt-3 text-[11px] text-zinc-400">Bars show total daily spend (LLM + SMS + LinkedIn). Newest at top.</p>
      </div>

      {/* Breakdown by service */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Telnyx: SMS" total={usd(smsCost)} sub="all-time">
          <Line label={`Outbound (${outb} msgs → ${outbSeg} segs)`} detail={`@ ${usd(SMS_OUT)}/seg`} value={usd(outbSeg * SMS_OUT)} />
          <Line label={`Inbound (${inb})`} detail={`@ ${usd(SMS_IN)}/msg`} value={usd(inb * SMS_IN)} />
        </Panel>

        <Panel title="LLM: Anthropic" total={usd(llmTotal)} sub="all-time">
          {byPurpose.length === 0 ? (
            <div className="text-xs text-zinc-400">No LLM usage logged yet.</div>
          ) : (
            byPurpose.map((p) => (
              <Line
                key={String(p.purpose)}
                label={purposeLabel[String(p.purpose)] ?? String(p.purpose ?? "other")}
                detail={`${Number(p.n)} calls`}
                value={usd(Number(p.c))}
              />
            ))
          )}
        </Panel>

        <Panel title="LinkedIn: RapidAPI" total={usd(liCost)} sub="all-time, usage">
          <Line label={`Profiles enriched (${enriched})`} detail={`@ ${usd(PROFILE_COST)}/profile`} value={usd(liCost)} />
          <Line label="Monthly plan" detail="15,000 requests included" value={usd(RAPIDAPI_MO) + "/mo"} />
        </Panel>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500">
        <p className="font-medium text-zinc-700">How each number is tracked</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>
            <strong>LLM (Anthropic): exact.</strong> Every Claude call (scoring, rubric, reply classification &amp;
            drafting, to-do extraction) logs its real token usage and cost the instant it runs, so this updates live as
            each list is scored.
          </li>
          <li>
            <strong>SMS (Telnyx): segment-estimated.</strong> Outbound is billed per 153-char segment (incl. the
            appended &quot;Reply STOP to opt out.&quot; line), {usd(SMS_OUT)}/segment; inbound {usd(SMS_IN)}/message.
            Assumes standard (GSM-7) text.
          </li>
          <li>
            <strong>LinkedIn (RapidAPI): per profile pulled,</strong> {usd(PROFILE_COST)}/profile, within the{" "}
            {usd(RAPIDAPI_MO)}/mo plan (15,000 requests). Lookups that return nothing aren&apos;t charged here.
          </li>
          <li>
            <strong>Fixed monthly:</strong> Hetzner {usd(HETZNER_MO)} + RapidAPI {usd(RAPIDAPI_MO)}. Neon + QStash are on
            free tiers. Rates are overridable via the SMS_OUT_COST / SMS_IN_COST / RAPIDAPI_PROFILE_COST env vars.
          </li>
        </ul>
      </div>
    </section>
  );
}

function Panel({ title, total, sub, children }: { title: string; total: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-surface p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-700">{title}</h3>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums text-zinc-900">{total}</div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-400">{sub}</div>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">{children}</div>
    </div>
  );
}

function Line({ label, detail, value }: { label: string; detail: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-zinc-700">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-[11px] text-zinc-400">{detail}</span>
        <span className="tabular-nums font-medium text-zinc-900">{value}</span>
      </span>
    </div>
  );
}
