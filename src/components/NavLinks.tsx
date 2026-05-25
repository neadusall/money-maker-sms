"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ todoCount = 0 }: { todoCount?: number }) {
  const pathname = usePathname();
  const onNew = pathname.startsWith("/campaigns/new");
  const onTodos = pathname.startsWith("/todos");
  const onCampaigns = !onNew && !onTodos;

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
      ? "bg-white text-emerald-700 shadow-sm ring-1 ring-zinc-200"
      : "text-zinc-600 hover:text-zinc-900")
  );
}
