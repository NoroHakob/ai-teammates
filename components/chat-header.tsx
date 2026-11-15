"use client"

import { MonitorIcon } from "lucide-react"

import { BotDialog } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"
import { useDesktopPanel } from "@/components/desktop-panel"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { Button } from "@/components/ui/button"
import type { ChatWithBots } from "@/queries/bots"

export function ChatHeader({ chat }: { chat: ChatWithBots }) {
  return chat.kind === "group" ? (
    <GroupChatHeader chat={chat} />
  ) : (
    <DirectChatHeader chat={chat} />
  )
}

// Several bots, so no single bot to edit and no single desktop to show
function GroupChatHeader({ chat }: { chat: ChatWithBots }) {
  return (
    <header
      data-slot="chat-header"
      className="flex h-12 shrink-0 items-center gap-2 border-b px-4"
    >
      <h1 className="flex min-w-0 items-center gap-2">
        <GroupChatAvatar
          seeds={chat.bots.map((bot) => bot.avatar)}
          className="size-6"
        />
        <span className="truncate text-sm font-medium">
          {chat.name ?? chat.bots[0].name}
        </span>
      </h1>
    </header>
  )
}

// Only rendered inside DesktopPanelProvider
function DirectChatHeader({ chat }: { chat: ChatWithBots }) {
  const { open, toggle } = useDesktopPanel()
  const bot = chat.bots[0]

  return (
    <header
      data-slot="chat-header"
      className="flex h-12 shrink-0 items-center gap-2 border-b px-4"
    >
      <h1 className="-ml-2 flex min-w-0">
        <BotDialog
          bot={bot}
          trigger={
            <Button variant="ghost" className="min-w-0 shrink gap-2 px-2" />
          }
        >
          <ChatAvatar seed={bot.avatar} className="size-6" />
          <span className="truncate">{chat.name ?? bot.name}</span>
        </BotDialog>
      </h1>
      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto"
        aria-label="Desktop"
        aria-pressed={open}
        onClick={toggle}
      >
        <MonitorIcon />
      </Button>
    </header>
  )
}
