/** Candidate fit score (1-100) pill, color-coded. Renders nothing if unscored. */
export function ScoreBadge({
  score,
  reason,
  label = "Fit",
}: {
  score: number | null | undefined;
  reason?: string | null;
  label?: string;
}) {
  if (score == null) return null;
  const cls =
    score >= 80
      ? "bg-emerald-100 text-emerald-700"
      : score >= 60
        ? "bg-amber-100 text-amber-700"
        : "bg-rose-100 text-rose-700";
  return (
    <span
      title={reason ? `Fit ${score}/100: ${reason}` : `Fit score ${score}/100`}
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${cls}`}
    >
      {label ? `${label} ` : ""}
      {score}
    </span>
  );
}
