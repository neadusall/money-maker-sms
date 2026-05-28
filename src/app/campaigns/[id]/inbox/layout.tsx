import { notFound } from "next/navigation";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, contacts, conversations, messages } from "@/db/schema";
import { ConversationList, type ConversationListItem } from "@/components/ConversationList";

export const dynamic = "force-dynamic";

export default async function InboxLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) notFound();

  const lastMessagesSubquery = db
    .select({
      conversationId: messages.conversationId,
      body: messages.body,
      direction: messages.direction,
      createdAt: messages.createdAt,
      rn: sql<number>`row_number() over (partition by ${messages.conversationId} order by ${messages.createdAt} desc)`.as("rn"),
    })
    .from(messages)
    .as("lm");

  const rows = await db
    .select({
      id: conversations.id,
      status: conversations.status,
      classification: conversations.classification,
      lastMessageAt: conversations.lastMessageAt,
      unreadCount: conversations.unreadCount,
      contact: contacts,
      lastMessageBody: lastMessagesSubquery.body,
      lastMessageDirection: lastMessagesSubquery.direction,
    })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(
      lastMessagesSubquery,
      sql`${lastMessagesSubquery.conversationId} = ${conversations.id} and ${lastMessagesSubquery.rn} = 1`,
    )
    // Show EVERY thread in this campaign — including the ones you've texted that
    // haven't replied yet — so "All" reflects all outbound communication, not
    // just repliers. Archived (soft-deleted) contacts are hidden here and live in
    // the campaign's Archived view. The filter chips narrow further.
    .where(and(eq(conversations.campaignId, id), isNull(contacts.deletedAt)))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(5000);

  const list: ConversationListItem[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    classification: r.classification,
    score: r.contact.qualificationScore,
    scoreReason: r.contact.qualificationReason,
    lastMessageAt: r.lastMessageAt.toISOString(),
    unreadCount: Number(r.unreadCount),
    contact: {
      id: r.contact.id,
      firstName: r.contact.firstName,
      lastName: r.contact.lastName,
      phone: r.contact.phone,
      company: r.contact.company,
      jobTitle: r.contact.jobTitle,
      linkedinUrl: r.contact.linkedinUrl,
    },
    lastMessage: r.lastMessageBody
      ? { direction: r.lastMessageDirection ?? "outbound", body: r.lastMessageBody }
      : null,
  }));

  return (
    <div className="-mx-6 -my-8 flex h-[calc(100vh-57px)] overflow-hidden">
      <ConversationList
        campaignId={id}
        campaignName={campaign.name}
        conversations={list}
      />
      <section className="flex min-w-0 flex-1 flex-col">{children}</section>
    </div>
  );
}
