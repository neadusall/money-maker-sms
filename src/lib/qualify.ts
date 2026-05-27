import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { contacts as contactsTable, type Campaign, type Contact } from "@/db/schema";
import { enrichLinkedIn, enrichmentToText, isEnrichmentConfigured, type EnrichedProfile } from "./enrich";
import { recordLlmUsage } from "./usage";
import { regionForLocation } from "./region";

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
    await recordLlmUsage({ model: CLAUDE_MODEL, usage: response.usage, purpose: "rubric" });
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

const SYSTEM_RULES = `You are an expert recruiter screening candidates against the role rubric. Rate fit 1-100. Lean GENEROUS — look for reasons a candidate COULD be a fit, not reasons to reject.

CRITICAL RULES:
- Industry/domain (including "SaaS") is NEVER a disqualifier or a floor requirement. If the rubric frames an industry as must-have/knockout, IGNORE that — industry is only a bonus on top.
- INFER enterprise experience from the COMPANIES (current AND past), using your real-world knowledge of those companies. If a candidate sells or LEADS sales at a large, established, well-known, or clearly enterprise-grade company, treat that as genuine enterprise sales experience — even if the profile never says "enterprise," lists no deal sizes, and no ACV. A big/serious company implies large, complex, multi-stakeholder deals; credit it.
- Judge SENIORITY from the title: VP / SVP / Head of / Director / Regional or Area Sales leader = senior sales leadership; Manager = mid-level; AE / Rep / IC titles = individual contributor.
- BENEFIT OF THE DOUBT: never deduct for unverifiable specifics (exact ACV, team size, quota). Assume a senior leader at a real company has them; mark such items "confirm in conversation."

CALIBRATION (lean high; still use the full range):
- 85-100: senior sales leader AND strong domain match (e.g. enterprise SaaS / procurement / supply chain).
- 70-84: senior sales leader (VP/Dir/Head/Regional) at a substantial or recognizable B2B company in ANY industry — this is the COMMON bucket for genuine sales leaders; default here.
- 55-69: sales leadership at a smaller/unknown company, a strong mid-level seller, or some ambiguity in seniority.
- 40-54: junior management or unclear/limited sales-leadership signal.
- under 40: clearly NOT a sales leader (individual contributor with no leadership, junior, or an ops/product/marketing/non-sales role), or an unrelated function.`;

const SYSTEM = `${SYSTEM_RULES}

Output ONLY a JSON object: {"score": <integer 1-100>, "reason": "<=280 chars; cite the title + company signal you used>"}. No markdown, no preamble.`;

// Batch variant: score many candidates in one call to cut cost ~5x (same model,
// same calibration). Returns a JSON array keyed by the candidate's number.
const BATCH_SYSTEM = `${SYSTEM_RULES}

You will receive a NUMBERED list of candidates. Score EVERY candidate. Output ONLY a JSON array, one object per candidate, no markdown, no preamble:
[{"n": <candidate number>, "score": <integer 1-100>, "reason": "<=120 chars; cite title + company briefly>"}, ...]
Include all candidates exactly once. Keep reasons terse.`;

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

  const model = args.model ?? CLAUDE_MODEL;
  const response = await anthropic().messages.create({
    model,
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: userBlocks }],
  });
  await recordLlmUsage({ model, usage: response.usage, purpose: "score", campaignId: args.campaign.id });

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
 * Score MANY candidates in a single LLM call (cheap bulk scoring). Same model +
 * calibration as scoreCandidate, but ~5x cheaper by amortizing the (cached)
 * rubric across the batch. Scores from title/company/location (+ cached
 * enrichment when present); does NOT fetch new enrichment. Pure — caller
 * persists results. Returns a map of contactId -> score; any candidate the model
 * omits or returns junk for is simply absent (caller leaves it unscored to retry).
 */
export async function scoreCandidatesBatch(args: {
  campaign: Campaign;
  contacts: Contact[];
  model?: string;
  rubric?: string;
}): Promise<Map<string, QualScore>> {
  const out = new Map<string, QualScore>();
  if (!process.env.ANTHROPIC_API_KEY || args.contacts.length === 0) return out;
  if (!args.rubric && !args.campaign.positionSummary?.trim()) return out;

  const lines = args.contacts.map((c, i) => {
    const enr = c.enrichedProfile ? enrichmentToText(c.enrichedProfile as EnrichedProfile).slice(0, 300) : null;
    const who = [
      [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
      c.jobTitle ? `Title: ${c.jobTitle}` : null,
      c.company ? `Co: ${c.company}` : null,
      c.location ? `Loc: ${c.location}` : null,
      enr ? `LinkedIn: ${enr}` : null,
    ].filter(Boolean).join("; ");
    return `${i + 1}. ${who || "(little known)"}`;
  }).join("\n");

  const userBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: args.rubric ? `ROLE REQUIREMENTS (scoring rubric)\n${args.rubric}` : `JOB / POSITION SUMMARY\n${args.campaign.positionSummary}`,
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: `CANDIDATES (score each 1-100):\n${lines}` },
  ];

  const model = args.model ?? CLAUDE_MODEL;
  const response = await anthropic().messages.create({
    model,
    max_tokens: Math.min(8000, 90 * args.contacts.length + 200),
    system: BATCH_SYSTEM,
    messages: [{ role: "user", content: userBlocks }],
  });
  await recordLlmUsage({ model, usage: response.usage, purpose: "score", campaignId: args.campaign.id });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1) return out;
    const arr = JSON.parse(text.slice(start, end + 1)) as { n?: unknown; score?: unknown; reason?: unknown }[];
    for (const o of arr) {
      const idx = Math.round(Number(o.n)) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= args.contacts.length) continue;
      let s = Math.round(Number(o.score));
      if (!Number.isFinite(s)) continue;
      s = Math.max(1, Math.min(100, s));
      out.set(args.contacts[idx].id, { score: s, reason: String(o.reason ?? "").slice(0, 280) });
    }
  } catch {
    return out;
  }
  return out;
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
}): Promise<{
  score: QualScore | null;
  enriched: EnrichedProfile | null;
  fetched: boolean;
  locationRegion: string | null;
  locationMatch: boolean | null;
}> {
  let enriched = (args.contact.enrichedProfile as EnrichedProfile | null) ?? null;
  let fetched = false;
  if (!enriched && isEnrichmentConfigured() && args.contact.linkedinUrl) {
    // Don't pay twice: if any other contact with the SAME LinkedIn URL was
    // already enriched, reuse that profile instead of calling the API again.
    const [dup] = await db
      .select({ p: contactsTable.enrichedProfile })
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.linkedinUrl, args.contact.linkedinUrl),
          ne(contactsTable.id, args.contact.id),
          isNotNull(contactsTable.enrichedProfile),
        ),
      )
      .limit(1);
    enriched = dup?.p ? (dup.p as EnrichedProfile) : await enrichLinkedIn(args.contact.linkedinUrl);
    fetched = true; // store it on this contact too (copy or fresh)
  }
  const enrichmentText = enriched ? enrichmentToText(enriched) : undefined;
  const score = await scoreCandidate({ ...args, enrichmentText });

  // Location signal: detect region from the (enriched or CSV) location, compare
  // to the campaign's target region, and apply a MODEST score nudge.
  const locStr = enriched?.location ?? args.contact.location ?? null;
  const locationRegion = regionForLocation(locStr);
  let locationMatch: boolean | null = null;
  const target = args.campaign.targetRegion;
  if (target) {
    const targets = target.split(",");
    locationMatch = locationRegion != null && targets.includes(locationRegion);
    if (score) {
      // small bump if in-region; small penalty only when we KNOW it's out of region.
      const adj = locationMatch ? 3 : locationRegion != null ? -6 : 0;
      score.score = Math.max(1, Math.min(100, score.score + adj));
    }
  }

  return { score, enriched, fetched, locationRegion, locationMatch };
}
