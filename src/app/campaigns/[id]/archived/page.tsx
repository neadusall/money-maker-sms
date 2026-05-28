import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns } from "@/db/schema";
import { restoreContact } from "@/lib/actions";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

type Row = {
  ct_id: string;
  convo_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string;
  company: string | null;
  job_title: string | null;
  deleted_at: string;
  last_inbound: string | null;
  last_inbound_at: string | null;
};

export default async function ArchivedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q: qRaw } = await searchParams;
  const q = (qRaw ?? "").trim();

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) notFound();

  const qLike = q ? "%" + q.toLowerCase().replace(/[\\%_]/g, (m) => "\\" + m) + "%" : null;
  const qDigits = q ? q.replace(/\D/g, "") : "";
  const qDigitsLike = qDigits ? "%" + qDigits + "%" : null;

  // Archived = soft-deleted contacts whose conversation has at least one inbound
  // (they responded). Search by name OR by 10-digit phone (digit-only match).
  const result = await db.execute(sql`
    SELECT
      ct.id ct_id, cv.id convo_id,
      ct.first_name, ct.last_name, ct.phone, ct.company, ct.job_title,
      ct.deleted_at,
      (SELECT body FROM messages m WHERE m.conversation_id = cv.id AND m.direction = 'inbound' ORDER BY m.created_at DESC LIMIT 1) last_inbound,
      (SELECT created_at FROM messages m WHERE m.conversation_id = cv.id AND m.direction = 'inbound' ORDER BY m.created_at DESC LIMIT 1) last_inbound_at
    FROM contacts ct
    JOIN conversations cv ON cv.contact_id = ct.id
    WHERE ct.campaign_id = ${id}
      AND ct.deleted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = cv.id AND m.direction = 'inbound')
      ${qLike && qDigitsLike
        ? sql`AND (lower(coalesce(ct.first_name,'') || ' ' || coalesce(ct.last_name,'') || ' ' || coalesce(ct.company,'')) LIKE ${qLike} OR regexp_replace(ct.phone, '\\D', '', 'g') LIKE ${qDigitsLike})`
        : qLike
          ? sql`AND lower(coalesce(ct.first_name,'') || ' ' || coalesce(ct.last_name,'') || ' ' || coalesce(ct.company,'')) LIKE ${qLike}`
          : sql``}
    ORDER BY ct.deleted_at DESC
    LIMIT 500`);

  const rows = result.rows as Row[];

  return (
    <section className="grid gap-4">
      <div>
        <Link href={`/campaigns/${id}`} className="text-xs text-zinc-500 hover:text-zinc-700">
          ← {campaign.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Archived</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Deleted threads whose candidates replied — recoverable. Search by name or phone (10-digit).
        </p>
      </div>

      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search name or 10-digit phone…"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
        <button className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800">
          Search
        </button>
        {q ? (
          <Link
            href={`/campaigns/${id}/archived`}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <div className="text-xs text-zinc-500">
        {rows.length} archived thread{rows.length === 1 ? "" : "s"}{q ? ` matching "${q}"` : ""}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
          {q ? "No matches." : "Nothing archived yet. Deletes from the inbox or To-dos will land here."}
        </div>
      ) : (
        <ul className="grid gap-2">
          {rows.map((r) => {
            const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || formatPhone(r.phone);
            const sub = [r.job_title, r.company].filter(Boolean).join(" · ");
            const restore = restoreContact.bind(null, id, r.ct_id);
            return (
              <li key={r.ct_id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-900">{name}</span>
                      <span className="font-mono text-xs text-zinc-500">{formatPhone(r.phone)}</span>
                    </div>
                    {sub ? <div className="text-xs text-zinc-500">{sub}</div> : null}
                    {r.last_inbound ? (
                      <div className="mt-2 max-w-prose truncate text-sm text-zinc-700">
                        <span className="font-medium text-zinc-500">Last reply:</span> {r.last_inbound}
                      </div>
                    ) : null}
                    <div className="mt-1 text-[11px] text-zinc-400">
                      Archived{" "}
                      {new Date(r.deleted_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href={`/campaigns/${id}/inbox/${r.convo_id}`}
                      className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      View thread →
                    </Link>
                    <form action={restore}>
                      <button className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">
                        Restore
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
