import { regionLabel } from "@/lib/region";

/** Location checkmark: green when the candidate is in the campaign's target
 * region, muted (with their actual region) when not. Nothing if no target set. */
export function LocationBadge({
  match,
  region,
}: {
  match: boolean | null | undefined;
  region?: string | null;
}) {
  if (match == null) return null;
  const cls = match ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500";
  const label = match ? "In region" : regionLabel(region) || "Out of region";
  return (
    <span
      title={match ? "Location is in the target region" : "Outside the target region"}
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
      </svg>
      {match ? <span aria-hidden>✓</span> : null}
      {label}
    </span>
  );
}
