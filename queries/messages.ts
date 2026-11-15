import { asc, eq } from "drizzle-orm"

import { db } from "@/db"
import { messages } from "@/db/schema"
import type { ChatUIMessage } from "@/lib/sandbox-tools"
import { getChat } from "@/queries/chats"

// The stored messages of one of the signed-in user's chats, oldest first, or null if it isn't theirs
export async function getMessages(
  chatId: string
): Promise<ChatUIMessage[] | null> {
  const chat = await getChat(chatId)
  if (!chat) {
    return null
  }

  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      parts: messages.parts,
      botId: messages.botId,
    })
    .from(messages)
    .where(eq(messages.chatId, chat.id))
    .orderBy(asc(messages.createdAt))

  // Assistant parts are only ever written by the chat route, with the sandbox tools;
  // system messages (member event lines) only by the chat and bot actions
  return rows.map(({ id, role, parts, botId }) => ({
    id,
    role,
    parts: parts as ChatUIMessage["parts"],
    ...(botId && { metadata: { botId } }),
  }))
}
