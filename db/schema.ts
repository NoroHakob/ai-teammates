import { relations } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import type { UIMessage } from "ai"
import { createInsertSchema } from "drizzle-zod"
import { nanoid } from "nanoid"
import { z } from "zod"

export const bots = pgTable(
  "bots",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Clerk user ID
    userId: text().notNull(),
    name: text().notNull(),
    // Seed for the bot's face
    avatar: text()
      .notNull()
      .$defaultFn(() => nanoid()),
    // What the bot is for, in a phrase
    job: text().notNull(),
    // How it should go about the job
    instructions: text(),
    // Sandbox provider ID, created lazily
    sandboxId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("bots_user_id_idx").on(table.userId)]
)

export const chatKind = pgEnum("chat_kind", ["direct", "group"])

export const chats = pgTable(
  "chats",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Clerk user ID
    userId: text().notNull(),
    kind: chatKind().notNull().default("direct"),
    // Null for direct chats, which use the bot's name
    name: text(),
    lastMessagePreview: text(),
    lastMessageAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chats_user_id_idx").on(table.userId)]
)

export const chatMembers = pgTable(
  "chat_members",
  {
    chatId: text()
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    botId: text()
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.botId] }),
    index("chat_members_bot_id_idx").on(table.botId),
  ]
)

// system: an event line in a group chat (a bot joined, was removed or was deleted)
export const messageRole = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
])

export const messages = pgTable(
  "messages",
  {
    // The UI message ID
    id: text().primaryKey(),
    chatId: text()
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: messageRole().notNull(),
    // The bot that wrote an assistant message, that a user message was addressed to,
    // or that a system event is about
    botId: text().references(() => bots.id, { onDelete: "set null" }),
    // UIMessage parts
    parts: jsonb().$type<UIMessage["parts"]>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("messages_chat_id_created_at_idx").on(table.chatId, table.createdAt),
  ]
)

// ai: millionths of a dollar; sandbox: seconds of a running sandbox
export const usageKind = pgEnum("usage_kind", ["ai", "sandbox"])

// Append-only ledger of metered usage, summed per billing period
export const usageEntries = pgTable(
  "usage_entries",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Clerk user ID of the person who pays for it
    userId: text().notNull(),
    kind: usageKind().notNull(),
    amount: integer().notNull(),
    // The same usage recorded twice (a retry, a rerun cron) counts once
    idempotencyKey: text().notNull().unique(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("usage_entries_user_id_created_at_idx").on(
      table.userId,
      table.createdAt
    ),
  ]
)

export const botsRelations = relations(bots, ({ many }) => ({
  memberships: many(chatMembers),
  messages: many(messages),
}))

export const chatsRelations = relations(chats, ({ many }) => ({
  members: many(chatMembers),
  messages: many(messages),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, { fields: [messages.chatId], references: [chats.id] }),
  bot: one(bots, { fields: [messages.botId], references: [bots.id] }),
}))

export const chatMembersRelations = relations(chatMembers, ({ one }) => ({
  chat: one(chats, { fields: [chatMembers.chatId], references: [chats.id] }),
  bot: one(bots, { fields: [chatMembers.botId], references: [bots.id] }),
}))

export type Bot = typeof bots.$inferSelect
export type NewBot = typeof bots.$inferInsert

export type Chat = typeof chats.$inferSelect
export type NewChat = typeof chats.$inferInsert

export type ChatMember = typeof chatMembers.$inferSelect
export type NewChatMember = typeof chatMembers.$inferInsert

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert

export type UsageEntry = typeof usageEntries.$inferSelect
export type NewUsageEntry = typeof usageEntries.$inferInsert

export const botInsertSchema = createInsertSchema(bots, {
  name: (schema) =>
    schema
      .trim()
      .min(1, "Give your bot a name.")
      .max(50, "Keep it under 50 characters."),
  job: (schema) =>
    schema
      .trim()
      .min(1, "Tell your bot what its job is.")
      .max(100, "Keep it under 100 characters."),
  instructions: (schema) =>
    schema.trim().max(4000, "Keep it under 4000 characters."),
}).omit({ id: true, userId: true, sandboxId: true, createdAt: true })

export type BotInsert = z.infer<typeof botInsertSchema>

export const groupChatInsertSchema = createInsertSchema(chats, {
  // A schema rather than a callback: drizzle-zod would make a callback on this
  // nullable column nullable and optional, but a group always has a name
  name: z
    .string()
    .trim()
    .min(1, "Give the group a name.")
    .max(50, "Keep it under 50 characters."),
})
  .omit({
    id: true,
    userId: true,
    kind: true,
    lastMessagePreview: true,
    lastMessageAt: true,
    createdAt: true,
  })
  .extend({
    botIds: z.array(z.string()).min(2, "Pick at least two bots."),
  })

export type GroupChatInsert = z.infer<typeof groupChatInsertSchema>
