// Sentry for the edge runtime (proxy.ts), loaded from instrumentation.ts.
// Without NEXT_PUBLIC_SENTRY_DSN nothing is initialized and nothing is sent.
// AI calls run on Node only, so there are no AI integrations here.
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
  })
}
