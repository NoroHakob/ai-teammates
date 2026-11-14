import "server-only"

import { Daytona, DaytonaNotFoundError, type Sandbox } from "@daytona/sdk"
import { and, eq, isNull } from "drizzle-orm"

import { db } from "@/db"
import { bots } from "@/db/schema"

// One client per server process; the key never leaves this module
const globalForDaytona = globalThis as unknown as { daytona?: Daytona }

function getDaytona() {
  if (!globalForDaytona.daytona) {
    const apiKey = process.env.DAYTONA_API_KEY
    if (!apiKey) {
      throw new Error("DAYTONA_API_KEY is not set")
    }
    globalForDaytona.daytona = new Daytona({
      apiKey,
      // The SDK only takes the API URL from code or the process environment
      apiUrl: "https://app.daytona.io/api",
    })
  }
  return globalForDaytona.daytona
}

// States that turn into "started" on their own
const STARTING_STATES = new Set([
  "creating",
  "starting",
  "restoring",
  "resuming",
  "pulling_snapshot",
])

export async function createSandbox(botId: string) {
  // The bot runs whatever the model decides, so the sandbox gets no env vars,
  // secrets or volumes: there must be nothing in it worth stealing.
  // Default snapshot and resources (the smallest), so computer use is available.
  return getDaytona().create({
    labels: { botId },
    autoStopInterval: 15, // minutes idle before it stops
    autoArchiveInterval: 60 * 24, // minutes stopped before it is archived
  })
}

export async function getRunningSandbox(sandboxId: string): Promise<Sandbox> {
  const sandbox = await getDaytona().get(sandboxId)
  if (sandbox.state === "started") {
    return sandbox
  }
  if (sandbox.state && STARTING_STATES.has(sandbox.state)) {
    await sandbox.waitUntilStarted(120)
  } else {
    // Archived sandboxes are restored from cold storage, which takes longer
    await sandbox.start(120)
  }
  return sandbox
}

export async function deleteSandbox(sandboxId: string) {
  try {
    const sandbox = await getDaytona().get(sandboxId)
    await sandbox.delete()
  } catch (error) {
    if (error instanceof DaytonaNotFoundError) return
    throw error
  }
}

// The bot's sandbox ID, creating the sandbox the first time it is needed.
// Callers must have checked that the bot belongs to the signed-in user.
export async function ensureBotSandbox(botId: string): Promise<string> {
  const [bot] = await db
    .select({ sandboxId: bots.sandboxId })
    .from(bots)
    .where(eq(bots.id, botId))
  if (!bot) {
    throw new Error("Bot not found")
  }
  if (bot.sandboxId) {
    return bot.sandboxId
  }

  const sandbox = await createSandbox(botId)

  let claimed: { sandboxId: string | null } | undefined
  try {
    // Only the first request to get here stores its sandbox
    ;[claimed] = await db
      .update(bots)
      .set({ sandboxId: sandbox.id })
      .where(and(eq(bots.id, botId), isNull(bots.sandboxId)))
      .returning({ sandboxId: bots.sandboxId })
  } catch (error) {
    await deleteSandbox(sandbox.id).catch(() => {})
    throw error
  }
  if (claimed) {
    return sandbox.id
  }

  // Lost the race (or the bot was deleted meanwhile): drop ours, use theirs
  await deleteSandbox(sandbox.id)
  const [winner] = await db
    .select({ sandboxId: bots.sandboxId })
    .from(bots)
    .where(eq(bots.id, botId))
  if (!winner?.sandboxId) {
    throw new Error("Bot not found")
  }
  return winner.sandboxId
}
