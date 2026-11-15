import { createHash, timingSafeEqual } from "node:crypto"

import { inArray } from "drizzle-orm"

import { db } from "@/db"
import { bots } from "@/db/schema"
import { listRunningSandboxIds, stopSandbox } from "@/lib/daytona"
import { getUsage, recordUsage } from "@/lib/usage"

// Run every 5 minutes; each run charges every running sandbox one interval
const INTERVAL_SECONDS = 5 * 60

// Hashing first gives both sides the same length, so the comparison leaks nothing
function digest(value: string) {
  return createHash("sha256").update(value).digest()
}

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get("authorization") ?? ""
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
}

// Only the error's kind: messages can carry sandbox ids or URLs
function logError(context: string, error: unknown) {
  console.error(context, error instanceof Error ? error.name : typeof error)
}

// Called by a scheduler, not a person: no Clerk session, only the secret
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 })
  }

  // Next's default handler would log the whole error
  try {
    return Response.json(await meterSandboxes())
  } catch (error) {
    logError("Metering sandboxes failed", error)
    return new Response("Internal server error", { status: 500 })
  }
}

async function meterSandboxes() {
  const runningIds = await listRunningSandboxIds()

  // Only sandboxes of a bot are charged, to the bot's owner
  const owned =
    runningIds.length === 0
      ? []
      : await db
          .select({ sandboxId: bots.sandboxId, userId: bots.userId })
          .from(bots)
          .where(inArray(bots.sandboxId, runningIds))

  // The same 5-minute slot keys the same entry, so a rerun charges nothing twice
  const slotMs = INTERVAL_SECONDS * 1000
  const slot = new Date(Math.floor(Date.now() / slotMs) * slotMs).toISOString()
  const charged = await recordUsage(
    owned.map(({ sandboxId, userId }) => ({
      userId,
      kind: "sandbox" as const,
      amount: INTERVAL_SECONDS,
      idempotencyKey: `sandbox:${sandboxId}:${slot}`,
    }))
  )

  // Owners without sandbox time left, or without a paid plan, get theirs stopped
  const sandboxesByOwner = new Map<string, string[]>()
  for (const { sandboxId, userId } of owned) {
    if (!sandboxId) continue
    sandboxesByOwner.set(userId, [
      ...(sandboxesByOwner.get(userId) ?? []),
      sandboxId,
    ])
  }

  let ownersOverLimit = 0
  let stopped = 0
  let failed = 0
  for (const [userId, sandboxIds] of sandboxesByOwner) {
    let usage
    try {
      usage = await getUsage(userId)
    } catch (error) {
      // Charged already; try this owner again on the next run
      logError("Failed to load usage", error)
      failed++
      continue
    }
    if (usage && usage.remaining.sandbox > 0) continue

    ownersOverLimit++
    for (const sandboxId of sandboxIds) {
      try {
        if (await stopSandbox(sandboxId)) stopped++
      } catch (error) {
        logError("Failed to stop sandbox", error)
        failed++
      }
    }
  }

  // Counts only: never sandbox ids, owners or URLs
  return {
    running: runningIds.length,
    metered: owned.length,
    charged,
    ownersOverLimit,
    stopped,
    failed,
  }
}
