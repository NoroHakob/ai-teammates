import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"

import { Chat } from "@/components/chat"
import { ChatHeader } from "@/components/chat-header"
import { DesktopPanel, DesktopPanelProvider } from "@/components/desktop-panel"
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { getBots } from "@/queries/bots"
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

  // Several bots share a group chat, so there is no single desktop to show
  if (chat.kind === "group") {
    // All of the user's bots: the edit dialog can add any of them, and past
    // replies from bots that left the group still show who wrote them
    const allBots = await getBots()
    return (
      <div className="flex h-svh flex-col">
        <ChatHeader chat={chat} bots={allBots} />
        <Chat
          key={chat.id}
          chatId={chat.id}
          bots={chat.bots.map(({ id, name, avatar }) => ({ id, name, avatar }))}
          knownBots={allBots.map(({ id, name, avatar }) => ({
            id,
            name,
            avatar,
          }))}
          initialMessages={messages}
        />
      </div>
    )
  }

  return (
    <DesktopPanelProvider key={chat.id} chatId={chat.id}>
      <div className="h-svh">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel id="chat" minSize="30%">
            <div className="flex h-full flex-col">
              <ChatHeader chat={chat} />
              <Chat key={chat.id} chatId={chat.id} initialMessages={messages} />
            </div>
          </ResizablePanel>
          <DesktopPanel name={chat.bots[0].name} />
        </ResizablePanelGroup>
      </div>
    </DesktopPanelProvider>
  )
}
