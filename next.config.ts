import { withSentryConfig } from "@sentry/nextjs/config"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  devIndicators: false,
  // The SDK loads form-data etc. with dynamic require, which the bundler can't follow
  serverExternalPackages: ["@daytona/sdk"],
}

// Without SENTRY_AUTH_TOKEN no source maps are uploaded; without
// NEXT_PUBLIC_SENTRY_DSN the SDK is never initialized (see the sentry configs)
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // On Railway the release is the deployed commit; elsewhere the plugin detects one
  release: process.env.RAILWAY_GIT_COMMIT_SHA
    ? { name: process.env.RAILWAY_GIT_COMMIT_SHA }
    : undefined,
  // Browser events go through the app, so ad blockers don't drop them.
  // A fixed path, because proxy.ts must exclude it from its matcher.
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
})
