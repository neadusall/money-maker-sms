import type { Message } from "@/db/schema";

export function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "queued":
    case "sending":
      return (
        <svg className="h-3 w-3 text-zinc-300" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M8 4v4l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "sent":
      return (
        <svg className="h-3 w-3 text-zinc-300" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 8.5 6.5 12 13 5" />
        </svg>
      );
    case "delivered":
      return (
        <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2 8.5 5.5 12 12 5" />
          <polyline points="6 8.5 9.5 12 16 5" />
        </svg>
      );
    case "failed":
      return (
        <svg className="h-3 w-3 text-rose-400" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5A6.5 6.5 0 1 1 1.5 8 6.5 6.5 0 0 1 8 1.5zM7 4v5h2V4H7zm0 6.5v2h2v-2H7z" />
        </svg>
      );
    case "received":
      return null;
    default:
      return null;
  }
}
