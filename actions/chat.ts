"use server"

import { getBotDesktopUrl } from "@/lib/daytona"
import { getChat } from "@/queries/chats"

// The websocket URL of the desktop of the bot behind one of the signed-in user's chats
export async function getDesktopUrl(chatId: string) {
  // getChat checks the session and only returns the user's own chats
  const chat = await getChat(chatId)
  if (!chat) {
    throw new Error("Chat not found")
  }

  return getBotDesktopUrl(chat.bot.id)
}
