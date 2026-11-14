import { auth } from "@clerk/nextjs/server"
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai"

import { chatModel } from "@/lib/ai"
import { getChat } from "@/queries/chats"

export async function POST(req: Request) {
  const { isAuthenticated } = await auth()
  if (!isAuthenticated) {
    return new Response("Unauthorized", { status: 401 })
  }

  // useChat's default transport sends { id, messages, trigger, messageId }
  let body: { id?: unknown; messages?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response("Bad request", { status: 400 })
  }

  const { id, messages } = body
  if (typeof id !== "string" || !Array.isArray(messages)) {
    return new Response("Bad request", { status: 400 })
  }

  // getChat is scoped to the signed-in user, so someone else's chat is a 404
  const chat = await getChat(id)
  if (!chat) {
    return new Response("Not found", { status: 404 })
  }

  const { bot } = chat
  const system = [
    `You are ${bot.name}. Your job: ${bot.job}.`,
    bot.instructions && `How you should work: ${bot.instructions}`,
  ]
    .filter(Boolean)
    .join("\n\n")

  const result = streamText({
    model: chatModel,
    system,
    messages: await convertToModelMessages(messages as UIMessage[]),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}
