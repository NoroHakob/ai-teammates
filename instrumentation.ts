import * as Sentry from "@sentry/nextjs"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

// Errors from server components, route handlers, server actions and the proxy.
// A no-op when Sentry wasn't initialized.
export const onRequestError = Sentry.captureRequestError
