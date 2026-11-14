import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"

import { Chat } from "@/components/chat"
import { ChatHeader } from "@/components/chat-header"
import { DesktopPanel, DesktopPanelProvider } from "@/components/desktop-panel"
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import type { ChatUIMessage } from "@/lib/sandbox-tools"
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
    <DesktopPanelProvider key={chat.id} chatId={chat.id}>
      <div className="h-svh">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel id="chat" minSize="30%">
            <div className="flex h-full flex-col">
              <ChatHeader chat={chat} />
              <Chat
                key={chat.id}
                chatId={chat.id}
                initialMessages={
                  // Assistant parts are only ever written by the chat route, with these tools
                  messages as ChatUIMessage[]
                }
              />
            </div>
          </ResizablePanel>
          <DesktopPanel name={chat.bot.name} />
        </ResizablePanelGroup>
      </div>
    </DesktopPanelProvider>
  )
}
