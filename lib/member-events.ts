import { nanoid } from "nanoid"

import type { NewMessage } from "@/db/schema"
import type { MemberEvent } from "@/lib/sandbox-tools"

// The messages row for a member event line in a group chat. It doesn't touch
// the chat's last message, so the sidebar keeps showing the last real message.
export function memberEventMessage(
  chatId: string,
  data: MemberEvent
): NewMessage {
  return {
    id: nanoid(),
    chatId,
    role: "system",
    botId: data.botId,
    parts: [{ type: "data-member", data }],
  }
}
