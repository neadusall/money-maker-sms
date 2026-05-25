import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  pgEnum,
  unique,
  index,
  integer,
  primaryKey,
} from "drizzle-orm/pg-core";

export const campaignStatus = pgEnum("campaign_status", [
  "draft",
  "active",
  "paused",
  "completed",
]);

export const llmMode = pgEnum("llm_mode", [
  "draft_only",
  "semi_auto",
  "manual",
]);

export const contactStatus = pgEnum("contact_status", [
  "pending",
  "validating",
  "queued",
  "sent",
  "delivered",
  "failed",
  "replied",
  "opted_out",
]);

export const messageDirection = pgEnum("message_direction", [
  "outbound",
  "inbound",
]);

export const messageStatus = pgEnum("message_status", [
  "queued",
  "sending",
  "sent",
  "delivered",
  "failed",
  "received",
]);

export const conversationStatus = pgEnum("conversation_status", [
  "active",
  "needs_attention",
  "closed",
  "opted_out",
]);

export const scheduledMessageStatus = pgEnum("scheduled_message_status", [
  "pending",
  "sent",
  "canceled",
  "failed",
]);

export const todoChannel = pgEnum("todo_channel", [
  "sms",
  "email",
  "linkedin",
  "call",
  "other",
]);

export const todoStatus = pgEnum("todo_status", ["open", "done"]);

export const classificationLabel = pgEnum("classification_label", [
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
]);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: campaignStatus("status").default("draft").notNull(),
  llmMode: llmMode("llm_mode").default("draft_only").notNull(),

  smsTemplate: text("sms_template").notNull(),

  positionSummary: text("position_summary"),
  companySummary: text("company_summary"),
  industry: text("industry"),
  location: text("location"),
  workMode: text("work_mode"),
  compRange: text("comp_range"),
  requiredSkills: text("required_skills"),
  niceToHaveSkills: text("nice_to_have_skills"),
  clearance: text("clearance"),
  sellingPoints: text("selling_points"),
  calendarLink: text("calendar_link"),
  recruiterName: text("recruiter_name"),
  recruiterEmail: text("recruiter_email"),
  approvedLanguage: text("approved_language"),

  fromNumber: text("from_number"),

  sendWindowStart: text("send_window_start").default("09:00").notNull(),
  sendWindowEnd: text("send_window_end").default("19:00").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id, { onDelete: "cascade" })
      .notNull(),

    firstName: text("first_name"),
    lastName: text("last_name"),
    company: text("company"),
    jobTitle: text("job_title"),
    phone: text("phone").notNull(),
    email: text("email"),
    linkedinUrl: text("linkedin_url"),
    location: text("location"),

    customFields: jsonb("custom_fields").$type<Record<string, string>>().default({}).notNull(),

    status: contactStatus("status").default("pending").notNull(),
    optedOut: boolean("opted_out").default(false).notNull(),
    lastError: text("last_error"),

    // Set when the candidate replied with an email address and we auto-sent
    // them the position details. Prevents re-sending on subsequent replies.
    positionEmailSentAt: timestamp("position_email_sent_at", { withTimezone: true }),

    // Set when Ryan has reviewed this candidate's to-dos (the "I've read it"
    // checkmark on the To-dos tab). Null = not yet reviewed.
    todosReviewedAt: timestamp("todos_reviewed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    campaignPhoneIdx: unique("contacts_campaign_phone_unique").on(
      t.campaignId,
      t.phone,
    ),
    campaignStatusIdx: index("contacts_campaign_status_idx").on(
      t.campaignId,
      t.status,
    ),
  }),
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id, { onDelete: "cascade" })
      .notNull(),
    contactId: uuid("contact_id")
      .references(() => contacts.id, { onDelete: "cascade" })
      .notNull(),

    status: conversationStatus("status").default("active").notNull(),
    classification: classificationLabel("classification"),
    humanTakeover: boolean("human_takeover").default(false).notNull(),

    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    unreadCount: text("unread_count").default("0").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqContactCampaign: unique("conversations_campaign_contact_unique").on(
      t.campaignId,
      t.contactId,
    ),
    campaignLastMsgIdx: index("conversations_campaign_last_msg_idx").on(
      t.campaignId,
      t.lastMessageAt,
    ),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),

    direction: messageDirection("direction").notNull(),
    status: messageStatus("status").notNull(),
    body: text("body").notNull(),

    telnyxId: text("telnyx_id"),
    error: text("error"),

    classification: classificationLabel("classification"),
    draftReply: text("draft_reply"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    conversationIdx: index("messages_conversation_idx").on(
      t.conversationId,
      t.createdAt,
    ),
    telnyxIdIdx: index("messages_telnyx_id_idx").on(t.telnyxId),
  }),
);

export const scheduledMessages = pgTable(
  "scheduled_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    body: text("body").notNull(),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    status: scheduledMessageStatus("status").default("pending").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    dueIdx: index("scheduled_messages_due_idx").on(t.status, t.sendAt),
  }),
);

export const suppressedNumbers = pgTable(
  "suppressed_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id, { onDelete: "cascade" })
      .notNull(),
    phone: text("phone").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniq: unique("suppressed_campaign_phone_unique").on(t.campaignId, t.phone),
  }),
);

export const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id, { onDelete: "cascade" })
      .notNull(),
    contactId: uuid("contact_id")
      .references(() => contacts.id, { onDelete: "cascade" })
      .notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),

    // What Ryan needs to do, the channel it happens on, and optional context
    // (e.g. the candidate's email, the question they asked).
    action: text("action").notNull(),
    channel: todoChannel("channel").default("other").notNull(),
    detail: text("detail"),

    status: todoStatus("status").default("open").notNull(),
    source: text("source").default("ai").notNull(), // ai | manual

    // Stable key per (conversation, action-kind) so re-generation doesn't duplicate.
    dedupeKey: text("dedupe_key"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index("todos_status_idx").on(t.status, t.createdAt),
    uniqDedupe: unique("todos_conversation_dedupe_unique").on(t.conversationId, t.dedupeKey),
  }),
);

export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date", withTimezone: true }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  }),
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type ScheduledMessage = typeof scheduledMessages.$inferSelect;
export type SuppressedNumber = typeof suppressedNumbers.$inferSelect;
export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
export type TodoChannel = (typeof todoChannel.enumValues)[number];
export type ClassificationLabel = (typeof classificationLabel.enumValues)[number];
export type LlmMode = (typeof llmMode.enumValues)[number];
