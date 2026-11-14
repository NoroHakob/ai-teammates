import { auth } from "@clerk/nextjs/server"
import {
  APICallError,
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
  toUIMessageStream,
  TypeValidationError,
  validateUIMessages,
  type ModelMessage,
  type UIMessage,
} from "ai"
import { eq } from "drizzle-orm"

import { db } from "@/db"
import { chats, messages } from "@/db/schema"
import { chatModel } from "@/lib/ai"
import { createSandboxTools, type ChatUIMessage } from "@/lib/sandbox-tools"
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

// A reply is worth keeping if it said something or did something
function isWorthSaving(parts: ChatUIMessage["parts"]) {
  return parts.some(
    (part) =>
      (part.type === "text" && part.text.trim() !== "") ||
      part.type.startsWith("tool-")
  )
}

const SCREENSHOT_TOOLS = new Set(["viewScreen", "showScreen"])
const OLD_SCREENSHOT =
  "[Screenshot from an earlier turn, no longer available. Call viewScreen to see the screen now.]"

// Stored history only: old screenshots would otherwise be re-sent as images on every turn
function withoutOldScreenshots(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) =>
    message.role === "tool"
      ? {
          ...message,
          content: message.content.map((part) =>
            part.type === "tool-result" && SCREENSHOT_TOOLS.has(part.toolName)
              ? {
                  ...part,
                  output: { type: "text" as const, value: OLD_SCREENSHOT },
                }
              : part
          ),
        }
      : message
  )
}

// The model's own screenshots aren't shown to the person, so don't keep their pixels
function withoutViewScreenImages(parts: ChatUIMessage["parts"]) {
  return parts.map((part) =>
    part.type === "tool-viewScreen" && part.state === "output-available"
      ? { ...part, output: { ...part.output, base64: "" } }
      : part
  )
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

  const { bot } = chat
  const tools = createSandboxTools(bot.id)

  let validatedMessages: ChatUIMessage[]
  try {
    validatedMessages = await validateUIMessages<ChatUIMessage>({
      messages: alreadyStored
        ? previousMessages
        : [...previousMessages, newMessage],
      tools,
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

  const system = [
    `You are ${bot.name}. Your job: ${bot.job}.`,
    bot.instructions && `How you should work: ${bot.instructions}`,
    [
      "You have your own isolated Linux sandbox. Files you create there persist between conversations. It also has a 1024x768 desktop.",
      "Prefer the shell and file tools; use the desktop only when the task needs a screen.",
      "Call viewScreen before and after desktop actions so you know what is on the screen.",
      "Call showScreen only when the person asks to see the screen.",
      "Do the work with your tools instead of describing what you would do.",
      "If something fails, say so plainly.",
    ].join(" "),
  ]
    .filter(Boolean)
    .join("\n\n")

  const result = streamText({
    model: chatModel,
    system,
    // Past reasoning is optional for OpenAI and a reasoning item without its
    // following output is rejected, so the model only sees earlier text and tool calls
    messages: withoutOldScreenshots(
      await convertToModelMessages(
        validatedMessages.map((message) =>
          message.role === "assistant"
            ? {
                ...message,
                parts: message.parts.filter(
                  (part) => part.type !== "reasoning"
                ),
              }
            : message
        ),
        // A stopped reply can hold a tool call that never got its result
        { tools, ignoreIncompleteToolCalls: true }
      )
    ),
    tools,
    // Each step is a model call; cap the cost of one reply
    stopWhen: stepCountIs(20),
    abortSignal: req.signal,
    // The default handler logs the whole error, which can include the request body
    onError: ({ error }) => logError("Chat stream failed", error),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: validatedMessages,
      generateMessageId: generateId,
      // Runs on success, error and abort; keep whatever the bot managed to say and do
      onEnd: async ({ responseMessage, isAborted }) => {
        // A stopped reply's reasoning can be cut off and its last tool call may
        // never have finished, so keep only what it said and what it completed
        const parts = withoutViewScreenImages(
          isAborted
            ? responseMessage.parts.filter(
                (part) =>
                  part.type !== "reasoning" &&
                  !(
                    part.type.startsWith("tool-") &&
                    "state" in part &&
                    (part.state === "input-streaming" ||
                      part.state === "input-available")
                  )
              )
            : responseMessage.parts
        )
        if (!isWorthSaving(parts)) return

        try {
          await saveMessage(chat.id, { ...responseMessage, parts })
        } catch (error) {
          logError("Failed to save assistant message", error)
        }
      },
    }),
  })
}
