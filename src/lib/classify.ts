import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { recordLlmUsage } from "./usage";
import type { Campaign, ClassificationLabel } from "@/db/schema";

const LABELS = [
  "positive",
  "curious",
  "negative",
  "not_interested",
  "wrong_person",
  "stop",
  "referral",
  "asked_email",
  "asked_compensation",
  "asked_remote",
  "asked_client",
  "already_employed",
  "later",
  "other",
] as const;

const ClassificationSchema = z.object({
  label: z.enum(LABELS),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(240),
  suggested_action: z.enum(["draft_reply", "ignore", "stop", "escalate"]),
});

export type Classification = z.infer<typeof ClassificationSchema>;

function campaignContextBlock(campaign: Campaign): string {
  const lines: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  push("Campaign", campaign.name);
  push("POSITION SUMMARY / JOB DESCRIPTION", campaign.positionSummary);
  push("Recruiter name", campaign.recruiterName);
  push("Recruiter email", campaign.recruiterEmail);
  push("Calendar link", campaign.calendarLink);
  return lines.join("\n");
}

const SYSTEM = `You triage inbound SMS replies from candidates contacted for a confidential recruiting outreach campaign.
Given the campaign context and a candidate's reply, classify the reply and recommend an action.

Labels:
- positive: explicit interest or willingness to discuss
- curious: asking for more details, neutral tone
- negative: clearly not interested but not a STOP
- not_interested: declines politely
- wrong_person: claims wrong number or person
- stop: opt-out, "remove me", "stop", angry/hostile
- referral: suggests someone else
- asked_email: requests info by email
- asked_compensation: asks about pay
- asked_remote: asks about remote/onsite
- asked_client: asks who the client/company is
- already_employed: says happy where they are
- later: wants to talk later / not now
- other: doesn't fit above

Suggested action:
- draft_reply: prepare a draft response for human review/send
- ignore: no action needed
- stop: opt them out and never message again
- escalate: notify recruiter (referrals, complaints, complex questions)

Output ONLY a single JSON object with keys: label, confidence (0-1), rationale (<=240 chars), suggested_action.
No markdown, no code fences, no preamble.`;

export async function classifyReply(args: {
  campaign: Campaign;
  inboundBody: string;
  recentHistory?: { direction: "outbound" | "inbound"; body: string }[];
}): Promise<Classification> {
  const context = campaignContextBlock(args.campaign);
  const history = (args.recentHistory ?? [])
    .slice(-6)
    .map((m) => `${m.direction === "outbound" ? "Recruiter" : "Candidate"}: ${m.body}`)
    .join("\n");

  const userBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: `CAMPAIGN CONTEXT\n${context}`,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: history
        ? `RECENT CONVERSATION\n${history}\n\nLATEST CANDIDATE REPLY\n${args.inboundBody}`
        : `CANDIDATE REPLY\n${args.inboundBody}`,
    },
  ];

  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: userBlocks }],
  });
  await recordLlmUsage({ model: CLAUDE_MODEL, usage: response.usage, purpose: "classify", campaignId: args.campaign.id });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const jsonText = extractJsonObject(text);
  const parsed = JSON.parse(jsonText);
  return ClassificationSchema.parse(parsed);
}

function extractJsonObject(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : s).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return candidate;
  return candidate.slice(start, end + 1);
}

export function isAutoSendCandidate(c: Classification): boolean {
  if (c.confidence < 0.7) return false;
  return (
    c.suggested_action === "draft_reply" &&
    ["positive", "curious", "asked_email", "asked_compensation", "asked_remote", "asked_client"].includes(c.label)
  );
}

export function isAutoIgnoreNegative(label: ClassificationLabel): boolean {
  return label === "stop" || label === "not_interested" || label === "negative";
}
