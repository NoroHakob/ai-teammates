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
import { featureReasons, hasFeature, UPGRADE_REQUIRED } from "@/lib/billing"
import { createHandoffTool, type Handoff } from "@/lib/handoff-tool"
import { withoutNamePrefixes } from "@/lib/name-prefix"
import { chatModelCost } from "@/lib/model-pricing"
import { createSandboxTools, type ChatUIMessage } from "@/lib/sandbox-tools"
import { getUsage, recordUsage, USAGE_LIMIT_ERROR } from "@/lib/usage"
import { getChat } from "@/queries/chats"
import { getMessages } from "@/queries/messages"

const MAX_MESSAGE_LENGTH = 10000
const MAX_PREVIEW_LENGTH = 100
// How long a sandbox-time check is trusted within one request
const SANDBOX_CHECK_TTL_MS = 60_000
const SANDBOX_HOURS_USED_UP =
  "The sandbox hours for this billing period are used up."

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

// botId: the bot that wrote an assistant message, or that a user message was addressed to
async function saveMessage(chatId: string, message: UIMessage, botId: string) {
  if (message.role !== "user" && message.role !== "assistant") return

  await db
    .insert(messages)
    .values({
      id: message.id,
      chatId,
      role: message.role,
      parts: message.parts,
      botId,
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

// In a group chat the model can't tell its teammates' replies from its own,
// so each earlier reply says who wrote it. A reply starts with the bot it was
// addressed to (metadata.botId) and changes author at each completed handoff,
// so every stretch of text after one gets its own name.
function withAuthorNames(
  messages: ChatUIMessage[],
  nameOf: (botId: string | undefined) => string
): ChatUIMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message
    let author = message.metadata?.botId
    let needsName = true
    return {
      ...message,
      parts: message.parts.map((part) => {
        if (part.type === "tool-handoff" && part.state === "output-available") {
          author = part.output.botId
          needsName = true
          return part
        }
        if (part.type === "text" && needsName && part.text.trim() !== "") {
          needsName = false
          return { ...part, text: `[${nameOf(author)}] ${part.text}` }
        }
        return part
      }),
    }
  })
}

// Every handoff that went through, in order. Failed ones are tool errors, not
// results. The output comes from our own execute, never from the model.
function completedHandoffs(
  steps: { staticToolResults: { toolName: string; output: unknown }[] }[]
): Handoff[] {
  return steps.flatMap((step) =>
    step.staticToolResults.flatMap((result) =>
      result.toolName === "handoff" ? [result.output as Handoff] : []
    )
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
  const { isAuthenticated, userId, has } = await auth()
  if (!isAuthenticated) {
    return new Response("Unauthorized", { status: 401 })
  }
  // Before anything is read or saved; the client turns this into the paywall
  if (!hasFeature(has, "bots")) {
    return new Response(UPGRADE_REQUIRED, { status: 402 })
  }
  const canUseSandboxes = hasFeature(has, "sandboxes")

  // Also before anything is saved: no reply without AI budget left
  let usage
  try {
    usage = await getUsage(userId)
  } catch (error) {
    logError("Failed to load usage", error)
    return new Response("Internal server error", { status: 500 })
  }
  if (!usage || usage.remaining.ai <= 0) {
    return new Response(USAGE_LIMIT_ERROR, { status: 402 })
  }
  const aiBudget = usage.remaining.ai

  // Sandbox time left, re-read at most once a minute; starts from the usage above
  let sandboxCheck = {
    at: Date.now(),
    allowed: usage.remaining.sandbox > 0,
  }
  // The closures below don't keep the isAuthenticated narrowing
  const payerId = userId
  async function checkSandboxAccess() {
    if (!canUseSandboxes) {
      throw new Error(featureReasons.sandboxes)
    }
    if (Date.now() - sandboxCheck.at >= SANDBOX_CHECK_TTL_MS) {
      let current
      try {
        current = await getUsage(payerId)
      } catch (error) {
        // The model and the person see a tool's error, so not this one
        logError("Failed to load usage", error)
        throw new Error("Couldn't check the sandbox hours. Try again.")
      }
      sandboxCheck = {
        at: Date.now(),
        allowed: current !== null && current.remaining.sandbox > 0,
      }
    }
    if (!sandboxCheck.allowed) {
      throw new Error(SANDBOX_HOURS_USED_UP)
    }
  }

  // The transport sends only { id, message, botId }: the chat ID, the new user message
  // and, in a group chat, the bot it is addressed to.
  // The history comes from the database, so the client can't rewrite it.
  let body: { id?: unknown; message?: unknown; botId?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response("Bad request", { status: 400 })
  }

  const { id, message, botId } = body
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

  const parts = message.parts as UIMessage["parts"]
  if (textOf(parts).length > MAX_MESSAGE_LENGTH) {
    return new Response("Message too long", { status: 400 })
  }

  // getChat is scoped to the signed-in user, so someone else's chat is a 404
  const chat = await getChat(id)
  const previousMessages = chat && (await getMessages(chat.id))
  if (!chat || !previousMessages) {
    return new Response("Not found", { status: 404 })
  }

  // A group chat names the bot that should answer, and it must be a member;
  // a direct chat has one bot and ignores botId
  const isGroup = chat.kind === "group"
  const bot = isGroup
    ? chat.bots.find((member) => member.id === botId)
    : chat.bots[0]
  if (!bot) {
    return new Response("Bad request", { status: 400 })
  }

  // Rebuilt rather than trusted, so the client can't set its own metadata
  const newMessage: ChatUIMessage = {
    id: message.id,
    role: "user",
    parts: parts as ChatUIMessage["parts"],
    metadata: { botId: bot.id },
  }

  // Member event lines are for the person; the instructions already list the
  // current teammates, so the model never sees them
  const history = previousMessages.filter((stored) => stored.role !== "system")

  // A retried send reuses the stored message instead of appending it twice.
  // An event line's id can't be reused for a user message.
  if (
    previousMessages.some(
      (stored) => stored.id === newMessage.id && stored.role === "system"
    )
  ) {
    return new Response("Bad request", { status: 400 })
  }
  const alreadyStored = history.some((m) => m.id === newMessage.id)

  // Who is answering: the addressed bot, until it hands the request off.
  // held: every bot that already had this request, so it can't bounce back.
  let current = bot
  const held = new Set([bot.id])

  // The sandbox, desktop and memory tools always act for the current bot
  const sandboxTools = createSandboxTools(() => current.id, checkSandboxAccess)
  const tools = isGroup
    ? {
        ...sandboxTools,
        // Only members of this chat, from the server's data; the model's id is just a lookup key
        handoff: createHandoffTool((targetId) => {
          const target = chat.bots.find((member) => member.id === targetId)
          if (!target) {
            throw new Error("No teammate in this chat has that id.")
          }
          if (held.has(target.id)) {
            throw new Error(
              `${target.name} already had this request. Answer it yourself.`
            )
          }
          held.add(target.id)
          current = target
          return { botId: target.id, name: target.name }
        }),
      }
    : sandboxTools

  let validatedMessages: ChatUIMessage[]
  try {
    validatedMessages = await validateUIMessages<ChatUIMessage>({
      messages: alreadyStored ? history : [...history, newMessage],
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
    await saveMessage(chat.id, validatedMessages.at(-1)!, bot.id)
  } catch (error) {
    logError("Failed to save user message", error)
    return new Response("Internal server error", { status: 500 })
  }

  type ChatBot = (typeof chat.bots)[number]

  // handedOverBy: the teammate who handed this request to speaker, if any
  const instructionsFor = (speaker: ChatBot, handedOverBy?: ChatBot) => {
    const teammates = chat.bots.filter((member) => member.id !== speaker.id)
    return [
      `You are ${speaker.name}. Your job: ${speaker.job}.`,
      speaker.instructions && `How you should work: ${speaker.instructions}`,
      isGroup &&
        [
          `This is the group chat "${chat.name ?? speaker.name}".`,
          `Your teammates here:\n${teammates.map((teammate) => `- ${teammate.name} (id: ${teammate.id}): ${teammate.job}`).join("\n")}`,
          "Earlier replies may come from teammates; each stretch of a reply starts with its author's name in brackets.",
          handedOverBy
            ? `The person addressed their latest message to ${handedOverBy.name}, who handed it to you with the handoff tool; their note is in that call. Take it over and answer as yourself.`
            : "The person addressed this message to you, so answer as yourself.",
          "Never start your reply or any part of it with a name in brackets; the app shows who wrote each reply.",
          "If the request belongs to a teammate's job rather than yours, call handoff with their id instead of answering.",
          "Do not hand off what you can do well yourself. Never pass a request back to a teammate who handed it to you.",
        ].join("\n"),
      [
        "You talk with people in several conversations, and you only know about the others through your memory.",
        "Call recall before answering anything that could depend on another conversation, and before saying you don't know something.",
        "When you learn something that will be useful later, or the person asks you to remember something, call remember in the same turn.",
        "Never store secrets, tokens or passwords.",
      ].join(" "),
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
  }

  const responseMessageId = generateId()

  const result = streamText({
    model: chatModel,
    instructions: instructionsFor(bot),
    // Past reasoning is optional for OpenAI and a reasoning item without its
    // following output is rejected, so the model only sees earlier text and tool calls
    messages: withoutOldScreenshots(
      await convertToModelMessages(
        (isGroup
          ? withAuthorNames(validatedMessages, (authorId) =>
              authorId === undefined
                ? "Someone"
                : (chat.bots.find((member) => member.id === authorId)?.name ??
                  "Someone")
            )
          : validatedMessages
        ).map((message) =>
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
    // After a handoff the next steps speak as the teammate who took over
    prepareStep: ({ steps }) => {
      const handoffs = completedHandoffs(steps)
      const last = handoffs.at(-1)
      if (!last) return undefined
      const speaker = chat.bots.find((member) => member.id === last.botId)
      const previous = handoffs.at(-2)
      const handedOverBy = previous
        ? chat.bots.find((member) => member.id === previous.botId)
        : bot
      if (!speaker) return undefined
      return { instructions: instructionsFor(speaker, handedOverBy) }
    },
    // Each step is a model call; cap the cost of one reply
    // Also stop once this reply has spent the AI budget that was left
    stopWhen: [
      stepCountIs(20),
      ({ steps }) =>
        steps.reduce((total, step) => total + chatModelCost(step.usage), 0) >=
        aiBudget,
    ],
    // Every finished model call is charged as it ends, so a reply that is
    // stopped or fails later still pays for the steps it already took
    onStepEnd: async (step) => {
      try {
        await recordUsage([
          {
            userId: payerId,
            kind: "ai",
            amount: chatModelCost(step.usage),
            idempotencyKey: `ai:${responseMessageId}:${step.stepNumber}`,
          },
        ])
      } catch (error) {
        logError("Failed to record AI usage", error)
      }
    },
    abortSignal: req.signal,
    // The default handler logs the whole error, which can include the request body
    onError: ({ error }) => logError("Chat stream failed", error),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: validatedMessages,
      // Known up front, so the usage keys can name the reply
      generateMessageId: () => responseMessageId,
      // Tells the client which bot is writing this reply
      messageMetadata: ({ part }) =>
        part.type === "start" ? { botId: bot.id } : undefined,
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
        // Stored and previewed without a "[Name] " the model copied from the history
        const cleanParts = isGroup ? withoutNamePrefixes(parts) : parts
        if (!isWorthSaving(cleanParts)) return

        try {
          await saveMessage(
            chat.id,
            { ...responseMessage, parts: cleanParts },
            bot.id
          )
        } catch (error) {
          logError("Failed to save assistant message", error)
        }
      },
    }),
  })
}
