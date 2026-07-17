import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNull, ne, sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts, suppressedNumbers } from "@/db/schema";
import {
  uploadContactsCsv,
  deleteContact,
  ackContactFailure,
  deleteAllContacts,
  clearSuppressionList,
  validateExistingContacts,
  scoreCampaignContacts,
  setMinScore,
} from "@/lib/actions";
import { formatPhone } from "@/lib/phone";
import { CallButton } from "@/components/CallButton";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ScoreBadge } from "@/components/ScoreBadge";
import { LocationBadge } from "@/components/LocationBadge";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ added?: string; prev?: string; dup?: string; region?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) notFound();

  const minScore = campaign.minScoreToSend ?? 0;

  // Show the WHOLE list (the fit bar only decides who gets texted, not who's shown).
  // Hide soft-deleted/archived — they live in the campaign's Archived view.
  const rows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.campaignId, id), isNull(contacts.deletedAt)))
    // Highest fit first; unscored fall to the bottom.
    .orderBy(sql`${contacts.qualificationScore} desc nulls last`, desc(contacts.createdAt))
    .limit(2000);

  // Which of these contacts' numbers were texted in OTHER campaigns (for the "Texted before" badge).
  const phones = rows.map((r) => r.phone);
  const prevTexted = new Set<string>();
  if (phones.length > 0) {
    const supRows = await db
      .select({ phone: suppressedNumbers.phone })
      .from(suppressedNumbers)
      .where(and(inArray(suppressedNumbers.phone, phones), ne(suppressedNumbers.campaignId, id)));
    for (const r of supRows) prevTexted.add(r.phone);
  }

  const uploadAdded = sp.added ? Number(sp.added) : null;
  const uploadPrev = sp.prev ? Number(sp.prev) : 0;
  const uploadDup = sp.dup ? Number(sp.dup) : 0;
  const uploadRegion = sp.region ? Number(sp.region) : 0;

  const [suppression] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(suppressedNumbers)
    .where(eq(suppressedNumbers.campaignId, id));
  const suppressedCount = suppression?.n ?? 0;

  const [statusAgg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      validating: sql<number>`count(*) filter (where ${contacts.status} = 'validating')::int`,
      sendable: sql<number>`count(*) filter (where ${contacts.status} in ('pending','failed'))::int`,
      scored: sql<number>`count(*) filter (where ${contacts.qualificationScore} is not null)::int`,
      // pending contacts that meet the current fit bar (who'd actually be texted)
      qualify: sql<number>`count(*) filter (where ${contacts.status} = 'pending' and ${contacts.optedOut} = false and (${minScore} = 0 or ${contacts.qualificationScore} >= ${minScore}))::int`,
    })
    .from(contacts)
    .where(eq(contacts.campaignId, id));
  const totalCount = statusAgg?.total ?? 0;
  const validatingCount = statusAgg?.validating ?? 0;
  const sendableCount = statusAgg?.sendable ?? 0;
  const scoredCount = statusAgg?.scored ?? 0;
  const qualifyCount = statusAgg?.qualify ?? 0;
  const unscoredCount = totalCount - scoredCount;

  const upload = uploadContactsCsv.bind(null, id);
  const clearAll = deleteAllContacts.bind(null, id);
  const clearSuppression = clearSuppressionList.bind(null, id);
  const validateNow = validateExistingContacts.bind(null, id);
  const scoreFit = scoreCampaignContacts.bind(null, id);
  const setBar = setMinScore.bind(null, id);
  const SCORE_TIERS = [0, 25, 50, 60, 65, 75, 90, 100];

  return (
    <section className="grid gap-6">
      {validatingCount > 0 || unscoredCount > 0 ? <AutoRefresh intervalMs={5000} /> : null}

      {uploadAdded !== null ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span className="font-semibold">Upload complete.</span> Added{" "}
          <strong>{uploadAdded}</strong> new contact{uploadAdded === 1 ? "" : "s"}, ready to send.
          {uploadDup > 0 ? (
            <> {uploadDup} duplicate{uploadDup === 1 ? "" : "s"} removed (already in this campaign).</>
          ) : null}
          {uploadPrev > 0 ? (
            <> {uploadPrev} skipped: already texted in another campaign.</>
          ) : null}
          {uploadRegion > 0 ? (
            <> {uploadRegion} skipped: outside the selected region(s).</>
          ) : null}
          {uploadPrev > 0 ? (
            <span className="mt-1 block text-xs text-emerald-700">
              To message the previously-texted people anyway, re-upload with &quot;Skip people I&apos;ve already
              texted&quot; unchecked.
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/campaigns/${id}`} className="text-xs text-zinc-500 hover:text-zinc-700">
            ← {campaign.name}
          </Link>
          <h1 className="mt-1 text-xl font-semibold">Contacts</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Upload a CSV. Standard columns are recognized (first/last name, company, phone, email, linkedin, location,
            job title); other columns become custom merge fields like <code>{`{your_column}`}</code>. Numbers already
            messaged in this campaign are skipped automatically.
          </p>
        </div>
        {totalCount > 0 ? (
          <ConfirmButton action={clearAll} confirmLabel={`Delete all ${totalCount}`}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
            Delete all contacts
          </ConfirmButton>
        ) : null}
      </div>

      {suppressedCount > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-600">
          <span>
            <strong className="text-zinc-900">{suppressedCount}</strong> number
            {suppressedCount === 1 ? "" : "s"} already messaged in this campaign will be skipped on future uploads.
          </span>
          <ConfirmButton
            action={clearSuppression}
            confirmLabel="Clear the skip list"
            className="rounded-md border border-zinc-300 bg-surface px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
          >
            Clear skip list
          </ConfirmButton>
        </div>
      ) : null}

      {validatingCount > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
          <svg className="h-4 w-4 animate-spin text-sky-500" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Validating {validatingCount} number{validatingCount === 1 ? "" : "s"} through Telnyx: landlines are being
          removed. This updates automatically.
        </div>
      ) : sendableCount > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-surface px-4 py-2.5 text-sm text-zinc-600">
          <span>Validate existing numbers and drop any landlines before sending.</span>
          <form action={validateNow}>
            <button className="rounded-md border border-zinc-300 bg-surface px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
              Validate numbers now
            </button>
          </form>
        </div>
      ) : null}

      {totalCount > 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Candidate fit scoring</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                AI scores each contact 1–100 against this role&apos;s description. Set a minimum to text only qualified
                candidates.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {unscoredCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                  <svg className="h-3.5 w-3.5 animate-spin text-sky-500" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Scored {scoredCount}/{totalCount}
                </span>
              ) : (
                <span className="text-xs text-emerald-600">All {scoredCount} scored</span>
              )}
              <form action={scoreFit}>
                <button className="rounded-md border border-zinc-300 bg-surface px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                  {unscoredCount > 0 ? "Score now" : "Re-score new"}
                </button>
              </form>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-600">Only text fit ≥</span>
            {SCORE_TIERS.map((tier) => (
              <form key={tier} action={setBar}>
                <input type="hidden" name="minScore" value={tier} />
                <button
                  className={
                    "rounded-full px-2.5 py-1 text-xs font-medium " +
                    (minScore === tier
                      ? "bg-sky-600 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200")
                  }
                >
                  {tier === 0 ? "Off" : `${tier}`}
                </button>
              </form>
            ))}
          </div>

          {minScore > 0 ? (
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              Sends go to the <strong>{qualifyCount}</strong> pending contact{qualifyCount === 1 ? "" : "s"} scoring{" "}
              <strong>≥ {minScore}</strong>. Anyone below the bar is skipped (not deleted).
              {unscoredCount > 0 ? " Scoring is still running: wait for it to finish before sending." : ""}
            </div>
          ) : null}
        </div>
      ) : null}

      <form action={upload} className="rounded-lg border border-dashed border-zinc-300 bg-surface p-5">
        <label className="block">
          <span className="block text-sm font-medium">CSV file</span>
          <input
            type="file"
            name="csv"
            accept=".csv,text/csv"
            required
            className="mt-2 block text-sm"
          />
        </label>
        <label className="mt-3 flex items-start gap-2 text-sm text-zinc-700">
          <input type="checkbox" name="validateMobile" defaultChecked className="mt-0.5 rounded border-zinc-300" />
          <span>Validate numbers and keep only mobile (removes landlines &amp; toll-free via Telnyx)</span>
        </label>
        <label className="mt-2 flex items-start gap-2 text-sm text-zinc-700">
          <input type="checkbox" name="skipPreviouslyTexted" defaultChecked className="mt-0.5 rounded border-zinc-300" />
          <span>Skip people I&apos;ve already texted in another campaign (uncheck to message them again)</span>
        </label>
        <p className="mt-2 text-xs text-zinc-500">
          The entire list uploads and auto-scores. You then pick who to text by fit score.
        </p>
        <button className="mt-4 rounded-md bg-ink px-3 py-1.5 text-sm text-white hover:bg-ink-soft">
          Upload contacts
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-surface p-6 text-center text-sm text-zinc-500">
          No contacts yet. Upload a CSV to get started.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-surface">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Fit</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Error</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((c) => {
                const del = deleteContact.bind(null, id, c.id);
                const retry = ackContactFailure.bind(null, id, c.id);
                return (
                  <tr key={c.id}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span>
                          {[c.firstName, c.lastName].filter(Boolean).join(" ") || (
                            <span className="text-zinc-400">-</span>
                          )}
                        </span>
                        {prevTexted.has(c.phone) ? (
                          <span
                            title="You've texted this number in another campaign"
                            className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700"
                          >
                            Texted before
                          </span>
                        ) : null}
                        <LocationBadge match={c.locationMatch} region={c.locationRegion} />
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <span className="inline-flex items-center gap-1">
                        {formatPhone(c.phone)}
                        <CallButton
                          phone={c.phone}
                          name={[c.firstName, c.lastName].filter(Boolean).join(" ")}
                          company={c.company}
                        />
                      </span>
                    </td>
                    <td className="px-3 py-2">{c.company ?? <span className="text-zinc-400">-</span>}</td>
                    <td className="px-3 py-2">{c.jobTitle ?? <span className="text-zinc-400">-</span>}</td>
                    <td className="px-3 py-2">
                      {c.qualificationScore != null ? (
                        <ScoreBadge score={c.qualificationScore} reason={c.qualificationReason} label="" />
                      ) : (
                        <span className="text-zinc-300">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={c.status} optedOut={c.optedOut} />
                    </td>
                    <td className="px-3 py-2 text-xs text-rose-600">{c.lastError ?? ""}</td>
                    <td className="px-3 py-2 text-right">
                      {c.status === "failed" ? (
                        <form action={retry} className="inline">
                          <button className="text-xs text-emerald-700 hover:underline">retry</button>
                        </form>
                      ) : null}
                      <form action={del} className="ml-3 inline">
                        <button className="text-xs text-rose-600 hover:underline">delete</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status, optedOut }: { status: string; optedOut: boolean }) {
  if (optedOut) return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">opted-out</span>;
  const map: Record<string, string> = {
    pending: "bg-zinc-100 text-zinc-700",
    validating: "bg-sky-100 text-sky-700",
    queued: "bg-amber-100 text-amber-700",
    sent: "bg-sky-100 text-sky-700",
    delivered: "bg-sky-100 text-sky-700",
    replied: "bg-emerald-100 text-emerald-700",
    failed: "bg-rose-100 text-rose-700",
    opted_out: "bg-rose-100 text-rose-700",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${map[status] ?? "bg-zinc-100 text-zinc-700"}`}>{status}</span>;
}
