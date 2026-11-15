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
    // No VercelAI integration, not even the default one: with ai v7 it swaps
    // the model call's stream after the SDK has locked it, so every streamText
    // with tools fails with "ReadableStream is locked" (a TypeError). The
    // OpenAI calls still show up as fetch spans.
    integrations: (defaults) => [
      ...defaults.filter((integration) => integration.name !== "VercelAI"),
      Sentry.openAIIntegration({ recordInputs: false, recordOutputs: false }),
    ],
  })
}
