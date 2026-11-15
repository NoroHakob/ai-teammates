"use client"

import * as Sentry from "@sentry/nextjs"
import NextError from "next/error"
import { useEffect } from "react"

// Replaces the root layout when it fails, so it renders its own html and body
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body>
        {/* The App Router doesn't expose status codes; 0 shows a generic message */}
        <NextError statusCode={0} />
      </body>
    </html>
  )
}
