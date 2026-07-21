import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, campaignTemplates, contacts, conversations, type CampaignTemplate } from "@/db/schema";
import {
  applyCampaignTemplate,
  deleteCampaign,
  deleteCampaignTemplate,
  saveCampaignTemplate,
  startCampaignSend,
  setCampaignStatus,
  updateCampaign,
} from "@/lib/actions";
import { CampaignForm } from "@/components/CampaignForm";
import { DeleteCampaignButton } from "@/components/DeleteCampaignButton";
import { isWithinSendWindow } from "@/lib/send-window";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LiveBadge } from "@/components/LiveBadge";
import { KpiCard, Funnel, SentimentMeter, MiniStat, pct } from "@/components/Stats";
import { sentimentOf } from "@/lib/sentiment";
import { campaignFunnels, EMPTY_FUNNEL } from "@/lib/campaign-stats";

export const dynamic = "force-dynamic";

export default async function CampaignDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) notFound();

  const bar = campaign.minScoreToSend ?? 0;
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${contacts.status} = 'pending')::int`,
      // Pending contacts that actually meet the fit bar — i.e. who "Send" will text.
      qualifying: sql<number>`count(*) filter (where ${contacts.status} = 'pending' and ${contacts.optedOut} = false and (${bar} = 0 or ${contacts.qualificationScore} >= ${bar}))::int`,
      validating: sql<number>`count(*) filter (where ${contacts.status} = 'validating')::int`,
      optedOut: sql<number>`count(*) filter (where ${contacts.status} = 'opted_out')::int`,
      failed: sql<number>`count(*) filter (where ${contacts.status} = 'failed')::int`,
      emailsSent: sql<number>`count(*) filter (where ${contacts.positionEmailSentAt} is not null)::int`,
      unscored: sql<number>`count(*) filter (where ${contacts.status} = 'pending' and ${contacts.optedOut} = false and ${contacts.qualificationScore} is null)::int`,
    })
    .from(contacts)
    .where(eq(contacts.campaignId, id));

  // Sent/delivered/replied come from the messages table (see campaign-stats):
  // contact.status churn and unearned inbounds made the contact-status
  // versions of these numbers lie.
  const funnel = (await campaignFunnels(id)).get(id) ?? EMPTY_FUNNEL;
  const convoStats = { needsAttention: funnel.needsAttention, replied: funnel.replied };

  // Reply-sentiment breakdown from the AI classifications on replied threads.
  const classRows = await db
    .select({
      classification: conversations.classification,
      n: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .where(and(eq(conversations.campaignId, id), sql`${conversations.classification} is not null`))
    .groupBy(conversations.classification);

  let positive = 0;
  let neutral = 0;
  let negative = 0;
  for (const r of classRows) {
    const bucket = sentimentOf(r.classification);
    if (bucket === "positive") positive += r.n;
    else if (bucket === "negative") negative += r.n;
    else neutral += r.n;
  }

  const send = startCampaignSend.bind(null, id);
  const update = updateCampaign.bind(null, id);
  const pause = setCampaignStatus.bind(null, id, "paused");
  const resume = setCampaignStatus.bind(null, id, "active");
  const del = deleteCampaign.bind(null, id);
  const applyTpl = applyCampaignTemplate.bind(null, id);
  const saveTpl = saveCampaignTemplate.bind(null, id);
  const deleteTpl = deleteCampaignTemplate.bind(null, id);

  // Saved campaign setups for the quick-setup dropdown. Tolerant of a missing
  // table (mid-rollout): the page must never 500 over an optional convenience.
  let templates: CampaignTemplate[] = [];
  try {
    templates = await db.select().from(campaignTemplates).orderBy(asc(campaignTemplates.name));
  } catch {
    templates = [];
  }

  const pending = stats?.pending ?? 0;
  const qualifying = stats?.qualifying ?? 0;
  const unscored = stats?.unscored ?? 0;
  const total = stats?.total ?? 0;
  const sent = funnel.messaged;
  const delivered = funnel.delivered;
  const replied = funnel.replied;
  const classified = positive + neutral + negative;
  const deliveryRate = pct(delivered, sent);
  const replyRate = pct(replied, delivered);
  const positiveRate = pct(positive, classified);
  const sendWindow = isWithinSendWindow(campaign.sendWindowStart, campaign.sendWindowEnd);
  const appTz = process.env.APP_TIMEZONE ?? "America/New_York";
  const scheduledFuture =
    campaign.scheduledAt && campaign.scheduledAt.getTime() > Date.now() ? campaign.scheduledAt : null;

  // Fail-safe visibility: without a human-set send date & time nothing sends.
  // On an ACTIVE campaign the fired schedule is standing approval, so late
  // arrivals (enrichment top-ups, Boost phones) flow through automatically and
  // are just normal pending sends; only a paused/draft campaign holds them.
  const unscheduled = !campaign.scheduledAt;
  let heldNew = 0;
  if (campaign.scheduledAt && !scheduledFuture && campaign.status !== "active") {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(contacts)
      .where(
        and(
          eq(contacts.campaignId, id),
          sql`${contacts.status} = 'pending'`,
          eq(contacts.optedOut, false),
          sql`${contacts.deletedAt} is null`,
          sql`${contacts.createdAt} > ${campaign.scheduledAt}`,
        ),
      );
    heldNew = row?.n ?? 0;
  }

  return (
    <section className="grid gap-6">
      <AutoRefresh intervalMs={8000} />
      <div>
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-700">
          ← All campaigns
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
            <StatusBadge status={campaign.status} />
            <span
              title="How the AI handles replies (campaign status is the badge to the left)"
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
            >
              AI replies: {campaign.llmMode.replace(/_/g, " ")}
            </span>
            {campaign.salesNavUrl ? (
              <a
                href={campaign.salesNavUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="The Sales Navigator search used to build this list"
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 1 1 8.3 6.5a1.78 1.78 0 0 1-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0 0 13 14.19a.66.66 0 0 0 0 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 0 1 2.7-1.4c1.55 0 3.36.86 3.36 3.66z" />
                </svg>
                Sales Nav search
              </a>
            ) : null}
          </div>
          <LiveBadge />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/campaigns/${id}/contacts`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-surface px-3 py-1.5 text-sm font-medium hover:bg-zinc-50"
        >
          <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
          </svg>
          Contacts ({stats?.total ?? 0})
        </Link>
        <Link
          href={`/campaigns/${id}/inbox`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-surface px-3 py-1.5 text-sm font-medium hover:bg-zinc-50"
        >
          <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
          </svg>
          Inbox
          {convoStats.needsAttention > 0 ? (
            <span className="ml-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
              {convoStats.needsAttention}
            </span>
          ) : null}
        </Link>
        <Link
          href={`/campaigns/${id}/archived`}
          title="Restorable threads from candidates who replied (search by name or phone)"
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-surface px-3 py-1.5 text-sm font-medium hover:bg-zinc-50"
        >
          <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
          </svg>
          Archived
        </Link>

        {campaign.status === "active" ? (
          <form action={pause}>
            <button className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100">
              Pause
            </button>
          </form>
        ) : (
          <form action={resume}>
            <button
              title={
                campaign.status === "draft"
                  ? "Prepares this campaign: numbers get cell-checked and fit-scored. Nothing is texted until you set a send date & time below (or click Send)."
                  : "Reactivates the campaign. Texting still requires a send date & time set below."
              }
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
            >
              {campaign.status === "draft" ? "Activate" : "Resume"}
            </button>
          </form>
        )}

        <form action={send}>
          <button
            disabled={qualifying === 0 || unscored > 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0369a1] disabled:cursor-not-allowed disabled:bg-zinc-300"
            title={
              unscored > 0
                ? `Scoring ${unscored} contacts: sending is paused until fit scores are ready`
                : qualifying === 0
                  ? bar > 0
                    ? `No unsent contacts score ≥ ${bar}. Lower the fit bar on the Contacts page to reach more people.`
                    : "Everyone in this campaign has already been messaged"
                  : bar > 0
                    ? `Texts the ${qualifying} unsent contacts scoring ≥ ${bar}. ${pending - qualifying} other unsent contact${pending - qualifying === 1 ? "" : "s"} fall below the bar and are skipped.`
                    : `Texts the ${qualifying} contacts not yet messaged. Anyone already texted in this campaign is never contacted again.`
            }
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
            </svg>
            {qualifying > 0
              ? `Send to ${qualifying}${bar > 0 ? ` qualified (≥${bar})` : " unsent"}`
              : "Send to unsent"}
          </button>
        </form>

        <div className="ml-auto">
          <DeleteCampaignButton deleteAction={del} />
        </div>
      </div>

      {unscheduled && qualifying + unscored + (stats?.validating ?? 0) > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <span>
            <strong>No send date &amp; time set: nothing will be texted.</strong>{" "}
            This campaign never sends on its own.
            Set a send date &amp; time in the settings below and save to schedule it, or click Send to text the ready
            contacts now. Cell-checking and fit scoring run in the meantime so the list is ready when you are.
          </span>
        </div>
      ) : null}

      {heldNew > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          <span>
            <strong>
              {heldNew} contact{heldNew === 1 ? " was" : "s were"} added after the last scheduled send and {heldNew === 1 ? "is" : "are"} waiting.
            </strong>{" "}
            This campaign is not active, so nothing is texting. Press{" "}
            {campaign.status === "draft" ? "Activate" : "Resume"}{" "}
            and they send automatically with this campaign&apos;s current template and settings.
          </span>
        </div>
      ) : null}

      {scheduledFuture ? (
        <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
          <svg className="h-4 w-4 shrink-0 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <span>
            <strong>
              Scheduled to start{" "}
              {scheduledFuture.toLocaleString("en-US", {
                timeZone: appTz,
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              ({appTz}).
            </strong>{" "}
            Sending begins automatically then (within the send window), once fit scoring is complete. Clear the schedule
            field below and save to cancel, or use the Send button to start now.
          </span>
        </div>
      ) : null}

      {unscored > 0 && campaign.scoringError === "no_key" ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <span>
            <strong>Scoring paused: the AI key is not set up on this OS Text engine.</strong> {unscored} candidate
            {unscored === 1 ? "" : "s"} can&apos;t be fit-scored, and reply sorting (positive / negative) is off too.
            Ask your administrator to add the Anthropic API key to the engine; scoring resumes automatically once it&apos;s
            in place.
          </span>
        </div>
      ) : unscored > 0 && campaign.scoringError === "credit" ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <span>
            <strong>Scoring paused: Anthropic credit needs topping up.</strong> {unscored} candidate
            {unscored === 1 ? "" : "s"} can&apos;t be scored because the Anthropic API balance is too low. Add credit at{" "}
            <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" className="font-semibold underline">
              console.anthropic.com → Billing
            </a>
            , then click <strong>Score now</strong> on the Contacts page. Sending stays paused until everyone is scored.
          </span>
        </div>
      ) : unscored > 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
          <svg className="h-4 w-4 shrink-0 animate-spin text-violet-500" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span>
            <strong>Scoring {unscored} candidate{unscored === 1 ? "" : "s"} for fit…</strong> Sending is paused until
            everyone has a fit score, so you never text a prospect before they&apos;ve been evaluated. Updates
            automatically, then set your fit bar on the Contacts page and send only to qualified candidates.
          </span>
        </div>
      ) : null}

      {qualifying > 0 && unscored === 0 && sent > 0 ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <strong>You&apos;re adding to a campaign that already ran.</strong> Send texts only the {qualifying} unsent
          contact{qualifying === 1 ? "" : "s"}
          {bar > 0 ? ` scoring ≥ ${bar}` : ""}: the {sent}{" "}you&apos;ve already messaged are skipped, so nobody
          is texted twice.
        </div>
      ) : null}

      {!sendWindow.ok && qualifying > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Outside the send window.</strong> Sends are paused until{" "}
          {sendWindow.openAt.toLocaleString(undefined, {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          ({campaign.sendWindowStart}–{campaign.sendWindowEnd}, {process.env.APP_TIMEZONE ?? "America/New_York"}).
          &quot;Send batch&quot; won&apos;t send right now. Widen the window below (use{" "}
          <code>00:00</code>–<code>24:00</code> for all day) and save to send immediately.
        </div>
      ) : null}

      <section className="rounded-xl border border-zinc-200 bg-surface p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="text-sm font-semibold text-zinc-900">Quick setup</span>
          {templates.length > 0 ? (
            <form action={applyTpl} className="flex flex-wrap items-center gap-2">
              <select
                name="templateId"
                required
                className="rounded-md border border-zinc-300 bg-surface px-3 py-1.5 text-sm shadow-sm focus:border-zinc-500 focus:outline-none"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-soft">
                Apply template
              </button>
              <button
                formAction={deleteTpl}
                title="Deletes the selected template (saved campaigns are not affected)"
                className="rounded-md px-2 py-1.5 text-xs text-zinc-400 hover:text-rose-600"
              >
                Delete
              </button>
            </form>
          ) : (
            <span className="text-xs text-zinc-500">
              No saved templates yet. Save this campaign&apos;s setup on the right and it appears here on every
              campaign.
            </span>
          )}
          <form action={saveTpl} className="ml-auto flex flex-wrap items-center gap-2">
            <input
              name="templateName"
              required
              defaultValue={campaign.name}
              placeholder="Template name"
              className="w-56 rounded-md border border-zinc-300 px-3 py-1.5 text-sm shadow-sm focus:border-zinc-500 focus:outline-none"
            />
            <button className="rounded-md border border-zinc-300 bg-surface px-3 py-1.5 text-sm font-medium hover:bg-zinc-50">
              Save as template
            </button>
          </form>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Applying a template fills the message, job description, AI reply mode, send window, fit bar, and recruiter
          details from a setup you saved. It never touches the send date &amp; time: nothing sends until you set that.
          Saving with an existing template&apos;s name updates that template.
        </p>
      </section>

      {pending === 0 && (stats?.total ?? 0) === 0 ? (
        <div className="rounded-xl border border-dashed border-sky-300 bg-sky-50 p-4 text-sm text-sky-900">
          This campaign has no contacts yet.{" "}
          <Link href={`/campaigns/${id}/contacts`} className="font-semibold underline">
            Upload a CSV
          </Link>{" "}
          to start sending.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Contacts" value={total} accent="zinc" hint="in this campaign" icon={<IconUsers />} />
        <KpiCard
          label="Delivery rate"
          value={`${deliveryRate}%`}
          accent="sky"
          chip={`${delivered} delivered`}
          hint={`of ${sent} sent`}
          icon={<IconCheck />}
        />
        <KpiCard
          label="Reply rate"
          value={`${replyRate}%`}
          accent="violet"
          chip={`${replied} ${replied === 1 ? "reply" : "replies"}`}
          hint="of delivered (SMS engagement)"
          icon={<IconChat />}
        />
        <KpiCard
          label="Positive replies"
          value={positive}
          accent="emerald"
          chip={classified ? `${positiveRate}% of replies` : "-"}
          hint="interested leads"
          icon={<IconSpark />}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Funnel
          stages={[
            { label: "Contacts", value: total, accent: "zinc" },
            { label: "Sent", value: sent, accent: "sky", rateOf: total },
            { label: "Delivered", value: delivered, accent: "violet", rateOf: sent },
            { label: "Replied", value: replied, accent: "emerald", rateOf: delivered },
            { label: "Positive", value: positive, accent: "emerald", rateOf: classified || replied },
          ]}
        />
        <SentimentMeter positive={positive} neutral={neutral} negative={negative} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat label="Pending" value={pending} />
        <MiniStat label="Validating" value={stats?.validating ?? 0} accent={(stats?.validating ?? 0) > 0 ? "sky" : "zinc"} />
        <MiniStat label="Failed" value={stats?.failed ?? 0} accent={(stats?.failed ?? 0) > 0 ? "rose" : "zinc"} />
        <MiniStat label="Opted out" value={stats?.optedOut ?? 0} />
        <MiniStat label="Emails sent" value={stats?.emailsSent ?? 0} accent={(stats?.emailsSent ?? 0) > 0 ? "amber" : "zinc"} />
        <MiniStat label="Needs you" value={convoStats.needsAttention} accent={convoStats.needsAttention > 0 ? "amber" : "zinc"} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-500">Campaign settings</h2>
        <CampaignForm action={update} campaign={campaign} submitLabel="Save changes" />
      </div>
    </section>
  );
}

function IconUsers() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}
function IconChat() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
    </svg>
  );
}
function IconSpark() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
    </svg>
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
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? "bg-zinc-100 text-zinc-600"}`}>
      {status}
    </span>
  );
}
