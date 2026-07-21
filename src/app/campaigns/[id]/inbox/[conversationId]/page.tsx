import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, conversations, messages } from "@/db/schema";
import { tenantCampaign } from "@/lib/tenant";
import {
  closeConversation,
  generateDraftForMessage,
  markConversationRead,
  reopenConversation,
  sendManualReply,
} from "@/lib/actions";
import { formatPhone } from "@/lib/phone";
import { OPT_OUT_LINE, hasOptOut } from "@/lib/opt-out";
import { shortRelative, timeOfDay } from "@/lib/time";
import { Avatar } from "@/components/Avatar";
import { CallButton } from "@/components/CallButton";
import { StatusIcon } from "@/components/StatusIcon";
import { ScoreBadge } from "@/components/ScoreBadge";

export const dynamic = "force-dynamic";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string; conversationId: string }>;
}) {
  const { id, conversationId } = await params;

  const [convo] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!convo || convo.campaignId !== id) notFound();
  const campaign = await tenantCampaign(id);
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, convo.contactId));
  if (!campaign || !contact) notFound();

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  // Opening the thread is the recruiter personally seeing it — clear unread +
  // the needs-attention flag here (the AI auto-replying never clears it).
  if (Number(convo.unreadCount) > 0 || convo.status === "needs_attention") {
    await markConversationRead(conversationId);
  }

  const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound");
  // Once the recruiter has taken over, the AI stays out: no prefill, no draft button.
  const draft = convo.humanTakeover ? "" : (lastInbound?.draftReply ?? "");
  const showDraftButton = !convo.humanTakeover && !!lastInbound && !draft;

  const reply = sendManualReply.bind(null, id, conversationId);
  const close = closeConversation.bind(null, id, conversationId);
  const reopen = reopenConversation.bind(null, id, conversationId);
  const generateDraft = lastInbound
    ? generateDraftForMessage.bind(null, id, conversationId, lastInbound.id)
    : null;

  const name =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    formatPhone(contact.phone);

  const grouped = groupMessagesByDay(msgs);

  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-surface px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar firstName={contact.firstName} lastName={contact.lastName} phone={contact.phone} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold">{name}</h1>
              {convo.classification ? (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
                  {convo.classification.replace(/_/g, " ")}
                </span>
              ) : null}
              <ScoreBadge score={contact.qualificationScore} reason={contact.qualificationReason} />
              {contact.optedOut || convo.status === "opted_out" ? (
                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-700">
                  opted out
                </span>
              ) : null}
            </div>
            <div className="truncate text-xs text-zinc-500">
              <span className="font-mono">{formatPhone(contact.phone)}</span>
              {contact.company ? ` · ${contact.company}` : ""}
              {contact.jobTitle ? ` · ${contact.jobTitle}` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <CallButton
            phone={contact.phone}
            name={name}
            company={contact.company}
            variant="header"
          />
          {convo.status === "closed" ? (
            <form action={reopen}>
              <button
                title="Reopen"
                className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-3.51-7.13M21 3v6h-6" />
                </svg>
              </button>
            </form>
          ) : (
            <form action={close}>
              <button
                title="Close"
                className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </form>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-zinc-50 px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="my-3 text-center">
                <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-medium text-zinc-500 shadow-sm">
                  {group.label}
                </span>
              </div>
              <div className="space-y-2">
                {group.messages.map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
              </div>
            </div>
          ))}
          {msgs.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-500">No messages yet.</div>
          ) : null}
        </div>
      </div>

      {contact.optedOut || convo.status === "opted_out" ? (
        <div className="border-t border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-900">
          Contact has opted out. Outbound messages are blocked.
        </div>
      ) : (
        <form action={reply} className="border-t border-zinc-200 bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-3">
            {convo.humanTakeover ? (
              <div className="mb-2 flex items-center gap-1.5 text-xs text-zinc-500">
                <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                You&apos;re handling this conversation: AI replies are off for this thread.
              </div>
            ) : null}
            {showDraftButton && generateDraft ? (
              <div className="mb-2 flex justify-end">
                <button
                  formAction={generateDraft}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-surface px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                  </svg>
                  Generate draft with Claude
                </button>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <textarea
                name="body"
                rows={2}
                defaultValue={draft}
                required
                placeholder="Type your message…"
                className="flex-1 resize-none rounded-lg border border-zinc-300 bg-surface px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-[#0369a1]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                </svg>
                Send
              </button>
            </div>
            {draft ? (
              <p className="mt-2 text-[11px] text-zinc-500">
                Suggested by Claude. Edit before sending.
              </p>
            ) : null}
          </div>
        </form>
      )}
    </>
  );
}

type Msg = {
  id: string;
  direction: "outbound" | "inbound";
  status: "queued" | "sending" | "sent" | "delivered" | "failed" | "received";
  body: string;
  createdAt: Date;
  error: string | null;
};

function MessageBubble({ message }: { message: Msg }) {
  const out = message.direction === "outbound";
  return (
    <div className={out ? "flex justify-end" : "flex justify-start"}>
      <div className={"max-w-[75%] " + (out ? "items-end" : "items-start")}>
        <div
          className={
            "rounded-2xl px-3.5 py-2 text-sm leading-snug " +
            (out
              ? "bg-sky-600 text-white rounded-br-sm"
              : "bg-surface text-zinc-900 border border-zinc-200 rounded-bl-sm shadow-sm")
          }
        >
          <div className="whitespace-pre-wrap break-words">{message.body}</div>
          {out && !hasOptOut(message.body) ? (
            <div className="mt-1 border-t border-white/25 pt-1 text-[11px] italic text-[#e0f2fe]">{OPT_OUT_LINE}</div>
          ) : null}
        </div>
        <div
          className={
            "mt-0.5 flex items-center gap-1 px-1 text-[11px] " +
            (out ? "justify-end text-zinc-500" : "justify-start text-zinc-500")
          }
        >
          <span>{timeOfDay(message.createdAt)}</span>
          {out ? <StatusIcon status={message.status} /> : null}
          {message.error ? (
            <span className="ml-1 text-rose-500" title={message.error}>
              · failed
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function groupMessagesByDay(msgs: Msg[]): { label: string; messages: Msg[] }[] {
  const groups: { label: string; messages: Msg[] }[] = [];
  for (const m of msgs) {
    const label = dayLabel(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.messages.push(m);
    } else {
      groups.push({ label, messages: [m] });
    }
  }
  return groups;
}

function dayLabel(date: Date): string {
  const now = new Date();
  const d = date instanceof Date ? date : new Date(date);
  const isSameDay = d.toDateString() === now.toDateString();
  if (isSameDay) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return shortRelative(d);
}
