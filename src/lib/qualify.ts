import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import type { Campaign, Contact } from "@/db/schema";
import { enrichLinkedIn, enrichmentToText, isEnrichmentConfigured, type EnrichedProfile } from "./enrich";

const ScoreSchema = z.object({
  score: z.number().int().min(1).max(100),
  reason: z.string().max(280),
});
export type QualScore = z.infer<typeof ScoreSchema>;

const RUBRIC_SYSTEM = `You are an expert recruiter. Distill this job description into a COMPACT scoring rubric a screener applies quickly. Cover: role title & seniority; core function; must-have experience (years/type of LEADERSHIP and selling); preferred industries/domains — label these clearly as PREFERENCES that ADD points, NOT requirements; typical deal profile; key skills.
For "Hard Disqualifiers", list ONLY truly absolute knockouts — e.g., not a sales professional at all, individual-contributor with zero leadership when leadership is required, clearly junior, SMB-only with no enterprise exposure, or a completely unrelated function. NEVER put an industry, domain, or specific-sector experience (e.g. "SaaS", "procurement") under must-have/knockout — those ALWAYS belong under PREFERENCES, even if the job description emphasizes them. State explicitly that transferable enterprise sales leadership from an ADJACENT industry is a STRONG candidate, not a reject.
Keep under ~250 words. Plain bullets, no preamble.`;

/** Distill a long position summary into a compact rubric (one-time per campaign). */
export async function buildScoringRubric(positionSummary: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY || !positionSummary.trim()) return null;
  try {
    const response = await anthropic().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      system: RUBRIC_SYSTEM,
      messages: [{ role: "user", content: positionSummary }],
    });
    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

const SYSTEM = `You are an expert recruiter screening candidates against the role rubric. Rate fit 1-100, thinking like a recruiter who prizes TRANSFERABLE enterprise sales leadership — not a keyword filter.

CRITICAL RULES:
- Industry/domain (including whether the candidate is in "SaaS") is NEVER a disqualifier and NEVER a floor requirement. If the rubric frames an industry/domain as a must-have or knockout, IGNORE that framing — treat industry only as a bonus on top.
- Set the FLOOR from enterprise sales LEADERSHIP only: seniority (VP / Director / Head of Sales), years leading sales teams, owning a region/quota, and experience with complex, multi-stakeholder, larger deals.
- Then ADD up to ~20 points for domain/industry match to the target space (e.g., SaaS, procurement, supply chain).

CALIBRATION (use the FULL range; do NOT bunch everyone low):
- 85-100: senior enterprise sales leader AND strong domain match.
- 65-84: solid enterprise sales leader (VP/Director at a real B2B company) — even in a DIFFERENT/adjacent industry. Most genuine sales VPs/Directors with enterprise, complex-deal experience belong HERE.
- 45-64: some sales leadership but smaller scope, or unclear enterprise/complex-deal experience.
- under 45: NOT a sales leader (individual contributor, junior, or an ops/product/marketing/non-sales role), SMB-only with no enterprise exposure, or an unrelated function.
A VP or Director of Sales at a substantial B2B company should rarely score below 60 unless there is a clear seniority or function problem.

BENEFIT OF THE DOUBT: Score on what's PRESENT. Do NOT deduct for specifics you can't verify from a title/company/profile (exact ACV, team headcount, quota) — assume a senior sales leader at a real company has typical enterprise experience unless something contradicts it, and treat those unknowns as "confirm in conversation," not as gaps that lower the score.

Output ONLY a JSON object: {"score": <integer 1-100>, "reason": "<=280 chars, why"}. No markdown, no preamble.`;

/**
 * Score a candidate's fit for the campaign's role using the LLM. Based on the
 * title/company/location we have on file plus the conversation (we cannot read
 * their live LinkedIn page). Returns null if not scorable.
 */
export async function scoreCandidate(args: {
  campaign: Campaign;
  contact: Contact;
  recentHistory?: { direction: "outbound" | "inbound"; body: string }[];
  model?: string;
  enrichmentText?: string;
  rubric?: string;
}): Promise<QualScore | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!args.rubric && !args.campaign.positionSummary?.trim()) return null;

  const c = args.contact;
  const who = [
    c.firstName || c.lastName ? `Name: ${[c.firstName, c.lastName].filter(Boolean).join(" ")}` : null,
    c.jobTitle ? `Current title: ${c.jobTitle}` : null,
    c.company ? `Current company: ${c.company}` : null,
    c.location ? `Location: ${c.location}` : null,
    // Full LinkedIn work history (when enriched) — the most authoritative signal.
    args.enrichmentText ? `\nLinkedIn profile:\n${args.enrichmentText}` : null,
    !args.enrichmentText && c.linkedinUrl ? `LinkedIn: ${c.linkedinUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const history = (args.recentHistory ?? [])
    .slice(-6)
    .map((m) => `${m.direction === "outbound" ? "Recruiter" : "Candidate"}: ${m.body}`)
    .join("\n");

  const userBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: args.rubric
        ? `ROLE REQUIREMENTS (scoring rubric)\n${args.rubric}`
        : `JOB / POSITION SUMMARY\n${args.campaign.positionSummary}`,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `CANDIDATE\n${who || "(little known)"}${history ? `\n\nCONVERSATION\n${history}` : ""}`,
    },
  ];

  const response = await anthropic().messages.create({
    model: args.model ?? CLAUDE_MODEL,
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: userBlocks }],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    // Lenient parse: clamp the score and truncate the reason rather than
    // rejecting a valid answer just because the model wrote a long reason.
    const obj = JSON.parse(text.slice(start, end + 1)) as { score?: unknown; reason?: unknown };
    let score = Math.round(Number(obj.score));
    if (!Number.isFinite(score)) return null;
    score = Math.max(1, Math.min(100, score));
    const reason = String(obj.reason ?? "").slice(0, 280);
    return { score, reason };
  } catch {
    return null;
  }
}

/**
 * Score a contact using their real LinkedIn work history when possible: reuse a
 * cached enriched profile, else fetch one via the enrichment API. Pure (no DB
 * writes) — the caller persists `score` and `enriched`.
 */
export async function scoreContactDeep(args: {
  campaign: Campaign;
  contact: Contact;
  recentHistory?: { direction: "outbound" | "inbound"; body: string }[];
  model?: string;
  rubric?: string;
}): Promise<{ score: QualScore | null; enriched: EnrichedProfile | null; fetched: boolean }> {
  let enriched = (args.contact.enrichedProfile as EnrichedProfile | null) ?? null;
  let fetched = false;
  if (!enriched && isEnrichmentConfigured() && args.contact.linkedinUrl) {
    enriched = await enrichLinkedIn(args.contact.linkedinUrl);
    fetched = true;
  }
  const enrichmentText = enriched ? enrichmentToText(enriched) : undefined;
  const score = await scoreCandidate({ ...args, enrichmentText });
  return { score, enriched, fetched };
}
