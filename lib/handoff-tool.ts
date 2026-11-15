import { tool } from "ai"
import { z } from "zod"

const MAX_NOTE_LENGTH = 1000

// The teammate who takes over the request
export type Handoff = { botId: string; name: string }

// handoff: checks the id against the chat's members and switches the speaker,
// or throws with a message the model can act on
export function createHandoffTool(
  handoff: (botId: string) => Handoff | Promise<Handoff>
) {
  return tool({
    description:
      "Hand the person's request to another teammate in this group chat, when it belongs to their job rather than yours. They take over and answer in your place, so call this instead of answering.",
    inputSchema: z.object({
      botId: z.string().min(1).describe("id from the teammates list"),
      note: z
        .string()
        .trim()
        .min(1)
        .max(MAX_NOTE_LENGTH)
        .describe("What the teammate should do, a sentence or two"),
    }),
    execute: ({ botId }) => handoff(botId),
  })
}

export type HandoffTool = ReturnType<typeof createHandoffTool>
