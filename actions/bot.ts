"use server"

import { auth } from "@clerk/nextjs/server"
import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import {
  botInsertSchema,
  bots,
  chatMembers,
  chats,
  messages,
  type BotInsert,
} from "@/db/schema"
import { hasFeature, UPGRADE_REQUIRED } from "@/lib/billing"
import { deleteSandbox } from "@/lib/daytona"
import { memberEventMessage } from "@/lib/member-events"
import { getUsage, USAGE_LIMIT_ERROR } from "@/lib/usage"

export async function createBot(values: BotInsert) {
  const { isAuthenticated, userId, has } = await auth()
  if (!isAuthenticated) {
    throw new Error("Not authenticated")
  }
  // A bot comes with its own sandbox, so it needs both; editing and deleting stay free
  if (!hasFeature(has, "bots") || !hasFeature(has, "sandboxes")) {
    throw new Error(UPGRADE_REQUIRED)
  }
  // A new bot is only useful with AI budget and sandbox time left to use it
  const usage = await getUsage(userId)
  if (!usage || usage.remaining.ai <= 0 || usage.remaining.sandbox <= 0) {
    throw new Error(USAGE_LIMIT_ERROR)
  }

  const data = botInsertSchema.parse(values)

  // A new bot always comes with its direct chat; all three rows or none
  const bot = await db.transaction(async (tx) => {
    const [bot] = await tx
      .insert(bots)
      .values({ ...data, instructions: data.instructions || null, userId })
      .returning()

    const [chat] = await tx
      .insert(chats)
      .values({ userId, kind: "direct" })
      .returning({ id: chats.id })

    await tx.insert(chatMembers).values({ chatId: chat.id, botId: bot.id })

    return bot
  })

  revalidatePath("/")

  return bot
}

export async function updateBot(botId: string, values: BotInsert) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Not authenticated")
  }

  const data = botInsertSchema.parse(values)

  const [bot] = await db
    .update(bots)
    .set({ ...data, instructions: data.instructions || null })
    .where(and(eq(bots.id, botId), eq(bots.userId, userId)))
    .returning()

  if (!bot) {
    throw new Error("Bot not found")
  }

  // The bot shows up in the sidebar and in every chat it fronts
  revalidatePath("/", "layout")

  return bot
}

export async function deleteBot(botId: string) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Not authenticated")
  }

  const [owned] = await db
    .select({ sandboxId: bots.sandboxId })
    .from(bots)
    .where(and(eq(bots.id, botId), eq(bots.userId, userId)))
  if (!owned) {
    throw new Error("Bot not found")
  }

  // Delete the sandbox first: if that fails the bot stays, so the delete can be retried
  if (owned.sandboxId) {
    await deleteSandbox(owned.sandboxId)
  }

  const deleted = await db.transaction(async (tx) => {
    // A direct chat is nothing without its bot; memberships go with the bot
    await tx
      .delete(chats)
      .where(
        and(
          eq(chats.userId, userId),
          eq(chats.kind, "direct"),
          inArray(
            chats.id,
            tx
              .select({ chatId: chatMembers.chatId })
              .from(chatMembers)
              .where(eq(chatMembers.botId, botId))
          )
        )
      )

    // Group chats keep going without the bot, so they get a line saying it was deleted.
    // Its botId turns null with the bot (on delete set null); the stored name stays.
    const [named] = await tx
      .select({ name: bots.name })
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, userId)))
    const groups = named
      ? await tx
          .select({ id: chats.id })
          .from(chats)
          .innerJoin(chatMembers, eq(chatMembers.chatId, chats.id))
          .where(
            and(
              eq(chats.userId, userId),
              eq(chats.kind, "group"),
              eq(chatMembers.botId, botId)
            )
          )
      : []
    if (named && groups.length > 0) {
      await tx.insert(messages).values(
        groups.map(({ id }) =>
          memberEventMessage(id, {
            botId,
            name: named.name,
            event: "deleted",
          })
        )
      )
    }

    const [bot] = await tx
      .delete(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, userId)))
      .returning({ id: bots.id, sandboxId: bots.sandboxId })

    if (!bot) {
      // Throwing rolls back the chat delete above
      throw new Error("Bot not found")
    }

    return bot
  })

  // A chat running meanwhile may have created a new sandbox; don't leave it behind
  if (deleted.sandboxId && deleted.sandboxId !== owned.sandboxId) {
    try {
      await deleteSandbox(deleted.sandboxId)
    } catch (error) {
      console.error(
        "Failed to delete sandbox",
        error instanceof Error ? error.name : typeof error
      )
    }
  }

  revalidatePath("/", "layout")
}
