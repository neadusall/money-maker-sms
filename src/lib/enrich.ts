/**
 * LinkedIn profile enrichment via the RapidAPI "LinkedIn Scraper API". Given a
 * profile URL, returns structured work history we can feed to the fit scorer.
 * Compliant: the provider sources the data, not Ryan's account.
 */
export type EnrichedProfile = {
  headline: string | null;
  about: string | null;
  location: string | null;
  experience: { title: string; company: string; duration: string; location?: string; isCurrent?: boolean }[];
  education: { school: string; degree?: string; duration?: string }[];
};

type RawExp = { title?: string; company?: string; duration?: string; location?: string; is_current?: boolean };
type RawEdu = { school?: string; degree?: string; degree_name?: string; duration?: string };
type RawResp = {
  success?: boolean;
  data?: {
    basic_info?: { headline?: string; about?: string; location?: { full?: string; city?: string } };
    experience?: RawExp[];
    education?: RawEdu[];
  };
};

export function isEnrichmentConfigured(): boolean {
  return Boolean(process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_LINKEDIN_HOST);
}

/** Pull the /in/<slug> username out of a LinkedIn URL (or accept a bare slug). */
export function linkedinUsername(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]);
  const slug = url.trim().replace(/^\/+|\/+$/g, "");
  if (slug && !slug.includes("/") && !slug.includes(" ") && !slug.includes(".")) return slug;
  return null;
}

export async function enrichLinkedIn(url: string | null | undefined): Promise<EnrichedProfile | null> {
  if (!isEnrichmentConfigured()) return null;
  const username = linkedinUsername(url);
  if (!username) return null;
  const host = process.env.RAPIDAPI_LINKEDIN_HOST!;
  const key = process.env.RAPIDAPI_KEY!;
  try {
    const res = await fetch(`https://${host}/profile/detail?username=${encodeURIComponent(username)}`, {
      headers: { "x-rapidapi-host": host, "x-rapidapi-key": key, "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as RawResp;
    if (!j?.success || !j.data) return null;
    const d = j.data;
    const b = d.basic_info ?? {};
    return {
      headline: b.headline ?? null,
      about: b.about ?? null,
      location: b.location?.full ?? b.location?.city ?? null,
      experience: (d.experience ?? []).slice(0, 12).map((e) => ({
        title: e.title ?? "",
        company: e.company ?? "",
        duration: e.duration ?? "",
        location: e.location,
        isCurrent: e.is_current,
      })),
      education: (d.education ?? []).slice(0, 6).map((e) => ({
        school: e.school ?? "",
        degree: e.degree_name || e.degree,
        duration: e.duration,
      })),
    };
  } catch {
    return null;
  }
}

/** Render an enriched profile into a compact block for the scoring prompt. */
export function enrichmentToText(p: EnrichedProfile): string {
  const lines: string[] = [];
  if (p.headline) lines.push(`Headline: ${p.headline}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.about) lines.push(`About: ${p.about.slice(0, 600)}`);
  if (p.experience.length) {
    lines.push("Work history:");
    for (const e of p.experience) {
      lines.push(`- ${e.title} @ ${e.company}${e.duration ? ` (${e.duration})` : ""}${e.location ? ` — ${e.location}` : ""}`);
    }
  }
  if (p.education.length) {
    lines.push("Education:");
    for (const e of p.education) lines.push(`- ${[e.degree, e.school].filter(Boolean).join(", ")}${e.duration ? ` (${e.duration})` : ""}`);
  }
  return lines.join("\n");
}
