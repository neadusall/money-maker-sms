import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { recordLlmUsage } from "./usage";
import type Anthropic from "@anthropic-ai/sdk";
import type { Campaign, Contact, ClassificationLabel } from "@/db/schema";

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

const SYSTEM = `You draft short, professional SMS replies on behalf of a recruiter responding to candidates.

The POSITION SUMMARY in the context is your single source of truth — it is usually a full job description pasted in. Read it carefully and pull out whatever the candidate is asking about (compensation, location, remote/hybrid/onsite, required skills, the company, responsibilities, selling points) directly from that text. Do not expect separate fields — everything is in the summary.

Hard rules:
- Stay within 320 characters (2 SMS segments). Prefer under 160.
- No emojis. No exclamation marks. Plain text only.
- Answer the candidate's actual question using details you extract from the position summary.
- Do NOT invent facts. If something the candidate asks about is genuinely not anywhere in the summary, say you'll follow up by email with the details (use the recruiter email/calendar link if helpful).
- Use the candidate's first name only when natural; do not over-name them.
- If the candidate's question is hostile or about complaints, decline politely and suggest emailing the recruiter directly.
- Never use the words "ChatGPT", "AI", "automated".
- Mirror the candidate's tone (formal vs casual) within reason.

Output ONLY the reply text. No quotes, no preamble.`;

export async function draftReply(args: {
  campaign: Campaign;
  contact: Contact;
  classification: ClassificationLabel;
  inboundBody: string;
  recentHistory?: { direction: "outbound" | "inbound"; body: string }[];
}): Promise<string> {
  const context = campaignContextBlock(args.campaign);
  const history = (args.recentHistory ?? [])
    .slice(-6)
    .map((m) => `${m.direction === "outbound" ? "Recruiter" : "Candidate"}: ${m.body}`)
    .join("\n");

  const candidateLine = [
    args.contact.firstName,
    args.contact.lastName,
    args.contact.jobTitle ? `(${args.contact.jobTitle})` : null,
    args.contact.company ? `at ${args.contact.company}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const userBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: `CAMPAIGN CONTEXT\n${context}`,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `CANDIDATE\n${candidateLine || "(unknown)"}

CLASSIFICATION\n${args.classification}

${history ? `RECENT CONVERSATION\n${history}\n\n` : ""}LATEST CANDIDATE REPLY\n${args.inboundBody}

Draft the recruiter's next SMS reply.`,
    },
  ];

  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: userBlocks }],
  });
  await recordLlmUsage({ model: CLAUDE_MODEL, usage: response.usage, purpose: "draft", campaignId: args.campaign.id });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return text;
}
