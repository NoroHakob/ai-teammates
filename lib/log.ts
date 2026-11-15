// Error reporting and business events for the server.
//
// Errors from the database, Daytona or the provider can carry message text
// (prompts, sandbox ids, URLs), so only what kind of error it was is logged or
// sent: never the message or a body. Business events carry ids and counts only:
// never prompts, notes, memory, bot instructions, file contents, sandbox ids or URLs.
import * as Sentry from "@sentry/nextjs"
import { APICallError } from "ai"

import type { Feature } from "@/lib/billing"

type ProviderDetails = {
  statusCode?: number
  code?: string
  type?: string
}

function primitive(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined
}

// The error's kind; for provider errors also the status and OpenAI's error code/type.
// A retry error wraps the provider's error as lastError.
function describe(error: unknown): {
  name: string
  provider?: ProviderDetails
} {
  const cause =
    error instanceof Error && "lastError" in error ? error.lastError : error
  if (APICallError.isInstance(cause)) {
    const data = cause.data as
      | { error?: { code?: unknown; type?: unknown } }
      | undefined
    return {
      name: cause.name,
      provider: {
        statusCode: cause.statusCode,
        code: primitive(data?.error?.code),
        type: primitive(data?.error?.type),
      },
    }
  }
  return { name: error instanceof Error ? error.name : typeof error }
}

// The same error with an empty message and only the stack frames, so the
// message can't reach Sentry through the exception value or the stack header
function withoutMessage(error: unknown, name: string): Error {
  const safe = new Error("")
  safe.name = name
  const frames =
    error instanceof Error && error.stack
      ? error.stack.split("\n").filter((line) => /^\s+at /.test(line))
      : []
  safe.stack = [name, ...frames].join("\n")
  return safe
}

export function logError(context: string, error: unknown) {
  const { name, provider } = describe(error)

  if (provider) {
    console.error(context, name, provider)
  } else {
    console.error(context, name)
  }

  Sentry.captureException(withoutMessage(error, name), {
    level: "error",
    tags: {
      context,
      "error.name": name,
      ...(provider?.statusCode !== undefined && {
        "http.status_code": provider.statusCode,
      }),
      ...(provider?.code !== undefined && {
        "provider.error_code": provider.code,
      }),
    },
  })
}

// The signed-in person for this request's errors, spans and logs: the Clerk
// user id and nothing else. Sentry keeps it per request on the server.
export function identifyUser(userId: string) {
  Sentry.setUser({ id: userId })
}

type EventAttributes = Record<string, string | number | boolean>

function logEvent(message: string, attributes: EventAttributes) {
  Sentry.logger.info(message, attributes)
}

// Every business event the app reports, and the only attributes each may carry
export const events = {
  botCreated: (botId: string) => logEvent("Bot created", { botId }),
  botDeleted: (botId: string) => logEvent("Bot deleted", { botId }),
  groupChatCreated: (chatId: string, memberCount: number) =>
    logEvent("Group chat created", { chatId, memberCount }),
  groupChatUpdated: (
    chatId: string,
    counts: { memberCount: number; joined: number; removed: number }
  ) => logEvent("Group chat updated", { chatId, ...counts }),
  groupChatDeleted: (chatId: string) =>
    logEvent("Group chat deleted", { chatId }),
  handoff: (chatId: string, fromBotId: string, toBotId: string) =>
    logEvent("Handoff", { chatId, fromBotId, toBotId }),
  // where: the action or route that refused, e.g. "chat" or "createBot"
  paywallHit: (feature: Feature, where: string) =>
    logEvent("Paywall hit", { feature, where }),
  usageLimitHit: (kind: "ai" | "sandbox", where: string) =>
    logEvent("Usage limit hit", { kind, where }),
  cronRun: (job: string, counts: Record<string, number>) =>
    logEvent("Cron run", { job, ...counts }),
}
