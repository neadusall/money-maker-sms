"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Avatar } from "./Avatar";
import { DeleteConversationButton } from "./DeleteConversationButton";
import { formatPhone } from "@/lib/phone";
import { shortRelative } from "@/lib/time";
import { linkedinLink } from "@/lib/linkedin";
import { ScoreBadge } from "./ScoreBadge";

export type ConversationListItem = {
  id: string;
  status: "active" | "needs_attention" | "closed" | "opted_out";
  classification: string | null;
  score: number | null;
  scoreReason: string | null;
  lastMessageAt: string;
  unreadCount: number;
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    phone: string;
    company: string | null;
    jobTitle: string | null;
    linkedinUrl: string | null;
  };
  lastMessage: {
    direction: "outbound" | "inbound";
    body: string;
  } | null;
};

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
  { value: "opted_out", label: "Opted out" },
];

export function ConversationList({
  campaignId,
  campaignName,
  conversations,
}: {
  campaignId: string;
  campaignName: string;
  conversations: ConversationListItem[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filter = searchParams.get("filter") ?? "all";
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    let xs = conversations;
    if (filter === "active") {
      // "Active" = everyone who corresponded in a non-negative way, including
      // those still awaiting your reply (which also show under Needs attention).
      xs = xs.filter((c) => c.status === "active" || c.status === "needs_attention");
    } else if (filter !== "all") {
      xs = xs.filter((c) => c.status === filter);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      xs = xs.filter((c) => {
        const name = [c.contact.firstName, c.contact.lastName].filter(Boolean).join(" ").toLowerCase();
        const company = (c.contact.company ?? "").toLowerCase();
        const body = (c.lastMessage?.body ?? "").toLowerCase();
        const phone = c.contact.phone.toLowerCase();
        return (
          name.includes(q) ||
          company.includes(q) ||
          phone.includes(q) ||
          body.includes(q)
        );
      });
    }
    return xs;
  }, [conversations, filter, query]);

  const openCount = conversations.filter((c) => c.status !== "closed").length;

  return (
    <aside className="flex h-full w-full flex-col border-r border-zinc-200 bg-white sm:w-[360px]">
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <div>
            <Link
              href={`/campaigns/${campaignId}`}
              className="text-xs text-zinc-500 hover:text-zinc-700"
            >
              ← {campaignName}
            </Link>
            <h2 className="text-base font-semibold">
              Open <span className="text-zinc-500">{openCount}</span>
            </h2>
          </div>
        </div>
        <div className="mt-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, message…"
            className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm placeholder:text-zinc-400 focus:border-zinc-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            const href =
              f.value === "all"
                ? `/campaigns/${campaignId}/inbox`
                : `/campaigns/${campaignId}/inbox?filter=${f.value}`;
            return (
              <Link
                key={f.value}
                href={href}
                className={
                  "rounded-full px-2.5 py-0.5 text-xs " +
                  (active
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200")
                }
              >
                {f.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-zinc-500">
            {conversations.length === 0
              ? "No conversations yet."
              : "No conversations match this filter."}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {filtered.map((c) => {
              const href = `/campaigns/${campaignId}/inbox/${c.id}`;
              const isActive = pathname === href;
              const name =
                [c.contact.firstName, c.contact.lastName].filter(Boolean).join(" ") ||
                formatPhone(c.contact.phone);
              const previewPrefix = c.lastMessage?.direction === "outbound" ? "You: " : "";
              const preview = c.lastMessage ? previewPrefix + c.lastMessage.body : "(no messages)";
              const unread = c.unreadCount > 0;
              const li = linkedinLink(c.contact.linkedinUrl, name, c.contact.company, c.contact.jobTitle);

              return (
                <li key={c.id} className="relative">
                  <div className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5">
                    <a
                      href={li.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={li.direct ? `${name}'s LinkedIn profile` : `Find ${name} on LinkedIn`}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-blue-50 hover:text-blue-600"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                        <path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 1 1 8.3 6.5a1.78 1.78 0 0 1-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0 0 13 14.19a.66.66 0 0 0 0 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 0 1 2.7-1.4c1.55 0 3.36.86 3.36 3.66z" />
                      </svg>
                    </a>
                    <DeleteConversationButton
                      campaignId={campaignId}
                      conversationId={c.id}
                      name={name}
                    />
                  </div>
                  <Link
                    href={href}
                    className={
                      "block py-3 pl-4 pr-12 transition-colors " +
                      (isActive
                        ? "bg-sky-50"
                        : c.status === "needs_attention"
                          ? "hover:bg-amber-50/60"
                          : "hover:bg-zinc-50")
                    }
                  >
                    <div className="flex items-start gap-3">
                      <Avatar
                        firstName={c.contact.firstName}
                        lastName={c.contact.lastName}
                        phone={c.contact.phone}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="truncate text-sm font-medium text-zinc-900">{name}</div>
                          <div className="shrink-0 text-xs text-zinc-500">
                            {shortRelative(c.lastMessageAt)}
                          </div>
                        </div>
                        <div className="flex items-start justify-between gap-2">
                          <div
                            className={
                              "mt-0.5 truncate text-xs " +
                              (unread ? "font-medium text-zinc-900" : "text-zinc-500")
                            }
                          >
                            {preview}
                          </div>
                          {unread ? (
                            <span className="mt-1 inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
                              {c.unreadCount}
                            </span>
                          ) : null}
                        </div>
                        {c.classification || c.score != null ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {c.classification ? (
                              <span className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
                                {c.classification.replace(/_/g, " ")}
                              </span>
                            ) : null}
                            <ScoreBadge score={c.score} reason={c.scoreReason} />
                          </div>
                        ) : null}
                        {c.status === "opted_out" ? (
                          <div className="mt-1 inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-700">
                            opted out
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
