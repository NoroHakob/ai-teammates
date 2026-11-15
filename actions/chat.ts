"use server"

import { auth } from "@clerk/nextjs/server"
import { and, eq, inArray, notInArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import {
  bots,
  chatMembers,
  chats,
  groupChatInsertSchema,
  messages,
  type GroupChatInsert,
} from "@/db/schema"
import { hasFeature, UPGRADE_REQUIRED } from "@/lib/billing"
import { getBotDesktopUrl } from "@/lib/daytona"
import { events, identifyUser } from "@/lib/log"
import { memberEventMessage } from "@/lib/member-events"
import { getUsage, USAGE_LIMIT_ERROR } from "@/lib/usage"
import { getChat } from "@/queries/chats"

export async function createGroupChat(values: GroupChatInsert) {
  const { isAuthenticated, userId, has } = await auth()
  if (!isAuthenticated) {
    throw new Error("Not authenticated")
  }
  identifyUser(userId)
  if (!hasFeature(has, "bots")) {
    events.paywallHit("bots", "createGroupChat")
    throw new Error(UPGRADE_REQUIRED)
  }

  const data = groupChatInsertSchema.parse(values)
  const botIds = [...new Set(data.botIds)]

  // Every member must be one of the user's own bots
  const owned = await db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.userId, userId), inArray(bots.id, botIds)))
  if (owned.length !== botIds.length) {
    throw new Error("Bot not found")
  }

  // The chat and its members, all or none
  const chat = await db.transaction(async (tx) => {
    const [chat] = await tx
      .insert(chats)
      .values({ userId, kind: "group", name: data.name })
      .returning()

    await tx
      .insert(chatMembers)
      .values(botIds.map((botId) => ({ chatId: chat.id, botId })))

    return chat
  })

  events.groupChatCreated(chat.id, botIds.length)
  revalidatePath("/", "layout")

  return chat
}

export async function updateGroupChat(chatId: string, values: GroupChatInsert) {
  const { isAuthenticated, userId, has } = await auth()
  if (!isAuthenticated) {
    throw new Error("Not authenticated")
  }
  identifyUser(userId)
  if (!hasFeature(has, "bots")) {
    events.paywallHit("bots", "updateGroupChat")
    throw new Error(UPGRADE_REQUIRED)
  }

  const data = groupChatInsertSchema.parse(values)
  const botIds = [...new Set(data.botIds)]

  // Every member must be one of the user's own bots
  const owned = await db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.userId, userId), inArray(bots.id, botIds)))
  if (owned.length !== botIds.length) {
    throw new Error("Bot not found")
  }

  // The name and the members, all or none
  const updated = await db.transaction(async (tx) => {
    // Also the ownership check: someone else's chat, or a direct chat, updates nothing
    const [chat] = await tx
      .update(chats)
      .set({ name: data.name })
      .where(
        and(
          eq(chats.id, chatId),
          eq(chats.userId, userId),
          eq(chats.kind, "group")
        )
      )
      .returning()
    if (!chat) {
      throw new Error("Chat not found")
    }

    const removed = await tx
      .delete(chatMembers)
      .where(
        and(
          eq(chatMembers.chatId, chat.id),
          notInArray(chatMembers.botId, botIds)
        )
      )
      .returning({ botId: chatMembers.botId })

    // Bots that stay keep their row, and with it their place in the order;
    // only the ones really added come back
    const joined = await tx
      .insert(chatMembers)
      .values(botIds.map((botId) => ({ chatId: chat.id, botId })))
      .onConflictDoNothing()
      .returning({ botId: chatMembers.botId })

    // An event line for each change, named from the bots table
    const changed = [
      ...removed.map(({ botId }) => ({ botId, event: "removed" as const })),
      ...joined.map(({ botId }) => ({ botId, event: "joined" as const })),
    ]
    if (changed.length > 0) {
      const names = new Map(
        (
          await tx
            .select({ id: bots.id, name: bots.name })
            .from(bots)
            .where(
              and(
                eq(bots.userId, userId),
                inArray(
                  bots.id,
                  changed.map(({ botId }) => botId)
                )
              )
            )
        ).map((bot) => [bot.id, bot.name])
      )
      const eventLines = changed.flatMap(({ botId, event }) => {
        const name = names.get(botId)
        return name ? [memberEventMessage(chat.id, { botId, name, event })] : []
      })
      if (eventLines.length > 0) {
        await tx.insert(messages).values(eventLines)
      }
    }

    return { chat, joined: joined.length, removed: removed.length }
  })

  events.groupChatUpdated(updated.chat.id, {
    memberCount: botIds.length,
    joined: updated.joined,
    removed: updated.removed,
  })
  revalidatePath("/", "layout")

  return updated.chat
}

// Members and messages go with the chat (cascade); the bots and their sandboxes stay
export async function deleteGroupChat(chatId: string) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Not authenticated")
  }
  identifyUser(userId)

  const [chat] = await db
    .delete(chats)
    .where(
      and(
        eq(chats.id, chatId),
        eq(chats.userId, userId),
        eq(chats.kind, "group")
      )
    )
    .returning({ id: chats.id })
  if (!chat) {
    throw new Error("Chat not found")
  }

  events.groupChatDeleted(chat.id)
  revalidatePath("/", "layout")
}

// The websocket URL of the desktop of the bot behind one of the signed-in user's direct chats
export async function getDesktopUrl(chatId: string) {
  const { isAuthenticated, userId, has } = await auth()
  if (!isAuthenticated) {
    throw new Error("Not authenticated")
  }
  identifyUser(userId)
  if (!hasFeature(has, "sandboxes")) {
    events.paywallHit("sandboxes", "getDesktopUrl")
    throw new Error(UPGRADE_REQUIRED)
  }
  // The desktop runs the sandbox, so it needs sandbox time left
  const usage = await getUsage(userId)
  if (!usage || usage.remaining.sandbox <= 0) {
    events.usageLimitHit("sandbox", "getDesktopUrl")
    throw new Error(USAGE_LIMIT_ERROR)
  }

  // getChat only returns the user's own chats
  const chat = await getChat(chatId)
  // Group chats have several bots, so no single desktop
  if (!chat || chat.kind === "group") {
    throw new Error("Chat not found")
  }

  return getBotDesktopUrl(chat.bots[0].id)
}
