export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      {/* Mark: flat brand square with a message glyph (Meridian style, no gradients) */}
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 text-white"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* speech bubble */}
          <path d="M4 11.5C4 7.36 7.58 4 12 4s8 3.36 8 7.5-3.58 7.5-8 7.5c-1.05 0-2.05-.19-2.96-.55L4 20l1.36-3.66A7.4 7.4 0 0 1 4 11.5Z" />
          {/* message lines */}
          <path d="M8.5 10.5h7M8.5 13.5h4.5" />
        </svg>
      </span>

      {/* Wordmark: "OS Text", flat ink, Meridian type */}
      {!compact ? (
        <span className="text-lg font-semibold leading-none tracking-tight text-zinc-900">
          OS Text
        </span>
      ) : null}
    </span>
  );
}
