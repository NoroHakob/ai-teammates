// Shared by the browser, Node and edge Sentry configs, so it must not import
// anything runtime-specific. This app handles prompts, API keys, the cron
// secret and signed desktop URLs: nothing here may let them reach Sentry.
import type {
  Breadcrumb,
  ErrorEvent,
  Event,
  Log,
  Options,
  StreamedSpanJSON,
} from "@sentry/core"

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN

const FILTERED = "[Filtered]"

// The SDK collects none of this; the hooks below are the second line of defence.
// stackFrameVariables: false is includeLocalVariables off.
export const dataCollection: Options["dataCollection"] = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
}

export const tracesSampleRate =
  process.env.NODE_ENV === "development" ? 1.0 : 0.1

// A websocket URL is the signed desktop URL (the URL is the credential), so it
// goes entirely; any other URL loses its query string and fragment
const WS_URL = /wss?:\/\/[^\s"'<>`]+/gi
const QUERY_IN_URL = /((?:https?:\/\/|\/)[^\s"'<>`?#]*)[?#][^\s"'<>`]*/gi

export function scrubString(value: string): string {
  return value.replace(WS_URL, FILTERED).replace(QUERY_IN_URL, "$1")
}

function scrubUnknown(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value)
  if (Array.isArray(value)) return value.map(scrubUnknown)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, scrubUnknown(inner)])
    )
  }
  return value
}

// Span and log attributes that hold a query string, a fragment, or AI content
const DROPPED_ATTRIBUTE =
  /^(url\.query|http\.query|url\.fragment|http\.fragment|http\.request\.header\.|http\.response\.header\.|http\.request\.body|http\.response\.body|gen_ai\.(input|output|prompt|request\.messages|response\.text|system_instructions|tool\.(input|output|call\.(arguments|result))|completion)|ai\.(prompt|response\.(text|object|toolCalls|reasoning)|toolCall\.(args|result)))/

function scrubAttributes<T extends Record<string, unknown>>(
  attributes: T | undefined
): T | undefined {
  if (!attributes) return attributes
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (DROPPED_ATTRIBUTE.test(key)) continue
    kept[key] = scrubUnknown(value)
  }
  return kept as T
}

// The user is only ever the Clerk user id
function onlyUserId(user: Event["user"]): Event["user"] {
  return user?.id === undefined ? undefined : { id: user.id }
}

// serverSide: also drop exception messages. Server errors can carry database
// values, provider responses or prompt text; the type and stack remain.
export function scrubEvent<T extends Event>(event: T, serverSide: boolean): T {
  delete event.request
  delete event.extra
  delete event.server_name
  event.user = onlyUserId(event.user)
  if (event.message) event.message = scrubString(event.message)
  if (event.logentry?.message) {
    event.logentry = { message: scrubString(event.logentry.message) }
  }
  if (event.transaction) event.transaction = scrubString(event.transaction)
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) {
      exception.value = serverSide ? "" : scrubString(exception.value)
    }
  }
  if (event.contexts) {
    event.contexts = scrubUnknown(event.contexts) as T["contexts"]
  }
  if (event.tags) event.tags = scrubUnknown(event.tags) as T["tags"]
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.flatMap((breadcrumb) => {
      const kept = scrubBreadcrumb(breadcrumb)
      return kept ? [kept] : []
    })
  }
  if ("urls" in event && Array.isArray(event.urls)) {
    event.urls = event.urls.map((url: unknown) =>
      typeof url === "string" ? scrubString(url) : url
    )
  }
  return event
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // Console output can hold anything the app or a library printed
  if (breadcrumb.category === "console") return null
  // Requests to a websocket URL are the desktop connection itself
  const url = breadcrumb.data?.url
  if (typeof url === "string" && /^wss?:/i.test(url)) return null
  return {
    ...breadcrumb,
    message: breadcrumb.message && scrubString(breadcrumb.message),
    data: breadcrumb.data && scrubAttributes(breadcrumb.data),
  }
}

export function scrubSpan(span: StreamedSpanJSON): StreamedSpanJSON {
  return {
    ...span,
    name: scrubString(span.name),
    attributes: scrubAttributes(span.attributes) ?? span.attributes,
    links: span.links?.map((link) => ({
      ...link,
      attributes: scrubAttributes(link.attributes),
    })),
  }
}

export function scrubLog(log: Log): Log {
  return {
    ...log,
    message:
      typeof log.message === "string" ? scrubString(log.message) : log.message,
    attributes: scrubAttributes(log.attributes),
  }
}

// The hooks every runtime shares; serverSide decides about exception messages
export function privacyOptions(serverSide: boolean) {
  return {
    dataCollection,
    beforeSend: (event: ErrorEvent) => scrubEvent(event, serverSide),
    beforeSendSpan: scrubSpan,
    beforeSendLog: scrubLog,
    beforeBreadcrumb: scrubBreadcrumb,
  } satisfies Partial<Options>
}
