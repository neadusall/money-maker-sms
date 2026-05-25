export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 shadow-sm ring-1 ring-emerald-700/20">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.5 20.25 4 21l.75-3.5A8.5 8.5 0 1 1 7.5 20.25Z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8.5v7M13.8 10.2A2 2 0 0 0 12 9.3c-1.1 0-2 .7-2 1.6 0 2 4 1.2 4 3.2 0 .9-.9 1.6-2 1.6a2 2 0 0 1-1.8-.9" />
        </svg>
      </span>
      {!compact ? (
        <span className="flex items-baseline gap-1 leading-none">
          <span className="text-base font-bold tracking-tight text-zinc-900">MoneyMaker</span>
          <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
            SMS
          </span>
        </span>
      ) : null}
    </span>
  );
}
