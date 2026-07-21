import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { campaignTemplates, type Campaign, type CampaignTemplate } from "@/db/schema";
import { createCampaign } from "@/lib/actions";
import { CampaignForm } from "@/components/CampaignForm";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template: templateId } = await searchParams;

  // Saved setups drive the "Start from a template" picker; picking one reloads
  // this page with ?template=<id> and the form arrives prefilled. Tolerant of a
  // missing table (mid-rollout): the page must never 500 over a convenience.
  let templates: CampaignTemplate[] = [];
  try {
    templates = await db.select().from(campaignTemplates).orderBy(asc(campaignTemplates.name));
  } catch {
    templates = [];
  }
  const picked = templateId ? templates.find((t) => t.id === templateId) : undefined;

  // Prefill the form from the picked template, only the fields a template
  // carries: name, from number, Sales Nav link, and the send date & time stay
  // blank (the send-date fail-safe is always a fresh human decision).
  const prefill = picked
    ? ({
        llmMode: picked.llmMode,
        smsTemplate: picked.smsTemplate,
        positionSummary: picked.positionSummary,
        recruiterName: picked.recruiterName,
        recruiterEmail: picked.recruiterEmail,
        calendarLink: picked.calendarLink,
        sendWindowStart: picked.sendWindowStart,
        sendWindowEnd: picked.sendWindowEnd,
        targetRegion: picked.targetRegion,
      } as Campaign)
    : undefined;

  return (
    <section className="mx-auto max-w-3xl">
      <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-700">
        ← All campaigns
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New campaign</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Set up the role, write your SMS template, upload your contacts, and you&apos;re ready to send, all in one place.
      </p>

      {templates.length > 0 ? (
        <form
          method="get"
          className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-surface p-4"
        >
          <span className="text-sm font-semibold text-zinc-900">Start from a template</span>
          <select
            name="template"
            defaultValue={picked?.id ?? ""}
            className="rounded-md border border-zinc-300 bg-surface px-3 py-1.5 text-sm shadow-sm focus:border-zinc-500 focus:outline-none"
          >
            <option value="">Blank campaign</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className="rounded-md border border-zinc-300 bg-surface px-3 py-1.5 text-sm font-medium hover:bg-zinc-50">
            Load
          </button>
          {picked ? (
            <span className="text-xs text-emerald-700">
              Loaded &quot;{picked.name}&quot;: review below, then name the campaign and create it.
            </span>
          ) : null}
        </form>
      ) : null}

      <CampaignForm
        key={picked?.id ?? "blank"}
        action={createCampaign}
        className="mt-6"
        campaign={prefill}
        submitLabel="Create campaign"
        showContactUpload
      />
    </section>
  );
}
