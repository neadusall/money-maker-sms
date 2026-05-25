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
  const msg = await one(sql`
    SELECT count(*) FILTER (WHERE direction='outbound')::int outb,
           count(*) FILTER (WHERE direction='inbound')::int inb,
           count(*) FILTER (WHERE direction='outbound' AND created_at >= date_trunc('month', now()))::int outb_m,
           count(*) FILTER (WHERE direction='inbound' AND created_at >= date_trunc('month', now()))::int inb_m
    FROM messages`);
  const li = await one(sql`
    SELECT count(*) FILTER (WHERE enriched_profile IS NOT NULL)::int enriched,
           count(*) FILTER (WHERE enriched_profile IS NOT NULL AND enriched_at >= date_trunc('month', now()))::int enriched_m
    FROM contacts`);

  const outb = Number(msg.outb ?? 0), inb = Number(msg.inb ?? 0), outbM = Number(msg.outb_m ?? 0), inbM = Number(msg.inb_m ?? 0);
  const enriched = Number(li.enriched ?? 0), enrichedM = Number(li.enriched_m ?? 0);
  const llmTotal = Number(llm.total ?? 0), llmMonth = Number(llm.mtd ?? 0);

  const smsCost = outb * SMS_OUT + inb * SMS_IN;
  const smsCostM = outbM * SMS_OUT + inbM * SMS_IN;
  const liCost = enriched * PROFILE_COST;
  const liCostM = enrichedM * PROFILE_COST;

  const monthVariable = smsCostM + llmMonth + liCostM;
  const monthTotal = monthVariable + HETZNER_MO + RAPIDAPI_MO;
  const allVariable = smsCost + llmTotal + liCost;

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

      {/* This-month headline */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="This month — total" value={usd(monthTotal)} accent="zinc" hint="usage + fixed costs" />
        <KpiCard label="Telnyx SMS" value={usd(smsCostM)} accent="sky" chip={`${outbM} sent`} hint={`${inbM} received`} />
        <KpiCard label="LLM (Anthropic)" value={usd(llmMonth)} accent="violet" chip={`${Number(llm.calls ?? 0)} calls`} hint="classify · draft · score" />
        <KpiCard label="LinkedIn profiles" value={usd(liCostM)} accent="emerald" chip={`${enrichedM} pulled`} />
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat label="Hetzner (mo)" value={usd(HETZNER_MO)} />
        <MiniStat label="RapidAPI plan (mo)" value={usd(RAPIDAPI_MO)} />
        <MiniStat label="Usage this mo" value={usd(monthVariable)} accent="amber" />
        <MiniStat label="All-time usage" value={usd(allVariable)} />
        <MiniStat label="LLM tokens" value={Number(llm.tokens ?? 0).toLocaleString()} />
      </div>

      {/* Breakdown */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Telnyx — SMS" total={usd(smsCost)} sub="all-time">
          <Line label={`Outbound (${outb})`} detail={`@ ${usd(SMS_OUT)}/msg`} value={usd(outb * SMS_OUT)} />
          <Line label={`Inbound (${inb})`} detail={`@ ${usd(SMS_IN)}/msg`} value={usd(inb * SMS_IN)} />
        </Panel>

        <Panel title="LLM — Anthropic" total={usd(llmTotal)} sub="all-time">
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

        <Panel title="LinkedIn — RapidAPI" total={usd(liCost)} sub="all-time, usage">
          <Line label={`Profiles enriched (${enriched})`} detail={`@ ${usd(PROFILE_COST)}/profile`} value={usd(liCost)} />
          <Line label="Monthly plan" detail="15,000 requests included" value={usd(RAPIDAPI_MO) + "/mo"} />
        </Panel>
      </div>

      <p className="text-xs text-zinc-400">
        LLM cost is metered from actual token usage per call. SMS and LinkedIn are estimated from volume × per-unit rates
        ({usd(SMS_OUT)}/{usd(SMS_IN)} per outbound/inbound SMS, {usd(PROFILE_COST)}/profile) — adjust via the
        SMS_OUT_COST / SMS_IN_COST / RAPIDAPI_PROFILE_COST env vars. Fixed monthly: Hetzner {usd(HETZNER_MO)}, RapidAPI
        plan {usd(RAPIDAPI_MO)}. Neon + QStash are on free tiers.
      </p>
    </section>
  );
}

function Panel({ title, total, sub, children }: { title: string; total: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
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
