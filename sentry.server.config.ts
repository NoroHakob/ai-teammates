// Sentry for the Node.js runtime, loaded from instrumentation.ts.
// Without NEXT_PUBLIC_SENTRY_DSN nothing is initialized and nothing is sent.
import * as Sentry from "@sentry/nextjs"

import {
  privacyOptions,
  SENTRY_DSN,
  tracesSampleRate,
} from "@/lib/sentry-privacy"

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate,
    ...privacyOptions(true),
    // Spans for the AI SDK and OpenAI calls, without their prompts or replies
    integrations: [
      Sentry.vercelAIIntegration({ recordInputs: false, recordOutputs: false }),
      Sentry.openAIIntegration({ recordInputs: false, recordOutputs: false }),
    ],
  })
}
