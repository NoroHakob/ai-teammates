import { auth } from "@clerk/nextjs/server"
import { asc, desc, eq } from "drizzle-orm"

import { db } from "@/db"
import { bots, chatMembers, chats } from "@/db/schema"

// The signed-in user's bots, oldest first
export async function getBots() {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  return db.query.bots.findMany({
    where: eq(bots.userId, userId),
    orderBy: [asc(bots.createdAt), asc(bots.id)],
  })
}

// The signed-in user's chats, most recent first, each with all of its bots
export async function getChats() {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  const rows = await db.query.chats.findMany({
    where: eq(chats.userId, userId),
    orderBy: desc(chats.lastMessageAt),
    with: {
      members: {
        orderBy: [asc(chatMembers.joinedAt), asc(chatMembers.botId)],
        with: { bot: true },
      },
    },
  })

  // A chat whose bots are all gone has nothing to show
  return rows.flatMap(({ members, ...chat }) =>
    members.length > 0
      ? [{ ...chat, bots: members.map((member) => member.bot) }]
      : []
  )
}

export type ChatWithBots = Awaited<ReturnType<typeof getChats>>[number]
