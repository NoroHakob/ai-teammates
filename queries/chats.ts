import { auth } from "@clerk/nextjs/server"
import { and, asc, eq } from "drizzle-orm"

import { db } from "@/db"
import { chatMembers, chats } from "@/db/schema"

// One of the signed-in user's chats with all of its bots, or null if it isn't theirs
export async function getChat(chatId: string) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, chatId), eq(chats.userId, userId)),
    with: {
      members: {
        orderBy: [asc(chatMembers.joinedAt), asc(chatMembers.botId)],
        with: { bot: true },
      },
    },
  })

  if (!chat || chat.members.length === 0) {
    return null
  }

  const { members, ...rest } = chat
  return { ...rest, bots: members.map((member) => member.bot) }
}
