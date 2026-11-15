"use client"

import { useAuth } from "@clerk/nextjs"
import { useRouter } from "next/navigation"
import { useCallback } from "react"

import { toast } from "@/components/ui/toast"
import { featureReasons, USAGE_LIMIT_ERROR, type Feature } from "@/lib/billing"

// A convenience for the UI only; the server checks the plan again on every call
export function usePaywall() {
  const { isLoaded, has } = useAuth()
  const router = useRouter()

  const show = useCallback(
    (reason: string) => {
      const id = toast.add({
        type: "error",
        title: "Upgrade to continue",
        description: reason,
        actionProps: {
          children: "See plans",
          onClick: () => {
            toast.close(id)
            router.push("/pricing")
          },
        },
      })
    },
    [router]
  )

  // The plan is fine, but this billing period's allowance is spent
  const showUsageLimit = useCallback(() => {
    const id = toast.add({
      type: "error",
      title: "Usage limit reached",
      description: USAGE_LIMIT_ERROR,
      actionProps: {
        children: "See usage",
        onClick: () => {
          toast.close(id)
          router.push("/usage")
        },
      },
    })
  }, [router])

  const check = useCallback(
    (feature: Feature) => {
      // Before Clerk has loaded the session, let the server decide
      if (!isLoaded || has({ feature })) return true
      show(featureReasons[feature])
      return false
    },
    [isLoaded, has, show]
  )

  return { check, show, showUsageLimit }
}
