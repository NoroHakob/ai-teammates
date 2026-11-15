// Sentry in the browser. Without NEXT_PUBLIC_SENTRY_DSN nothing is
// initialized, no replay is recorded and nothing is sent.
import * as Sentry from "@sentry/nextjs"

import {
  privacyOptions,
  scrubBreadcrumb,
  scrubString,
  SENTRY_DSN,
  tracesSampleRate,
} from "@/lib/sentry-privacy"

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate,
    ...privacyOptions(false),
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
        // Recorded network spans and breadcrumbs get the same scrubbing as events
        // Only reads and rewrites string fields, so the loose shape is enough
        beforeAddRecordingEvent: (event) => {
          const data = event.data as unknown as {
            tag?: string
            payload?: Record<string, unknown>
          }
          if (data.tag === "breadcrumb" && data.payload) {
            const kept = scrubBreadcrumb(data.payload)
            if (!kept) return null
            data.payload = kept as Record<string, unknown>
          }
          if (data.tag === "performanceSpan" && data.payload) {
            const { description } = data.payload
            if (typeof description === "string") {
              data.payload.description = scrubString(description)
            }
          }
          return event
        },
      }),
    ],
    // Only replays of sessions that hit an error
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
