export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="group inline-flex items-center gap-2 select-none">
      {/* Mark: gradient pill with a stylized chat-bolt + live "pulse" dot */}
      <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 via-violet-500 to-fuchsia-500 shadow-md shadow-violet-500/25 ring-1 ring-violet-900/15 transition-transform duration-200 group-hover:scale-[1.06]">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 text-white drop-shadow-sm"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* speech bubble */}
          <path d="M4 11.5C4 7.36 7.58 4 12 4s8 3.36 8 7.5-3.58 7.5-8 7.5c-1.05 0-2.05-.19-2.96-.55L4 20l1.36-3.66A7.4 7.4 0 0 1 4 11.5Z" />
          {/* bolt inside */}
          <path d="M13.4 8.4 9.2 13.2H12l-.6 3 4.2-4.8h-2.8z" fill="currentColor" stroke="none" />
        </svg>
        {/* live pulse dot */}
        <span className="absolute -right-0.5 -top-0.5">
          <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400 opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        </span>
      </span>

      {/* Wordmark: lowercase "taltxt" with a sky→violet→fuchsia gradient */}
      {!compact ? (
        <span className="text-lg font-extrabold leading-none tracking-tight">
          <span className="bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
            taltxt
          </span>
        </span>
      ) : null}
    </span>
  );
}
