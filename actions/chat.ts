"use server"

import { auth } from "@clerk/nextjs/server"
import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import {
  bots,
  chatMembers,
  chats,
  groupChatInsertSchema,
  type GroupChatInsert,
} from "@/db/schema"
import { getBotDesktopUrl } from "@/lib/daytona"
import { getChat } from "@/queries/chats"

export async function createGroupChat(values: GroupChatInsert) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Not authenticated")
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

  revalidatePath("/", "layout")

  return chat
}

// The websocket URL of the desktop of the bot behind one of the signed-in user's direct chats
export async function getDesktopUrl(chatId: string) {
  // getChat checks the session and only returns the user's own chats
  const chat = await getChat(chatId)
  // Group chats have several bots, so no single desktop
  if (!chat || chat.kind === "group") {
    throw new Error("Chat not found")
  }

  return getBotDesktopUrl(chat.bots[0].id)
}
