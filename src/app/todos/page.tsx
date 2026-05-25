import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { todos, contacts, campaigns, type TodoChannel } from "@/db/schema";
import { completeTodo, reopenTodo, deleteTodo } from "@/lib/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LiveBadge } from "@/components/LiveBadge";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const CHANNELS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "call", label: "Call" },
];

export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const channel = sp.channel && sp.channel !== "all" ? sp.channel : null;
  const view = sp.view === "done" ? "done" : "open";

  const where = [eq(todos.status, view)];
  if (channel) where.push(eq(todos.channel, channel as TodoChannel));

  const rows = await db
    .select({
      id: todos.id,
      action: todos.action,
      channel: todos.channel,
      detail: todos.detail,
      createdAt: todos.createdAt,
      campaignId: todos.campaignId,
      conversationId: todos.conversationId,
      contactId: todos.contactId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      phone: contacts.phone,
      company: contacts.company,
      jobTitle: contacts.jobTitle,
      linkedinUrl: contacts.linkedinUrl,
      campaignName: campaigns.name,
    })
    .from(todos)
    .innerJoin(contacts, eq(contacts.id, todos.contactId))
    .innerJoin(campaigns, eq(campaigns.id, todos.campaignId))
    .where(and(...where))
    .orderBy(desc(todos.createdAt))
    .limit(500);

  // Group by candidate so every person's open actions sit together.
  const groups = new Map<
    string,
    { name: string; sub: string; campaignId: string; conversationId: string | null; linkedin: string; linkedinDirect: boolean; items: typeof rows }
  >();
  for (const r of rows) {
    const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || formatPhone(r.phone);
    const sub = [r.jobTitle, r.company].filter(Boolean).join(" · ") || r.campaignName;
    const li = linkedinLink(r.linkedinUrl, name, r.company, r.jobTitle);
    const g =
      groups.get(r.contactId) ??
      { name, sub, campaignId: r.campaignId, conversationId: r.conversationId, linkedin: li.url, linkedinDirect: li.direct, items: [] as typeof rows };
    g.items.push(r);
    groups.set(r.contactId, g);
  }
  const grouped = [...groups.values()];

  return (
    <section className="grid gap-6">
      <AutoRefresh intervalMs={10000} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">To-dos</h1>
            <LiveBadge />
          </div>
          <p className="mt-1 text-sm text-zinc-600">
            {view === "open"
              ? `${rows.length} open action${rows.length === 1 ? "" : "s"} across ${grouped.length} candidate${grouped.length === 1 ? "" : "s"}`
              : `${rows.length} completed`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/todos${channel ? `?channel=${channel}` : ""}`}
            className={"rounded-lg px-3 py-1.5 text-sm font-medium " + (view === "open" ? "bg-zinc-900 text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50")}
          >
            Open
          </Link>
          <Link
            href={`/todos?view=done${channel ? `&channel=${channel}` : ""}`}
            className={"rounded-lg px-3 py-1.5 text-sm font-medium " + (view === "done" ? "bg-zinc-900 text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50")}
          >
            Done
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CHANNELS.map((c) => {
          const active = (channel ?? "all") === c.value;
          const qs = new URLSearchParams();
          if (c.value !== "all") qs.set("channel", c.value);
          if (view === "done") qs.set("view", "done");
          const href = `/todos${qs.toString() ? `?${qs.toString()}` : ""}`;
          return (
            <Link
              key={c.value}
              href={href}
              className={"rounded-full px-3 py-1 text-xs font-medium " + (active ? "bg-sky-600 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200")}
            >
              {c.label}
            </Link>
          );
        })}
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-semibold">{view === "open" ? "You're all caught up" : "Nothing here yet"}</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {view === "open"
              ? "Follow-ups from candidate replies will show up here automatically."
              : "Completed items will appear here."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4">
          {grouped.map((g, i) => (
            <li key={i} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-zinc-900">{g.name}</h3>
                  <p className="truncate text-xs text-zinc-500">{g.sub}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={g.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={g.linkedinDirect ? "Open their LinkedIn profile" : "Search LinkedIn (name + company + title)"}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                      <path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 1 1 8.3 6.5a1.78 1.78 0 0 1-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0 0 13 14.19a.66.66 0 0 0 0 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 0 1 2.7-1.4c1.55 0 3.36.86 3.36 3.66z" />
                    </svg>
                    {g.linkedinDirect ? "LinkedIn" : "Find on LinkedIn"}
                  </a>
                  {g.conversationId ? (
                    <Link
                      href={`/campaigns/${g.campaignId}/inbox/${g.conversationId}`}
                      className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      Open thread →
                    </Link>
                  ) : null}
                </div>
              </div>

              <ul className="mt-3 divide-y divide-zinc-100">
                {g.items.map((t) => {
                  const complete = completeTodo.bind(null, t.id);
                  const reopen = reopenTodo.bind(null, t.id);
                  const del = deleteTodo.bind(null, t.id);
                  return (
                    <li key={t.id} className="flex items-start gap-3 py-2.5">
                      <form action={view === "open" ? complete : reopen} className="pt-0.5">
                        <button
                          title={view === "open" ? "Mark done" : "Reopen"}
                          className={
                            "flex h-5 w-5 items-center justify-center rounded-full border transition " +
                            (view === "open"
                              ? "border-zinc-300 hover:border-emerald-500 hover:bg-emerald-50"
                              : "border-emerald-500 bg-emerald-500 text-white")
                          }
                        >
                          {view === "done" ? (
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                          ) : null}
                        </button>
                      </form>
                      <div className="min-w-0 flex-1">
                        <div className={"text-sm " + (view === "done" ? "text-zinc-400 line-through" : "text-zinc-900")}>
                          {t.action}
                        </div>
                        {t.detail ? <div className="mt-0.5 text-xs text-zinc-500">{t.detail}</div> : null}
                      </div>
                      <ChannelChip channel={t.channel} />
                      <form action={del} className="pt-0.5">
                        <button title="Delete" className="rounded-md p-1 text-zinc-400 hover:bg-rose-50 hover:text-rose-600">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Direct profile link if we have one, else a LinkedIn people-search prefilled with name + company + title. */
function linkedinLink(
  url: string | null,
  name: string,
  company: string | null,
  title: string | null,
): { url: string; direct: boolean } {
  if (url && url.trim()) {
    const u = url.trim();
    return { url: u.startsWith("http") ? u : `https://${u}`, direct: true };
  }
  const q = encodeURIComponent([name, company, title].filter(Boolean).join(" "));
  return { url: `https://www.linkedin.com/search/results/people/?keywords=${q}`, direct: false };
}

function ChannelChip({ channel }: { channel: TodoChannel }) {
  const map: Record<TodoChannel, { label: string; cls: string }> = {
    sms: { label: "SMS", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
    email: { label: "Email", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
    linkedin: { label: "LinkedIn", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
    call: { label: "Call", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    other: { label: "Other", cls: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
  };
  const c = map[channel];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${c.cls}`}>
      {c.label}
    </span>
  );
}
