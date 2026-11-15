import "server-only"

import { isClerkAPIResponseError } from "@clerk/nextjs/errors"
import { clerkClient } from "@clerk/nextjs/server"
import { and, eq, gte, sql } from "drizzle-orm"

import { db } from "@/db"
import { usageEntries, type NewUsageEntry } from "@/db/schema"

// Defined next to the other billing strings so the client can match it too
export { USAGE_LIMIT_ERROR } from "@/lib/billing"

export type UsageKind = NewUsageEntry["kind"]

// What the paid plan includes per billing period
export const usageLimits: Record<UsageKind, number> = {
  ai: 10_000_000, // millionths of a dollar: $10
  sandbox: 50 * 60 * 60, // seconds: 50 hours
}

export type BillingPeriod = { start: Date; end: Date }

// The current period of the user's active paid subscription item; null on the free plan
export async function getBillingPeriod(
  userId: string
): Promise<BillingPeriod | null> {
  let subscription
  try {
    const clerk = await clerkClient()
    subscription = await clerk.billing.getUserBillingSubscription(userId)
  } catch (error) {
    // No subscription at all is the free plan, not a failure
    if (isClerkAPIResponseError(error) && error.status === 404) return null
    throw error
  }

  // The free plan's item has no period end; a paid one always has
  const item = subscription.subscriptionItems.find(
    (item) =>
      item.status === "active" &&
      item.periodEnd !== null &&
      item.plan !== null &&
      !item.plan.isDefault
  )
  if (!item?.periodEnd) return null

  return { start: new Date(item.periodStart), end: new Date(item.periodEnd) }
}

export type Usage = {
  period: BillingPeriod
  used: Record<UsageKind, number>
  remaining: Record<UsageKind, number>
}

// The user's usage in the current billing period; null without a paid plan
export async function getUsage(userId: string): Promise<Usage | null> {
  const period = await getBillingPeriod(userId)
  if (!period) return null

  const rows = await db
    .select({
      kind: usageEntries.kind,
      total: sql<string>`coalesce(sum(${usageEntries.amount}), 0)`,
    })
    .from(usageEntries)
    .where(
      and(
        eq(usageEntries.userId, userId),
        gte(usageEntries.createdAt, period.start)
      )
    )
    .groupBy(usageEntries.kind)

  // sum() of integers is a bigint, which comes back as a string
  const used: Record<UsageKind, number> = { ai: 0, sandbox: 0 }
  for (const row of rows) used[row.kind] = Number(row.total)

  return {
    period,
    used,
    remaining: {
      ai: Math.max(0, usageLimits.ai - used.ai),
      sandbox: Math.max(0, usageLimits.sandbox - used.sandbox),
    },
  }
}

// Append to the ledger; an entry whose key is already there is skipped.
// Returns how many entries were new.
export async function recordUsage(
  entries: Omit<NewUsageEntry, "id" | "createdAt">[]
) {
  if (entries.length === 0) return 0
  const inserted = await db
    .insert(usageEntries)
    .values(entries)
    .onConflictDoNothing({ target: usageEntries.idempotencyKey })
    .returning({ id: usageEntries.id })
  return inserted.length
}
