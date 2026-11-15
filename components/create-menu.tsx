"use client"

import { useState } from "react"
import { PlusIcon, UsersIcon } from "lucide-react"

import { BotDialog } from "@/components/bot-dialog"
import { GroupChatDialog } from "@/components/group-chat-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Bot } from "@/db/schema"
import { usePaywall } from "@/hooks/use-paywall"

export function CreateMenu({ bots }: { bots: Bot[] }) {
  const [botDialogOpen, setBotDialogOpen] = useState(false)
  const [groupChatDialogOpen, setGroupChatDialogOpen] = useState(false)
  const { check } = usePaywall()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label="Create" />}
        >
          <PlusIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
                // A new bot comes with a sandbox, so it needs both
                if (check("bots") && check("sandboxes")) setBotDialogOpen(true)
              }}
            >
              <PlusIcon />
              Create new bot
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (check("bots")) setGroupChatDialogOpen(true)
              }}
            >
              <UsersIcon />
              Create group chat
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <BotDialog open={botDialogOpen} onOpenChange={setBotDialogOpen} />
      <GroupChatDialog
        bots={bots}
        open={groupChatDialogOpen}
        onOpenChange={setGroupChatDialogOpen}
      />
    </>
  )
}
