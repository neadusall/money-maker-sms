"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ todoCount = 0 }: { todoCount?: number }) {
  const pathname = usePathname();
  const onNew = pathname.startsWith("/campaigns/new");
  const onTodos = pathname.startsWith("/todos");
  const onSpend = pathname.startsWith("/spend");
  const onCampaigns = !onNew && !onTodos && !onSpend;

  return (
    <div className="flex items-center gap-1 rounded-xl bg-zinc-100 p-1">
      <Link href="/" className={pill(onCampaigns)}>
        Campaigns
      </Link>
      <Link href="/todos" className={pill(onTodos)}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        To-dos
        {todoCount > 0 ? (
          <span className="ml-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
            {todoCount}
          </span>
        ) : null}
      </Link>
      <Link href="/spend" className={pill(onSpend)}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        Spend
      </Link>
      <Link href="/campaigns/new" className={pill(onNew)}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Create campaign
      </Link>
    </div>
  );
}

function pill(active: boolean): string {
  return (
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition " +
    (active
      ? "bg-white text-brand shadow-sm ring-1 ring-zinc-200"
      : "text-zinc-600 hover:text-zinc-900")
  );
}
