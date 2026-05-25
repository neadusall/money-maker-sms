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

const SYSTEM = `You are an expert recruiter screening candidates for a specific role.
Given the job's position summary and what is known about a candidate (current title,
company, location, and any signals from their SMS conversation), rate how well the
candidate fits THIS role from 1-100 (100 = ideal match, 1 = clearly unqualified).
Weigh seniority level, function/domain match, industry relevance, and conversation signals.
Be discriminating — reserve 85+ for strong fits and use the full range.
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
}): Promise<QualScore | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!args.campaign.positionSummary?.trim()) return null;

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
      text: `JOB / POSITION SUMMARY\n${args.campaign.positionSummary}`,
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
