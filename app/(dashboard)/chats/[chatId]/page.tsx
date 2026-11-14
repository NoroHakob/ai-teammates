import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"

import { Chat } from "@/components/chat"
import { ChatHeader } from "@/components/chat-header"
import { getChat } from "@/queries/chats"
import { getMessages } from "@/queries/messages"

export default async function ChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>
}) {
  await auth.protect()

  const { chatId } = await params
  const chat = await getChat(chatId)
  if (!chat) notFound()

  const messages = await getMessages(chat.id)
  if (!messages) notFound()

  return (
    <div className="flex h-svh flex-col">
      <ChatHeader chat={chat} />
      <Chat key={chat.id} chatId={chat.id} initialMessages={messages} />
    </div>
  )
}
