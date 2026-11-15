import "server-only"

import type { Sandbox } from "@daytona/sdk"
import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai"
import { z } from "zod"

import { getBotRunningSandbox } from "@/lib/daytona"

const MAX_TEXT_LENGTH = 20_000
const MAX_LIST_ENTRIES = 1000

function truncate(text: string) {
  if (text.length <= MAX_TEXT_LENGTH) return text
  return `${text.slice(0, MAX_TEXT_LENGTH)}\n…[truncated ${text.length - MAX_TEXT_LENGTH} characters]`
}

// Run a lazy async setup once per request; forget it if it fails so the next call retries
function memoize<T>(load: () => Promise<T>) {
  let promise: Promise<T> | null = null
  return () => {
    promise ??= load().catch((error) => {
      promise = null
      throw error
    })
    return promise
  }
}

const coordinate = z.number().int().min(0)

const screenshotInput = z.object({})

type Screenshot = {
  base64: string
  mediaType: "image/jpeg"
  width: number
  height: number
}

// The model gets the image itself plus the screen size, not the base64 as JSON
function screenshotToModelOutput({ output }: { output: Screenshot }) {
  return {
    type: "content" as const,
    value: [
      {
        type: "text" as const,
        text: `Screenshot, ${output.width}x${output.height}.`,
      },
      {
        type: "file" as const,
        mediaType: output.mediaType,
        data: { type: "data" as const, data: output.base64 },
      },
    ],
  }
}

export function createSandboxTools(botId: string) {
  const getSandbox = memoize(() => getBotRunningSandbox(botId))

  // The desktop only runs when a desktop tool needs it
  const getDesktop = memoize(async () => {
    const sandbox = await getSandbox()
    const { status } = await sandbox.computerUse.getStatus()
    if (status !== "active") {
      await sandbox.computerUse.start()
    }
    return sandbox.computerUse
  })

  async function takeScreenshot(sandbox: Sandbox): Promise<Screenshot> {
    const [shot, info] = await Promise.all([
      sandbox.computerUse.screenshot.takeCompressed({
        format: "jpeg",
        quality: 70,
        showCursor: true,
      }),
      sandbox.computerUse.display.getInfo(),
    ])
    if (!shot.screenshot) {
      throw new Error("The screenshot came back empty")
    }
    const display = info.displays?.find((d) => d.isActive) ?? info.displays?.[0]
    return {
      base64: shot.screenshot,
      mediaType: "image/jpeg",
      width: display?.width ?? 0,
      height: display?.height ?? 0,
    }
  }

  async function screenshot() {
    await getDesktop()
    return takeScreenshot(await getSandbox())
  }

  return {
    bash: tool({
      description:
        "Run a shell command in your Linux sandbox and get its exit code and combined output.",
      inputSchema: z.object({
        command: z.string().min(1),
        cwd: z
          .string()
          .optional()
          .describe("Working directory; defaults to the home directory"),
        timeout: z
          .number()
          .int()
          .min(1)
          .max(600)
          .default(60)
          .describe("Seconds before the command is killed"),
      }),
      execute: async ({ command, cwd, timeout }) => {
        const sandbox = await getSandbox()
        // No env vars: nothing secret goes into the sandbox
        const result = await sandbox.process.executeCommand(
          command,
          cwd,
          undefined,
          timeout
        )
        return { exitCode: result.exitCode, output: truncate(result.result) }
      },
    }),

    readFile: tool({
      description: "Read a text file from your sandbox.",
      inputSchema: z.object({ path: z.string().min(1) }),
      execute: async ({ path }) => {
        const sandbox = await getSandbox()
        const content = await sandbox.fs.downloadFile(path)
        return { content: truncate(content.toString("utf8")) }
      },
    }),

    writeFile: tool({
      description:
        "Write a text file in your sandbox, replacing it if it exists.",
      inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
      execute: async ({ path, content }) => {
        const sandbox = await getSandbox()
        await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), path)
        return `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${path}.`
      },
    }),

    listFiles: tool({
      description: "List the entries of a directory in your sandbox.",
      inputSchema: z.object({
        path: z
          .string()
          .default(".")
          .describe("Directory; defaults to the home directory"),
      }),
      execute: async ({ path }) => {
        const sandbox = await getSandbox()
        const files = await sandbox.fs.listFiles(path)
        return {
          entries: files.slice(0, MAX_LIST_ENTRIES).map((file) => ({
            name: file.name,
            isDir: file.isDir,
            size: file.size,
          })),
          truncated: files.length > MAX_LIST_ENTRIES,
        }
      },
    }),

    mouseClick: tool({
      description: "Click on the desktop at a screen position.",
      inputSchema: z.object({
        x: coordinate,
        y: coordinate,
        button: z.enum(["left", "right", "middle"]).default("left"),
        double: z.boolean().default(false),
      }),
      execute: async ({ x, y, button, double }) => {
        const desktop = await getDesktop()
        await desktop.mouse.click(x, y, button, double)
        return `${double ? "Double-clicked" : "Clicked"} ${button} at (${x}, ${y}).`
      },
    }),

    mouseMove: tool({
      description: "Move the mouse to a screen position.",
      inputSchema: z.object({ x: coordinate, y: coordinate }),
      execute: async ({ x, y }) => {
        const desktop = await getDesktop()
        await desktop.mouse.move(x, y)
        return `Moved the mouse to (${x}, ${y}).`
      },
    }),

    mouseDrag: tool({
      description:
        "Drag with the left mouse button from one position to another.",
      inputSchema: z.object({
        startX: coordinate,
        startY: coordinate,
        endX: coordinate,
        endY: coordinate,
      }),
      execute: async ({ startX, startY, endX, endY }) => {
        const desktop = await getDesktop()
        await desktop.mouse.drag(startX, startY, endX, endY)
        return `Dragged from (${startX}, ${startY}) to (${endX}, ${endY}).`
      },
    }),

    mouseScroll: tool({
      description: "Scroll the mouse wheel at a screen position.",
      inputSchema: z.object({
        x: coordinate,
        y: coordinate,
        direction: z.enum(["up", "down", "left", "right"]),
        amount: z.number().int().min(1).max(20).default(3),
      }),
      execute: async ({ x, y, direction, amount }) => {
        const desktop = await getDesktop()
        await desktop.mouse.scroll(x, y, direction, amount)
        return `Scrolled ${direction} ${amount} at (${x}, ${y}).`
      },
    }),

    keyboardType: tool({
      description:
        "Type text on the desktop, into whatever has focus. Newlines press Enter.",
      inputSchema: z.object({ text: z.string().min(1) }),
      execute: async ({ text }) => {
        const desktop = await getDesktop()
        await desktop.keyboard.type(text)
        return `Typed ${text.length} characters.`
      },
    }),

    keyboardPress: tool({
      description:
        "Press a key on the desktop, optionally with modifiers (e.g. key 'c' with ['ctrl']). Keys: enter, escape, tab, backspace, delete, space, arrows (up/down/left/right), home, end, pageup, pagedown, f1-f24, letters, digits.",
      inputSchema: z.object({
        key: z.string().min(1),
        modifiers: z.array(z.enum(["ctrl", "alt", "shift", "cmd"])).optional(),
      }),
      execute: async ({ key, modifiers }) => {
        const desktop = await getDesktop()
        await desktop.keyboard.press(key, modifiers)
        return `Pressed ${[...(modifiers ?? []), key].join("+")}.`
      },
    }),

    viewScreen: tool({
      description:
        "Take a screenshot of the desktop for yourself. The person does not see it.",
      inputSchema: screenshotInput,
      execute: screenshot,
      toModelOutput: screenshotToModelOutput,
    }),

    showScreen: tool({
      description:
        "Take a screenshot of the desktop and show it to the person. Only when they ask to see the screen.",
      inputSchema: screenshotInput,
      execute: screenshot,
      toModelOutput: screenshotToModelOutput,
    }),
  }
}

export type SandboxTools = ReturnType<typeof createSandboxTools>

// The bot that wrote an assistant message, or that a user message was addressed to
export type ChatMessageMetadata = { botId?: string }

export type ChatUIMessage = UIMessage<
  ChatMessageMetadata,
  UIDataTypes,
  InferUITools<SandboxTools>
>
