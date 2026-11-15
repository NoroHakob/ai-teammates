import { withSentryConfig } from "@sentry/nextjs/config"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  devIndicators: false,
  // The SDK loads form-data etc. with dynamic require, which the bundler can't follow
  serverExternalPackages: ["@daytona/sdk"],
  // File tracing misses busboy, which the SDK requires at runtime to read files
  // from a sandbox (the readFile tool); without it readFile fails on Vercel
  outputFileTracingIncludes: {
    "/api/chat": [
      "./node_modules/busboy/**/*",
      "./node_modules/streamsearch/**/*",
    ],
  },
}

// Without SENTRY_AUTH_TOKEN no source maps are uploaded; without
// NEXT_PUBLIC_SENTRY_DSN the SDK is never initialized (see the sentry configs)
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // On Vercel the release is the deployed commit; elsewhere the plugin detects one
  release: process.env.VERCEL_GIT_COMMIT_SHA
    ? { name: process.env.VERCEL_GIT_COMMIT_SHA }
    : undefined,
  // Browser events go through the app, so ad blockers don't drop them.
  // A fixed path, because proxy.ts must exclude it from its matcher.
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
})
