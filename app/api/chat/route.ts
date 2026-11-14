import { auth } from "@clerk/nextjs/server"
import {
  APICallError,
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateId,
  streamText,
  toUIMessageStream,
  TypeValidationError,
  validateUIMessages,
  type UIMessage,
} from "ai"
import { eq } from "drizzle-orm"

import { db } from "@/db"
import { chats, messages } from "@/db/schema"
import { chatModel } from "@/lib/ai"
import { getChat } from "@/queries/chats"
import { getMessages } from "@/queries/messages"

const MAX_MESSAGE_LENGTH = 10000
const MAX_PREVIEW_LENGTH = 100

function textOf(parts: UIMessage["parts"]) {
  return parts.map((part) => (part.type === "text" ? part.text : "")).join(" ")
}

function previewOf(parts: UIMessage["parts"]) {
  const preview = textOf(parts)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PREVIEW_LENGTH)
  return preview || null
}

async function saveMessage(chatId: string, message: UIMessage) {
  if (message.role !== "user" && message.role !== "assistant") return

  await db
    .insert(messages)
    .values({
      id: message.id,
      chatId,
      role: message.role,
      parts: message.parts,
    })
    .onConflictDoNothing()

  await db
    .update(chats)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: previewOf(message.parts),
    })
    .where(eq(chats.id, chatId))
}

function hasText(parts: UIMessage["parts"]) {
  return parts.some((part) => part.type === "text" && part.text.trim() !== "")
}

// Errors from the database or the provider can carry message text, so only log what kind of error it was.
// For provider errors also log the status and OpenAI's error code/type, never the message or body.
function logError(context: string, error: unknown) {
  const cause =
    error instanceof Error && "lastError" in error ? error.lastError : error
  if (APICallError.isInstance(cause)) {
    const data = cause.data as
      { error?: { code?: unknown; type?: unknown } } | undefined
    console.error(context, cause.name, {
      statusCode: cause.statusCode,
      code: data?.error?.code,
      type: data?.error?.type,
    })
    return
  }
  console.error(context, error instanceof Error ? error.name : typeof error)
}

export async function POST(req: Request) {
  const { isAuthenticated } = await auth()
  if (!isAuthenticated) {
    return new Response("Unauthorized", { status: 401 })
  }

  // The transport sends only { id, message }: the chat ID and the new user message.
  // The history comes from the database, so the client can't rewrite it.
  let body: { id?: unknown; message?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response("Bad request", { status: 400 })
  }

  const { id, message } = body
  if (
    typeof id !== "string" ||
    typeof message !== "object" ||
    message === null ||
    !("id" in message) ||
    typeof message.id !== "string" ||
    !message.id ||
    !("role" in message) ||
    message.role !== "user" ||
    !("parts" in message) ||
    !Array.isArray(message.parts) ||
    message.parts.length === 0 ||
    // The UI only sends text; other parts (files, tool calls, data) aren't accepted from the client
    !message.parts.every(
      (part: unknown) =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
    )
  ) {
    return new Response("Bad request", { status: 400 })
  }

  const newMessage = message as UIMessage
  if (textOf(newMessage.parts).length > MAX_MESSAGE_LENGTH) {
    return new Response("Message too long", { status: 400 })
  }

  // getChat is scoped to the signed-in user, so someone else's chat is a 404
  const chat = await getChat(id)
  const previousMessages = chat && (await getMessages(chat.id))
  if (!chat || !previousMessages) {
    return new Response("Not found", { status: 404 })
  }

  // A retried send reuses the stored message instead of appending it twice
  const alreadyStored = previousMessages.some((m) => m.id === newMessage.id)

  let validatedMessages: UIMessage[]
  try {
    validatedMessages = await validateUIMessages({
      messages: alreadyStored
        ? previousMessages
        : [...previousMessages, newMessage],
    })
  } catch (error) {
    if (error instanceof TypeValidationError) {
      return new Response("Bad request", { status: 400 })
    }
    throw error
  }

  // Save the user message before replying, so it survives a failed reply
  try {
    await saveMessage(chat.id, validatedMessages.at(-1)!)
  } catch (error) {
    logError("Failed to save user message", error)
    return new Response("Internal server error", { status: 500 })
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
    // Past reasoning is optional for OpenAI and a reasoning item without its
    // following output is rejected, so the model only sees earlier text
    messages: await convertToModelMessages(
      validatedMessages.map((message) =>
        message.role === "assistant"
          ? {
              ...message,
              parts: message.parts.filter((part) => part.type !== "reasoning"),
            }
          : message
      )
    ),
    abortSignal: req.signal,
    // The default handler logs the whole error, which can include the request body
    onError: ({ error }) => logError("Chat stream failed", error),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: validatedMessages,
      generateMessageId: generateId,
      // Runs on success, error and abort; keep whatever text the bot managed to say
      onEnd: async ({ responseMessage, isAborted }) => {
        if (!hasText(responseMessage.parts)) return

        // A stopped reply's reasoning can be cut off, so keep only what it said
        const parts = isAborted
          ? responseMessage.parts.filter((part) => part.type !== "reasoning")
          : responseMessage.parts

        try {
          await saveMessage(chat.id, { ...responseMessage, parts })
        } catch (error) {
          logError("Failed to save assistant message", error)
        }
      },
    }),
  })
}
