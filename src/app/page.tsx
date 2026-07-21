import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts, conversations } from "@/db/schema";
import { deleteCampaign } from "@/lib/actions";
import { DeleteCampaignButton } from "@/components/DeleteCampaignButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LiveBadge } from "@/components/LiveBadge";
import { KpiCard, MiniStat, pct } from "@/components/Stats";
import { OwnerChip, type KnownOwner } from "@/components/OwnerChip";
import { sentimentOf } from "@/lib/sentiment";
import { campaignFunnels } from "@/lib/campaign-stats";
import { campaignTenantIs, sessionTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

type Sentiment = { positive: number; neutral: number; negative: number };

export default async function Dashboard() {
  // TENANT WALL: every list, total, and owner chip on this dashboard is scoped
  // to the signed-in user's tenant - a house campaign must never render inside
  // a white-label customer's portal (and vice versa).
  const tenant = await sessionTenant();
  const camps = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      llmMode: campaigns.llmMode,
      createdAt: campaigns.createdAt,
      recruiterName: campaigns.recruiterName,
      recruiterEmail: campaigns.recruiterEmail,
    })
    .from(campaigns)
    .where(campaignTenantIs(tenant))
    .orderBy(desc(campaigns.createdAt));

  // Grouped aggregations (reliable; correlated subqueries were returning 0).
  // Contact rows carry only pipeline state here (totals, opt-outs, emails):
  // sent/delivered/replied come from campaignFunnels, i.e. from the messages
  // table, because contact.status churn (opt-out overwrites 'delivered') and
  // unearned inbounds (STOP, inbound-only threads) skewed the card numbers.
  const contactAgg = await db
    .select({
      campaignId: contacts.campaignId,
      total: sql<number>`count(*)::int`,
      optedOut: sql<number>`count(*) filter (where ${contacts.status} = 'opted_out')::int`,
      emailsSent: sql<number>`count(*) filter (where ${contacts.positionEmailSentAt} is not null)::int`,
    })
    .from(contacts)
    .groupBy(contacts.campaignId);

  const funnelMap = await campaignFunnels();

  const classAgg = await db
    .select({
      campaignId: conversations.campaignId,
      classification: conversations.classification,
      n: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .where(sql`${conversations.classification} is not null`)
    .groupBy(conversations.campaignId, conversations.classification);

  const contactMap = new Map(contactAgg.map((r) => [r.campaignId, r]));

  const sentimentMap = new Map<string, Sentiment>();
  for (const r of classAgg) {
    const s = sentimentMap.get(r.campaignId) ?? { positive: 0, neutral: 0, negative: 0 };
    const bucket = sentimentOf(r.classification);
    s[bucket] += r.n;
    sentimentMap.set(r.campaignId, s);
  }

  const rows = camps.map((c) => {
    const ca = contactMap.get(c.id);
    const f = funnelMap.get(c.id);
    const senti = sentimentMap.get(c.id) ?? { positive: 0, neutral: 0, negative: 0 };
    return {
      ...c,
      contactCount: ca?.total ?? 0,
      sentCount: f?.messaged ?? 0,
      delivered: f?.delivered ?? 0,
      replied: f?.replied ?? 0,
      emailsSent: ca?.emailsSent ?? 0,
      needsAttention: f?.needsAttention ?? 0,
      senti,
    };
  });

  // Portfolio-wide running totals across every campaign.
  const totals = rows.reduce(
    (acc, r) => {
      acc.contacts += r.contactCount;
      acc.sent += r.sentCount;
      acc.delivered += r.delivered;
      acc.replied += r.replied;
      acc.emailsSent += r.emailsSent;
      acc.needsAttention += r.needsAttention;
      acc.positive += r.senti.positive;
      acc.neutral += r.senti.neutral;
      acc.negative += r.senti.negative;
      return acc;
    },
    { contacts: 0, sent: 0, delivered: 0, replied: 0, emailsSent: 0, needsAttention: 0, positive: 0, neutral: 0, negative: 0 },
  );
  const activeCount = rows.filter((r) => r.status === "active").length;
  const classifiedTotal = totals.positive + totals.neutral + totals.negative;

  // Every recruiter already stamped on some campaign, deduped, so the owner
  // popover offers one-click reassignment to a known teammate.
  const knownOwners: KnownOwner[] = [];
  const seenOwners = new Set<string>();
  for (const c of camps) {
    const name = (c.recruiterName ?? "").trim();
    const email = (c.recruiterEmail ?? "").trim();
    const key = (name || email).toLowerCase();
    if (!key || seenOwners.has(key)) continue;
    seenOwners.add(key);
    knownOwners.push({ name, email });
  }

  return (
    <section>
      <AutoRefresh intervalMs={10000} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
            <LiveBadge />
          </div>
          <p className="mt-1 text-sm text-zinc-600">
            {rows.length === 0
              ? "Create your first SMS recruiting campaign."
              : `${rows.length} campaign${rows.length === 1 ? "" : "s"} · ${activeCount} active`}
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-ink-soft"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New campaign
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-surface p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-semibold">No campaigns yet</h2>
          <p className="mt-1 text-sm text-zinc-600">Upload a list, write a template, and start a conversation.</p>
          <Link
            href="/campaigns/new"
            className="mt-6 inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft"
          >
            Create your first campaign
          </Link>
        </div>
      ) : (
        <>
          {/* Portfolio summary — running totals across all campaigns */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Total contacts" value={totals.contacts} accent="zinc" hint={`${totals.sent} messaged`} />
            <KpiCard
              label="Delivery rate"
              value={`${pct(totals.delivered, totals.sent)}%`}
              accent="sky"
              chip={`${totals.delivered} delivered`}
            />
            <KpiCard
              label="Reply rate"
              value={`${pct(totals.replied, totals.delivered)}%`}
              accent="violet"
              chip={`${totals.replied} replies`}
            />
            <KpiCard
              label="Positive replies"
              value={totals.positive}
              accent="emerald"
              chip={classifiedTotal ? `${pct(totals.positive, classifiedTotal)}% of replies` : "-"}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Active campaigns" value={activeCount} accent={activeCount > 0 ? "emerald" : "zinc"} />
            <MiniStat label="Needs you" value={totals.needsAttention} accent={totals.needsAttention > 0 ? "amber" : "zinc"} />
            <MiniStat label="Emails sent" value={totals.emailsSent} accent={totals.emailsSent > 0 ? "amber" : "zinc"} />
            <MiniStat label="Negative" value={totals.negative} accent={totals.negative > 0 ? "rose" : "zinc"} />
          </div>

          <h2 className="mt-8 text-sm font-semibold text-zinc-500">All campaigns</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {rows.map((c) => {
              const del = deleteCampaign.bind(null, c.id);
              const replyRate = pct(c.replied, c.delivered);
              return (
                <li
                  key={c.id}
                  className="group relative flex items-center gap-4 rounded-xl border border-zinc-200 bg-surface px-4 py-3 shadow-sm transition hover:border-zinc-300 hover:shadow-md"
                >
                  {/* Whole-card click target → campaign (inbox/delete sit above it). */}
                  <Link
                    href={`/campaigns/${c.id}`}
                    aria-label={`Open ${c.name}`}
                    className="absolute inset-0 z-0 rounded-xl"
                  />
                  {/* Name + quick links + status */}
                  <div className="pointer-events-none relative z-10 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-zinc-900 group-hover:underline">{c.name}</span>
                      <Link
                        href={`/campaigns/${c.id}/inbox`}
                        title="Open inbox"
                        className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-surface px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z" />
                        </svg>
                        Inbox
                        {c.needsAttention > 0 ? (
                          <span className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white">
                            {c.needsAttention}
                          </span>
                        ) : null}
                      </Link>
                      <StatusBadge status={c.status} />
                      <OwnerChip
                        campaignId={c.id}
                        name={c.recruiterName}
                        email={c.recruiterEmail}
                        knownOwners={knownOwners}
                      />
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-400">
                      {new Date(c.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      {" · AI replies: "}
                      {c.llmMode.replace(/_/g, " ")}
                    </div>
                  </div>

                  {/* Inline metrics (click falls through to the card link) */}
                  <div className="pointer-events-none relative z-10 hidden items-center gap-5 sm:flex">
                    <RowMetric label="Contacts" value={c.contactCount} />
                    <RowMetric label="Sent" value={c.sentCount} />
                    <RowMetric label="Reply" value={`${replyRate}%`} accent="violet" />
                    <RowMetric label="Positive" value={c.senti.positive} accent="emerald" />
                  </div>

                  <div className="pointer-events-none relative z-10 hidden w-24 shrink-0 lg:block">
                    <SentimentStrip senti={c.senti} />
                  </div>

                  <div className="relative z-10">
                    <DeleteCampaignButton deleteAction={del} variant="icon" />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function RowMetric({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "violet" | "emerald";
}) {
  const valueColor =
    accent === "violet" ? "text-violet-700" : accent === "emerald" ? "text-emerald-700" : "text-zinc-900";
  return (
    <div className="text-center">
      <div className={"text-base font-semibold tabular-nums " + valueColor}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</div>
    </div>
  );
}

function SentimentStrip({ senti }: { senti: Sentiment }) {
  const total = senti.positive + senti.neutral + senti.negative;
  if (total === 0) {
    return <div className="h-1.5 w-full rounded-full bg-zinc-100" />;
  }
  const w = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
      <div className="h-full bg-emerald-500" style={{ width: w(senti.positive) }} />
      <div className="h-full bg-zinc-300" style={{ width: w(senti.neutral) }} />
      <div className="h-full bg-rose-500" style={{ width: w(senti.negative) }} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700",
    paused: "bg-amber-100 text-amber-700",
    completed: "bg-zinc-200 text-zinc-600",
    draft: "bg-sky-100 text-sky-700",
  };
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[status] ?? "bg-zinc-100 text-zinc-600"}`}>
      {status}
    </span>
  );
}
