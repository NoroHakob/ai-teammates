import type { UIMessage } from "ai"
import { asc, eq } from "drizzle-orm"

import { db } from "@/db"
import { messages } from "@/db/schema"
import { getChat } from "@/queries/chats"

// The stored messages of one of the signed-in user's chats, oldest first, or null if it isn't theirs
export async function getMessages(chatId: string): Promise<UIMessage[] | null> {
  const chat = await getChat(chatId)
  if (!chat) {
    return null
  }

  const rows = await db
    .select({ id: messages.id, role: messages.role, parts: messages.parts })
    .from(messages)
    .where(eq(messages.chatId, chat.id))
    .orderBy(asc(messages.createdAt))

  return rows.map(({ id, role, parts }) => ({ id, role, parts }))
}
