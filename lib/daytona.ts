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
  const sandbox = await getDaytona().create({
    labels: { botId },
    autoStopInterval: 15, // minutes idle before it stops
    autoArchiveInterval: 60 * 24, // minutes stopped before it is archived
  })
  // A sandbox without its memory file is not ready; don't leave it behind
  try {
    await runShell(sandbox, `touch ${MEMORY_PATH}`)
  } catch (error) {
    await deleteSandbox(sandbox.id).catch(() => {})
    throw error
  }
  return sandbox
}

// The bot's memory, shared by all its chats, in its sandbox home directory
const MEMORY_PATH = '"$HOME/MEMORY.md"'

// Fixed scripts only: the caller must never put model or user text in them,
// since they are wrapped in single quotes for sh
async function runShell(sandbox: Sandbox, script: string) {
  const result = await sandbox.process.executeCommand(`sh -c '${script}'`)
  if (result.exitCode !== 0) {
    // The output can hold memory content, so it is not part of the error
    throw new Error(`Sandbox command failed with exit code ${result.exitCode}`)
  }
  return result.result
}

// The bot's memory file; touch also creates it in sandboxes made before it existed
export async function readBotMemory(sandbox: Sandbox): Promise<string> {
  return runShell(sandbox, `touch ${MEMORY_PATH} && cat ${MEMORY_PATH}`)
}

// Appends rather than rewrites, so saves from chats running at the same time all survive.
// The text goes in as base64, so it can never become part of the shell command.
export async function appendBotMemory(sandbox: Sandbox, text: string) {
  const encoded = Buffer.from(text, "utf8").toString("base64")
  await runShell(sandbox, `echo ${encoded} | base64 -d >> ${MEMORY_PATH}`)
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

// The bot's sandbox, started, creating it the first time it is needed.
// A sandbox deleted outside the app (e.g. from the Daytona dashboard) is
// forgotten and replaced once. Callers must have checked that the bot
// belongs to the signed-in user.
export async function getBotRunningSandbox(botId: string): Promise<Sandbox> {
  const sandboxId = await ensureBotSandbox(botId)
  try {
    return await getRunningSandbox(sandboxId)
  } catch (error) {
    if (!(error instanceof DaytonaNotFoundError)) throw error
  }

  // Only clear the ID we found missing: if another request already replaced
  // it, this does nothing and ensureBotSandbox returns the replacement.
  // Requests recovering at the same time race in ensureBotSandbox as usual.
  await db
    .update(bots)
    .set({ sandboxId: null })
    .where(and(eq(bots.id, botId), eq(bots.sandboxId, sandboxId)))

  return getRunningSandbox(await ensureBotSandbox(botId))
}

// noVNC (websockify) inside the default image
const NOVNC_PORT = 6080
const DESKTOP_URL_TTL_SECONDS = 60 * 60

// A websocket URL for the bot's desktop, for a noVNC client in the browser.
// The URL itself is the credential (signed, one port, 1 hour): never log it.
export async function getBotDesktopUrl(botId: string): Promise<string> {
  const sandbox = await getBotRunningSandbox(botId)
  const { status } = await sandbox.computerUse.getStatus()
  if (status !== "active") {
    await sandbox.computerUse.start()
  }
  const { url } = await sandbox.getSignedPreviewUrl(
    NOVNC_PORT,
    DESKTOP_URL_TTL_SECONDS
  )
  const wsUrl = new URL(url)
  wsUrl.protocol = wsUrl.protocol === "http:" ? "ws:" : "wss:"
  wsUrl.pathname = "/websockify"
  return wsUrl.toString()
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
