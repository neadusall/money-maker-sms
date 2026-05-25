import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { db } from "@/db/client";
import { todos, messages, type Campaign, type Contact, type TodoChannel } from "@/db/schema";

const ItemSchema = z.object({
  action: z.string().min(1).max(160),
  channel: z.enum(["sms", "email", "linkedin", "call", "other"]),
  detail: z.string().max(300).nullish(),
  dedupe_key: z.string().min(1).max(60),
});
const ListSchema = z.array(ItemSchema).max(8);
export type TodoItem = z.infer<typeof ItemSchema>;

const SYSTEM = `You are a recruiting operations assistant. You read an SMS thread between a recruiter and a candidate and produce the recruiter's OPEN follow-up actions — concrete things the recruiter must still do manually.

Rules:
- Only list actions that are NOT yet done. If the recruiter already answered/handled something in the thread, do not list it.
- Each action is a short imperative the recruiter can check off (e.g. "Email the job description", "Reply with the comp range", "Connect on LinkedIn", "Call to schedule a screen").
- Pick the channel that the action happens on: sms, email, linkedin, call, or other.
- Put any specifics in "detail" (the candidate's email address, the exact question they asked, a time they proposed, a LinkedIn name, etc.).
- "dedupe_key" is a short stable slug for the KIND of action (e.g. "send_jd", "answer_comp", "answer_remote", "schedule_call", "connect_linkedin", "reengage"). Reuse the same key for the same kind of action across runs.
- If the candidate is not interested, declined, wrong person, or opted out: return [].
- If there is nothing for the recruiter to do right now: return [].

Output ONLY a JSON array (possibly empty). No markdown, no prose.`;

function threadText(msgs: { direction: "outbound" | "inbound"; body: string }[]): string {
  return msgs
    .map((m) => `${m.direction === "outbound" ? "Recruiter" : "Candidate"}: ${m.body}`)
    .join("\n");
}

function contextBlock(campaign: Campaign, contact: Contact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.phone;
  const lines = [
    `Role: ${campaign.name}`,
    `Candidate: ${name}`,
    contact.email ? `Candidate email on file: ${contact.email}` : null,
    contact.linkedinUrl ? `Candidate LinkedIn: ${contact.linkedinUrl}` : null,
    campaign.recruiterName ? `Recruiter: ${campaign.recruiterName}` : null,
    campaign.calendarLink ? `Recruiter calendar: ${campaign.calendarLink}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

function extractJsonArray(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : s).trim();
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return "[]";
  return candidate.slice(start, end + 1);
}

/** Ask Claude for the recruiter's open follow-up actions on one conversation. */
export async function generateTodoItems(args: {
  campaign: Campaign;
  contact: Contact;
  thread: { direction: "outbound" | "inbound"; body: string }[];
}): Promise<TodoItem[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const userBlocks: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: `CONTEXT\n${contextBlock(args.campaign, args.contact)}` },
    { type: "text", text: `SMS THREAD\n${threadText(args.thread)}` },
  ];

  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: userBlocks }],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  try {
    return ListSchema.parse(JSON.parse(extractJsonArray(text)));
  } catch {
    return [];
  }
}

/**
 * Generate follow-up to-dos for one conversation and upsert them. Existing
 * to-dos with the same (conversationId, dedupeKey) are left untouched (so a
 * done/checked item never reappears). Returns the number of NEW to-dos added.
 */
export async function syncTodosForConversation(args: {
  campaign: Campaign;
  contact: Contact;
  conversationId: string;
}): Promise<number> {
  const thread = await db
    .select({ direction: messages.direction, body: messages.body })
    .from(messages)
    .where(eq(messages.conversationId, args.conversationId))
    .orderBy(messages.createdAt);

  // No candidate reply -> no correspondence to act on.
  if (!thread.some((m) => m.direction === "inbound")) return 0;

  const items = await generateTodoItems({ campaign: args.campaign, contact: args.contact, thread });
  if (items.length === 0) return 0;

  let added = 0;
  for (const item of items) {
    const res = await db
      .insert(todos)
      .values({
        campaignId: args.campaign.id,
        contactId: args.contact.id,
        conversationId: args.conversationId,
        action: item.action,
        channel: item.channel as TodoChannel,
        detail: item.detail ?? null,
        dedupeKey: item.dedupe_key,
        source: "ai",
      })
      .onConflictDoNothing({ target: [todos.conversationId, todos.dedupeKey] })
      .returning({ id: todos.id });
    if (res.length > 0) added++;
  }
  return added;
}

/** Count of open to-dos — used by the nav badge. */
export async function openTodoCount(): Promise<number> {
  return await db.$count(todos, eq(todos.status, "open"));
}
