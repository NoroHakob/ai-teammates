"use client"

import { useAuth } from "@clerk/nextjs"
import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

// Browser errors and replays carry the Clerk user id and nothing else about the person
export function SentryUser() {
  const { userId } = useAuth()

  useEffect(() => {
    Sentry.setUser(userId ? { id: userId } : null)
  }, [userId])

  return null
}
