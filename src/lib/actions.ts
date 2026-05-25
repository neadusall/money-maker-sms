"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne, desc, sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  campaigns,
  contacts,
  conversations,
  messages,
  users,
  suppressedNumbers,
  todos,
  type Campaign,
  type Contact,
  type LlmMode,
  type TodoChannel,
} from "@/db/schema";
import { auth, signOut } from "./auth";

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
import { parseCsv, type ImportedContact } from "./csv";
import { alwaysAllowNumbers } from "./always-allow";
import { seedContacts } from "./seed-contacts";
import { renderTemplate, findUnmergedTokens } from "./merge";
import { sendSms } from "./telnyx";
import { normalizePhone } from "./phone";
import { isStopKeyword } from "./opt-out";
import { classifyReply, isAutoSendCandidate, isAutoIgnoreNegative } from "./classify";
import { draftReply } from "./draft-reply";
import { paceForNextSend } from "./pacing";
import { isWithinSendWindow } from "./send-window";
import {
  replyDelaySeconds,
  isQStashConfigured,
  scheduleReply,
  enqueueCampaignDrain,
  enqueueValidationDrain,
} from "./schedule";
import {
  isPositionEmailConfigured,
  extractEmail,
  buildPositionEmail,
  sendPositionEmail,
} from "./position-email";
import { sentimentOf } from "./sentiment";
import { syncTodosForConversation } from "./todos";
import { scoreCandidate } from "./qualify";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Categorize uploaded rows for a campaign:
 *  - drops duplicates within the file and anyone already in this campaign,
 *  - optionally drops anyone already texted in another campaign,
 *  - always-allow numbers are never dropped.
 */
async function categorizeUpload(
  campaignId: string,
  rows: ImportedContact[],
  skipPrev: boolean,
): Promise<{ toInsert: ImportedContact[]; dupSkipped: number; prevSkipped: number }> {
  const allow = alwaysAllowNumbers();
  const phones = Array.from(new Set(rows.map((r) => r.phone)));
  if (phones.length === 0) return { toInsert: [], dupSkipped: 0, prevSkipped: 0 };

  const existing = await db
    .select({ phone: contacts.phone })
    .from(contacts)
    .where(and(eq(contacts.campaignId, campaignId), inArray(contacts.phone, phones)));
  const supp = await db
    .select({ phone: suppressedNumbers.phone })
    .from(suppressedNumbers)
    .where(and(eq(suppressedNumbers.campaignId, campaignId), inArray(suppressedNumbers.phone, phones)));

  const inCampaign = new Set<string>();
  for (const r of existing) if (!allow.has(r.phone)) inCampaign.add(r.phone);
  for (const r of supp) if (!allow.has(r.phone)) inCampaign.add(r.phone);

  const prev = skipPrev ? await previouslyTextedPhones(phones, campaignId) : new Set<string>();
  for (const p of allow) prev.delete(p);

  const seen = new Set<string>();
  const toInsert: ImportedContact[] = [];
  let dupSkipped = 0;
  let prevSkipped = 0;
  for (const r of rows) {
    if (seen.has(r.phone)) {
      dupSkipped++;
      continue;
    }
    seen.add(r.phone);
    if (inCampaign.has(r.phone)) {
      dupSkipped++;
      continue;
    }
    if (prev.has(r.phone)) {
      prevSkipped++;
      continue;
    }
    toInsert.push(r);
  }
  return { toInsert, dupSkipped, prevSkipped };
}

/** Phones (from the given list) that have already been texted in OTHER campaigns. */
async function previouslyTextedPhones(phones: string[], excludeCampaignId: string): Promise<Set<string>> {
  const result = new Set<string>();
  const uniq = Array.from(new Set(phones));
  if (uniq.length === 0) return result;

  const fromSuppression = await db
    .select({ phone: suppressedNumbers.phone })
    .from(suppressedNumbers)
    .where(and(inArray(suppressedNumbers.phone, uniq), ne(suppressedNumbers.campaignId, excludeCampaignId)));
  const fromContacts = await db
    .select({ phone: contacts.phone })
    .from(contacts)
    .where(
      and(
        inArray(contacts.phone, uniq),
        ne(contacts.campaignId, excludeCampaignId),
        inArray(contacts.status, ["sent", "delivered", "replied"]),
      ),
    );
  for (const r of fromSuppression) result.add(r.phone);
  for (const r of fromContacts) result.add(r.phone);
  return result;
}

export async function createCampaign(formData: FormData) {
  const name = str(formData, "name");
  const smsTemplate = str(formData, "smsTemplate");
  if (!name || !smsTemplate) {
    throw new Error("Campaign name and SMS template are required");
  }
  const llmModeValue = (str(formData, "llmMode") ?? "draft_only") as LlmMode;

  const [created] = await db
    .insert(campaigns)
    .values({
      name,
      smsTemplate,
      llmMode: llmModeValue,
      positionSummary: str(formData, "positionSummary"),
      calendarLink: str(formData, "calendarLink"),
      recruiterName: str(formData, "recruiterName"),
      recruiterEmail: str(formData, "recruiterEmail"),
      fromNumber: str(formData, "fromNumber"),
      salesNavUrl: str(formData, "salesNavUrl"),
      sendWindowStart: str(formData, "sendWindowStart") ?? "09:00",
      sendWindowEnd: str(formData, "sendWindowEnd") ?? "19:00",
    })
    .returning();

  // Optional CSV uploaded inline with the new-campaign form
  // Always include the seed contact (e.g. your own number) so you receive every campaign.
  const seeds = seedContacts();
  if (seeds.length > 0) {
    await db
      .insert(contacts)
      .values(
        seeds.map((s) => ({
          campaignId: created.id,
          firstName: s.firstName,
          phone: s.phone,
          customFields: {},
          status: "pending" as const,
        })),
      )
      .onConflictDoNothing({ target: [contacts.campaignId, contacts.phone] });
  }

  const file = formData.get("csv");
  let summary: { added: number; prev: number; dup: number } | null = null;
  if (file instanceof File && file.size > 0) {
    const validate = formData.get("validateMobile") != null && isQStashConfigured();
    const skipPrev = formData.get("skipPreviouslyTexted") != null;
    const text = await file.text();
    const result = parseCsv(text);
    const { toInsert, dupSkipped, prevSkipped } = await categorizeUpload(created.id, result.rows, skipPrev);
    if (toInsert.length > 0) {
      await db
        .insert(contacts)
        .values(
          toInsert.map((r) => ({
            campaignId: created.id,
            firstName: r.firstName,
            lastName: r.lastName,
            company: r.company,
            jobTitle: r.jobTitle,
            phone: r.phone,
            email: r.email,
            linkedinUrl: r.linkedinUrl,
            location: r.location,
            customFields: r.customFields,
            status: (validate ? "validating" : "pending") as "validating" | "pending",
          })),
        )
        .onConflictDoNothing({ target: [contacts.campaignId, contacts.phone] });
      if (validate) await enqueueValidationDrain(created.id, 1);
    }
    summary = { added: toInsert.length, prev: prevSkipped, dup: dupSkipped };
  }

  revalidatePath("/");
  if (summary) {
    redirect(
      `/campaigns/${created.id}/contacts?added=${summary.added}&prev=${summary.prev}&dup=${summary.dup}`,
    );
  }
  redirect(`/campaigns/${created.id}`);
}

export async function deleteCampaign(campaignId: string) {
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  revalidatePath("/");
  redirect("/");
}

export async function saveProfileImage(dataUrl: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not signed in");
  if (!dataUrl.startsWith("data:image/")) throw new Error("Invalid image data");
  if (dataUrl.length > 400_000) throw new Error("Image too large; pick a smaller photo");
  await db.update(users).set({ image: dataUrl }).where(eq(users.id, userId));
  revalidatePath("/account");
  revalidatePath("/", "layout");
}

export async function removeProfileImage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not signed in");
  await db.update(users).set({ image: null }).where(eq(users.id, userId));
  revalidatePath("/account");
  revalidatePath("/", "layout");
}

export async function updateCampaign(campaignId: string, formData: FormData) {
  await db
    .update(campaigns)
    .set({
      name: str(formData, "name") ?? undefined,
      smsTemplate: str(formData, "smsTemplate") ?? undefined,
      llmMode: (str(formData, "llmMode") as LlmMode | null) ?? undefined,
      positionSummary: str(formData, "positionSummary"),
      calendarLink: str(formData, "calendarLink"),
      recruiterName: str(formData, "recruiterName"),
      recruiterEmail: str(formData, "recruiterEmail"),
      fromNumber: str(formData, "fromNumber"),
      salesNavUrl: str(formData, "salesNavUrl"),
      sendWindowStart: str(formData, "sendWindowStart") ?? undefined,
      sendWindowEnd: str(formData, "sendWindowEnd") ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, campaignId));

  revalidatePath(`/campaigns/${campaignId}`);
}

export async function setCampaignStatus(campaignId: string, status: "active" | "paused" | "completed" | "draft") {
  await db.update(campaigns).set({ status, updatedAt: new Date() }).where(eq(campaigns.id, campaignId));
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function uploadContactsCsv(campaignId: string, formData: FormData): Promise<void> {
  const file = formData.get("csv");
  if (!(file instanceof File)) {
    throw new Error("No CSV file provided");
  }
  const validate = formData.get("validateMobile") != null && isQStashConfigured();
  const skipPrev = formData.get("skipPreviouslyTexted") != null;
  const text = await file.text();
  const result = parseCsv(text);
  const { toInsert, dupSkipped, prevSkipped } = await categorizeUpload(campaignId, result.rows, skipPrev);

  if (toInsert.length > 0) {
    await db
      .insert(contacts)
      .values(
        toInsert.map((r) => ({
          campaignId,
          firstName: r.firstName,
          lastName: r.lastName,
          company: r.company,
          jobTitle: r.jobTitle,
          phone: r.phone,
          email: r.email,
          linkedinUrl: r.linkedinUrl,
          location: r.location,
          customFields: r.customFields,
          status: (validate ? "validating" : "pending") as "validating" | "pending",
        })),
      )
      .onConflictDoNothing({ target: [contacts.campaignId, contacts.phone] });
    if (validate) await enqueueValidationDrain(campaignId, 1);
  }

  revalidatePath("/");
  revalidatePath(`/campaigns/${campaignId}/contacts`);
  revalidatePath(`/campaigns/${campaignId}`);
  redirect(`/campaigns/${campaignId}/contacts?added=${toInsert.length}&prev=${prevSkipped}&dup=${dupSkipped}`);
}

/** Re-validate existing pending/failed contacts: mark them validating and kick off the drain. */
export async function validateExistingContacts(campaignId: string): Promise<void> {
  if (!isQStashConfigured()) return;
  await db
    .update(contacts)
    .set({ status: "validating" })
    .where(and(eq(contacts.campaignId, campaignId), inArray(contacts.status, ["pending", "failed"])));
  await enqueueValidationDrain(campaignId, 1);
  revalidatePath(`/campaigns/${campaignId}/contacts`);
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function deleteContact(campaignId: string, contactId: string) {
  await db.delete(contacts).where(and(eq(contacts.id, contactId), eq(contacts.campaignId, campaignId)));
  revalidatePath("/");
  revalidatePath(`/campaigns/${campaignId}/contacts`);
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function deleteAllContacts(campaignId: string): Promise<void> {
  // Before clearing, record everyone we've already messaged into the suppression
  // list so a fresh upload never re-texts them — even sends that predate this list.
  const messaged = await db
    .select({ phone: contacts.phone })
    .from(contacts)
    .where(
      and(
        eq(contacts.campaignId, campaignId),
        inArray(contacts.status, ["sent", "delivered", "replied", "opted_out"]),
      ),
    );
  const allow = alwaysAllowNumbers();
  const toSuppress = messaged.filter((m) => !allow.has(m.phone));
  if (toSuppress.length > 0) {
    await db
      .insert(suppressedNumbers)
      .values(toSuppress.map((m) => ({ campaignId, phone: m.phone, reason: "messaged" })))
      .onConflictDoNothing({ target: [suppressedNumbers.campaignId, suppressedNumbers.phone] });
  }

  // Clear the contact list (cascades conversations/messages). Suppression survives.
  await db.delete(contacts).where(eq(contacts.campaignId, campaignId));
  await db.update(campaigns).set({ status: "draft", updatedAt: new Date() }).where(eq(campaigns.id, campaignId));
  revalidatePath("/");
  revalidatePath(`/campaigns/${campaignId}/contacts`);
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function clearSuppressionList(campaignId: string): Promise<void> {
  await db.delete(suppressedNumbers).where(eq(suppressedNumbers.campaignId, campaignId));
  revalidatePath(`/campaigns/${campaignId}/contacts`);
}

/** Remove one individual (contact) from a campaign, deleting their thread too. */
export async function deleteConversation(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  if (!campaignId || !conversationId) return;

  const [convo] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (convo && convo.campaignId === campaignId) {
    // Deleting the contact cascades the conversation and its messages.
    await db.delete(contacts).where(eq(contacts.id, convo.contactId));
  }

  revalidatePath("/");
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/inbox`);
  // Land on the inbox (not the now-deleted thread, which would 404).
  redirect(`/campaigns/${campaignId}/inbox`);
}

export async function sendCampaignBatch(campaignId: string): Promise<void> {
  const limit = Number(process.env.BATCH_SIZE ?? "10");

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw new Error("Campaign not found");

  const window = isWithinSendWindow(campaign.sendWindowStart, campaign.sendWindowEnd);
  if (!window.ok) {
    console.warn(
      `[sendCampaignBatch ${campaignId}] outside send window (${campaign.sendWindowStart}–${campaign.sendWindowEnd}); next open ${window.openAt.toISOString()}`,
    );
    revalidatePath(`/campaigns/${campaignId}`);
    return;
  }

  const pending = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.campaignId, campaignId), eq(contacts.status, "pending"), eq(contacts.optedOut, false)))
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const contact of pending) {
    const body = renderTemplate(campaign.smsTemplate, contact);
    const missing = findUnmergedTokens(campaign.smsTemplate, contact);
    if (missing.length > 0) {
      await db
        .update(contacts)
        .set({ status: "failed", lastError: `missing merge fields: ${missing.join(", ")}` })
        .where(eq(contacts.id, contact.id));
      skipped++;
      continue;
    }

    await paceForNextSend();

    const result = await sendSms({ to: contact.phone, body, from: campaign.fromNumber ?? undefined });

    if (!result.ok) {
      await db
        .update(contacts)
        .set({ status: "failed", lastError: result.error })
        .where(eq(contacts.id, contact.id));
      failed++;
      continue;
    }

    const convo = await getOrCreateConversation(campaign.id, contact.id);
    await db.insert(messages).values({
      conversationId: convo.id,
      direction: "outbound",
      status: "sent",
      body,
      telnyxId: result.telnyxId,
    });
    await db.update(contacts).set({ status: "sent", lastError: null }).where(eq(contacts.id, contact.id));
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, convo.id));
    sent++;
  }

  await db.update(campaigns).set({ status: "active", updatedAt: new Date() }).where(eq(campaigns.id, campaignId));

  console.log(`[sendCampaignBatch ${campaignId}] sent=${sent} failed=${failed} skipped=${skipped}`);

  revalidatePath("/");
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/contacts`);
  revalidatePath(`/campaigns/${campaignId}/inbox`);
}

export async function startCampaignSend(campaignId: string): Promise<void> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw new Error("Campaign not found");

  await db.update(campaigns).set({ status: "active", updatedAt: new Date() }).where(eq(campaigns.id, campaignId));

  if (isQStashConfigured()) {
    // Kick off a self-continuing drain that sends every pending contact, paced.
    await enqueueCampaignDrain(campaignId, 1);
  } else {
    // No scheduler configured — fall back to one synchronous batch.
    await sendCampaignBatch(campaignId);
    return;
  }

  revalidatePath("/");
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/contacts`);
}

async function getOrCreateConversation(campaignId: string, contactId: string) {
  const existing = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.campaignId, campaignId), eq(conversations.contactId, contactId)))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(conversations)
    .values({ campaignId, contactId })
    .returning();
  return created;
}

export async function recordInbound(args: {
  fromPhone: string;
  body: string;
  telnyxId?: string | null;
}): Promise<{ matched: boolean; conversationId?: string }> {
  const e164 = normalizePhone(args.fromPhone);
  if (!e164) {
    console.warn(`[recordInbound] Could not normalize phone: ${args.fromPhone}`);
    return { matched: false };
  }

  const matches = await db
    .select({ contact: contacts, campaign: campaigns })
    .from(contacts)
    .innerJoin(campaigns, eq(campaigns.id, contacts.campaignId))
    .where(eq(contacts.phone, e164))
    .orderBy(desc(contacts.createdAt))
    .limit(1);

  if (matches.length === 0) {
    console.warn(`[recordInbound] No contact found for ${e164}`);
    return { matched: false };
  }

  const { contact, campaign } = matches[0];
  const convo = await getOrCreateConversation(campaign.id, contact.id);

  if (isStopKeyword(args.body)) {
    await db
      .insert(messages)
      .values({
        conversationId: convo.id,
        direction: "inbound",
        status: "received",
        body: args.body,
        telnyxId: args.telnyxId ?? null,
        classification: "stop",
      });
    await db
      .update(contacts)
      .set({ optedOut: true, status: "opted_out" })
      .where(eq(contacts.id, contact.id));
    await db
      .update(conversations)
      .set({
        status: "opted_out",
        classification: "stop",
        lastMessageAt: new Date(),
        unreadCount: sql`${conversations.unreadCount}::int + 1` as unknown as string,
      })
      .where(eq(conversations.id, convo.id));
    revalidatePath("/");
    revalidatePath(`/campaigns/${campaign.id}/inbox`);
    return { matched: true, conversationId: convo.id };
  }

  const [inserted] = await db
    .insert(messages)
    .values({
      conversationId: convo.id,
      direction: "inbound",
      status: "received",
      body: args.body,
      telnyxId: args.telnyxId ?? null,
    })
    .returning();

  await db
    .update(contacts)
    .set({ status: "replied" })
    .where(and(eq(contacts.id, contact.id), eq(contacts.optedOut, false)));

  await db
    .update(conversations)
    .set({
      status: "needs_attention",
      lastMessageAt: new Date(),
      unreadCount: sql`${conversations.unreadCount}::int + 1` as unknown as string,
    })
    .where(eq(conversations.id, convo.id));

  // If the candidate replied with an email address, auto-send the full position
  // details (subject = role title, body = position summary) from the configured
  // mailbox — once per contact.
  await maybeSendPositionEmail({
    campaign,
    contact,
    conversationId: convo.id,
    inboundBody: args.body,
  }).catch((err) => {
    console.error("[recordInbound] position email failed:", err);
  });

  // Await classification: on serverless (Vercel), fire-and-forget async work is
  // killed the moment the response is sent, so we must finish it inline.
  await classifyInboundSilent({
    campaign,
    contact,
    conversationId: convo.id,
    messageId: inserted.id,
    inboundBody: args.body,
    humanTakeover: convo.humanTakeover,
  }).catch((err) => {
    console.error("[recordInbound] classify failed:", err);
  });

  revalidatePath("/");
  revalidatePath(`/campaigns/${campaign.id}/inbox`);
  return { matched: true, conversationId: convo.id };
}

async function maybeSendPositionEmail(args: {
  campaign: Campaign;
  contact: Contact;
  conversationId: string;
  inboundBody: string;
}): Promise<void> {
  const { campaign, contact, conversationId, inboundBody } = args;

  if (!isPositionEmailConfigured()) return; // mailbox not set up yet
  if (contact.optedOut) return;
  if (contact.positionEmailSentAt) return; // already emailed this person
  if (!campaign.positionSummary?.trim()) return; // nothing to send

  const email = extractEmail(inboundBody);
  if (!email) return; // candidate didn't share an email this time

  const { subject, text, html } = buildPositionEmail(campaign, contact);
  const result = await sendPositionEmail({ to: email, subject, text, html });

  if (!result.ok) {
    console.error(`[position-email] send failed to ${email}: ${result.error}`);
    return;
  }

  // Mark as sent and capture the candidate's email on the contact.
  await db
    .update(contacts)
    .set({ positionEmailSentAt: new Date(), email })
    .where(eq(contacts.id, contact.id));

  // Drop a visible note into the thread so the recruiter sees the email went out.
  await db.insert(messages).values({
    conversationId,
    direction: "outbound",
    status: "sent",
    body: `📧 Emailed the position details to ${email}\nSubject: ${subject}`,
  });

  console.log(`[position-email] sent "${subject}" to ${email} for contact ${contact.id}`);
}

async function classifyInboundSilent(args: {
  campaign: Campaign;
  contact: Contact;
  conversationId: string;
  messageId: string;
  inboundBody: string;
  humanTakeover?: boolean;
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[classify] ANTHROPIC_API_KEY not set; skipping classification");
    return;
  }

  const history = await db
    .select({ direction: messages.direction, body: messages.body })
    .from(messages)
    .where(eq(messages.conversationId, args.conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(8);

  const ordered = history.reverse().map((h) => ({ direction: h.direction, body: h.body }));

  const classification = await classifyReply({
    campaign: args.campaign,
    inboundBody: args.inboundBody,
    recentHistory: ordered,
  });

  await db
    .update(messages)
    .set({ classification: classification.label })
    .where(eq(messages.id, args.messageId));

  await db
    .update(conversations)
    .set({ classification: classification.label })
    .where(eq(conversations.id, args.conversationId));

  // Route the conversation by sentiment so the inbox tabs stay meaningful:
  // STOP-intent -> opted out; clearly negative -> closed; otherwise it stays
  // "needs attention" (set on inbound) until Ryan opens it.
  const bucket = sentimentOf(classification.label);
  if (classification.label === "stop") {
    await db.update(contacts).set({ optedOut: true, status: "opted_out" }).where(eq(contacts.id, args.contact.id));
    await db.update(conversations).set({ status: "opted_out" }).where(eq(conversations.id, args.conversationId));
  } else if (bucket === "negative") {
    await db.update(conversations).set({ status: "closed" }).where(eq(conversations.id, args.conversationId));
  } else if (!args.contact.optedOut) {
    // Interested / neutral / unknown — surface the recruiter's open follow-ups
    // on the To-dos tab (new emailed address, comp question, schedule, etc.).
    await syncTodosForConversation({
      campaign: args.campaign,
      contact: args.contact,
      conversationId: args.conversationId,
    }).catch((err) => console.error("[todos] sync failed:", err));

    // Score their fit for the role (once) so it shows on To-dos + inbox.
    if (args.contact.qualificationScore == null) {
      const sc = await scoreCandidate({
        campaign: args.campaign,
        contact: args.contact,
        recentHistory: ordered,
      }).catch(() => null);
      if (sc) {
        await db
          .update(contacts)
          .set({ qualificationScore: sc.score, qualificationReason: sc.reason })
          .where(eq(contacts.id, args.contact.id));
      }
    }
  }

  if (
    args.campaign.llmMode === "semi_auto" &&
    !args.humanTakeover &&
    isAutoSendCandidate(classification) &&
    !isAutoIgnoreNegative(classification.label) &&
    !args.contact.optedOut
  ) {
    try {
      const draft = await draftReply({
        campaign: args.campaign,
        contact: args.contact,
        classification: classification.label,
        inboundBody: args.inboundBody,
        recentHistory: ordered,
      });

      // Keep the draft visible on the inbound message regardless of how it's sent.
      await db.update(messages).set({ draftReply: draft }).where(eq(messages.id, args.messageId));

      const [stats] = await db
        .select({
          outboundCount: sql<number>`count(*) filter (where ${messages.direction} = 'outbound')::int`,
        })
        .from(messages)
        .where(eq(messages.conversationId, args.conversationId));
      const isFirstResponse = (stats?.outboundCount ?? 0) <= 1;

      if (isQStashConfigured()) {
        // Human-like delay: schedule the send for 3-5 min (first reply) / 2-6 min (after).
        const delay = replyDelaySeconds(isFirstResponse);
        await scheduleReply({ conversationId: args.conversationId, body: draft, delaySeconds: delay });
        console.log(
          `[semi_auto] scheduled auto-reply in ${delay}s (firstResponse=${isFirstResponse}) for convo ${args.conversationId}`,
        );
      } else {
        // No scheduler configured — send immediately (no human-like delay).
        await paceForNextSend();
        const send = await sendSms({
          to: args.contact.phone,
          body: draft,
          from: args.campaign.fromNumber ?? undefined,
        });
        if (send.ok) {
          await db.insert(messages).values({
            conversationId: args.conversationId,
            direction: "outbound",
            status: "sent",
            body: draft,
            telnyxId: send.telnyxId,
          });
          // Keep the thread flagged for the recruiter even after the AI replies —
          // it leaves "Needs attention" only when they open it themselves.
          await db
            .update(conversations)
            .set({ lastMessageAt: new Date() })
            .where(eq(conversations.id, args.conversationId));
        }
      }
    } catch (err) {
      console.error("[classify] semi_auto draft/schedule failed:", err);
    }
  }

  revalidatePath(`/campaigns/${args.campaign.id}/inbox`);
  revalidatePath(`/campaigns/${args.campaign.id}/inbox/${args.conversationId}`);
}

export async function generateDraftForMessage(
  campaignId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!campaign || !convo) throw new Error("Campaign or conversation not found");
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, convo.contactId));
  if (!contact) throw new Error("Contact not found");

  const [target] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!target) throw new Error("Message not found");

  const history = await db
    .select({ direction: messages.direction, body: messages.body })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(8);

  const draft = await draftReply({
    campaign,
    contact,
    classification: target.classification ?? "other",
    inboundBody: target.body,
    recentHistory: history.reverse().map((h) => ({ direction: h.direction, body: h.body })),
  });

  await db.update(messages).set({ draftReply: draft }).where(eq(messages.id, messageId));
  revalidatePath(`/campaigns/${campaignId}/inbox/${conversationId}`);
}

export async function sendManualReply(
  campaignId: string,
  conversationId: string,
  formData: FormData,
) {
  const body = str(formData, "body");
  if (!body) throw new Error("Reply body is required");

  const [convo] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!convo) throw new Error("Conversation not found");
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, convo.contactId));
  if (!contact) throw new Error("Contact not found");
  if (contact.optedOut) throw new Error("Contact has opted out");
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));

  await paceForNextSend();

  const result = await sendSms({
    to: contact.phone,
    body,
    from: campaign?.fromNumber ?? undefined,
  });

  if (!result.ok) {
    throw new Error(`Telnyx send failed: ${result.error}`);
  }

  await db.insert(messages).values({
    conversationId,
    direction: "outbound",
    status: "sent",
    body,
    telnyxId: result.telnyxId,
  });
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date(), status: "active", unreadCount: "0", humanTakeover: true })
    .where(eq(conversations.id, conversationId));

  revalidatePath(`/campaigns/${campaignId}/inbox/${conversationId}`);
  revalidatePath(`/campaigns/${campaignId}/inbox`);
}

export async function markConversationRead(conversationId: string) {
  // Reset the unread badge, and clear the "needs attention" flag now that the
  // recruiter has personally opened the thread. (The AI auto-replying never
  // clears it — only this does.) Terminal states (opted_out/closed) are left as-is.
  await db.update(conversations).set({ unreadCount: "0" }).where(eq(conversations.id, conversationId));
  await db
    .update(conversations)
    .set({ status: "active" })
    .where(and(eq(conversations.id, conversationId), eq(conversations.status, "needs_attention")));
}

export async function closeConversation(campaignId: string, conversationId: string) {
  await db.update(conversations).set({ status: "closed" }).where(eq(conversations.id, conversationId));
  revalidatePath(`/campaigns/${campaignId}/inbox`);
}

export async function reopenConversation(campaignId: string, conversationId: string) {
  await db.update(conversations).set({ status: "active" }).where(eq(conversations.id, conversationId));
  revalidatePath(`/campaigns/${campaignId}/inbox`);
}

// ---- To-dos (manual follow-up actions) ----

export async function completeTodo(id: string) {
  await db.update(todos).set({ status: "done", doneAt: new Date() }).where(eq(todos.id, id));
  revalidatePath("/todos");
}

export async function reopenTodo(id: string) {
  await db.update(todos).set({ status: "open", doneAt: null }).where(eq(todos.id, id));
  revalidatePath("/todos");
}

export async function deleteTodo(id: string) {
  await db.delete(todos).where(eq(todos.id, id));
  revalidatePath("/todos");
}

/** Delete a candidate's entire correspondence (thread, messages, to-dos) from the To-dos tab. */
export async function deleteCorrespondence(contactId: string) {
  // Deleting the contact cascades its conversation, messages, and to-dos.
  await db.delete(contacts).where(eq(contacts.id, contactId));
  revalidatePath("/todos");
  revalidatePath("/");
}

/** Toggle the "I've reviewed this candidate" checkmark on the To-dos tab. */
export async function toggleCandidateReviewed(contactId: string) {
  const [c] = await db
    .select({ reviewedAt: contacts.todosReviewedAt })
    .from(contacts)
    .where(eq(contacts.id, contactId));
  await db
    .update(contacts)
    .set({ todosReviewedAt: c?.reviewedAt ? null : new Date() })
    .where(eq(contacts.id, contactId));
  revalidatePath("/todos");
}

export async function addManualTodo(formData: FormData) {
  const action = str(formData, "action");
  const channel = (str(formData, "channel") ?? "other") as TodoChannel;
  const campaignId = str(formData, "campaignId");
  const contactId = str(formData, "contactId");
  const conversationId = str(formData, "conversationId");
  if (!action || !campaignId || !contactId) throw new Error("action, campaignId, contactId are required");
  await db.insert(todos).values({
    campaignId,
    contactId,
    conversationId: conversationId ?? null,
    action,
    channel,
    source: "manual",
  });
  revalidatePath("/todos");
}

export async function simulateInbound(campaignId: string, formData: FormData) {
  const fromPhone = str(formData, "fromPhone");
  const body = str(formData, "body");
  if (!fromPhone || !body) throw new Error("fromPhone and body are required");
  await recordInbound({ fromPhone, body });
  revalidatePath(`/campaigns/${campaignId}/inbox`);
}

export async function ackContactFailure(campaignId: string, contactId: string) {
  await db
    .update(contacts)
    .set({ status: "pending", lastError: null })
    .where(and(eq(contacts.id, contactId), eq(contacts.campaignId, campaignId)));
  revalidatePath(`/campaigns/${campaignId}/contacts`);
}
