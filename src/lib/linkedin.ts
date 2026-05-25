/**
 * Direct profile link if we have one on file, otherwise a LinkedIn people-search
 * prefilled with the candidate's name + company + title so it lands on them.
 */
export function linkedinLink(
  url: string | null | undefined,
  name: string,
  company?: string | null,
  title?: string | null,
): { url: string; direct: boolean } {
  if (url && url.trim()) {
    const u = url.trim();
    return { url: u.startsWith("http") ? u : `https://${u}`, direct: true };
  }
  const q = encodeURIComponent([name, company, title].filter(Boolean).join(" "));
  return { url: `https://www.linkedin.com/search/results/people/?keywords=${q}`, direct: false };
}
