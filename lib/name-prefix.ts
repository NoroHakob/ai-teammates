import type { ChatUIMessage } from "@/lib/sandbox-tools"

type ChatPart = ChatUIMessage["parts"][number]

// "[Name] " at the start of a group reply: the model copies it from the
// history, where it marks who wrote each stretch, sometimes with the wrong name
const NAME_PREFIX = /^\s*\[[^\]\n]{1,60}\]\s*/
// A prefix still being streamed, its closing bracket not here yet
const OPEN_NAME_PREFIX = /^\s*\[[^\]\n]{0,60}$/

// Group replies only: the first text of each author's stretch (at the start
// and after each completed handoff) loses a leading "[Name] "
export function withoutNamePrefixes(parts: ChatPart[]): ChatPart[] {
  let atStart = true
  return parts.map((part) => {
    if (part.type === "tool-handoff" && part.state === "output-available") {
      atStart = true
      return part
    }
    if (part.type !== "text" || !atStart || part.text.trim() === "") {
      return part
    }
    if (part.state === "streaming" && OPEN_NAME_PREFIX.test(part.text)) {
      // Hide it until it is complete, so it doesn't flash
      return { ...part, text: "" }
    }
    atStart = false
    return { ...part, text: part.text.replace(NAME_PREFIX, "") }
  })
}
