"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { ChatAvatar } from "@/components/chat-avatar"
import { CodeBlock } from "@/components/ai-elements/code-block"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Image } from "@/components/ai-elements/image"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool"
import { SelectGroup } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import type { Bot } from "@/db/schema"
import type { ChatUIMessage } from "@/lib/sandbox-tools"

type ChatBot = Pick<Bot, "id" | "name" | "avatar">

type ChatPart = ChatUIMessage["parts"][number]
type ChatToolPart = Extract<ChatPart, { type: `tool-${string}` }>

function isToolPart(part: ChatPart): part is ChatToolPart {
  return part.type.startsWith("tool-")
}

// Something to show: text it said or a tool it used
function hasVisibleParts(parts: ChatPart[]) {
  return parts.some(
    (part) =>
      (part.type === "text" && part.text.trim() !== "") || isToolPart(part)
  )
}

function isVisible(message: ChatUIMessage) {
  return hasVisibleParts(message.parts)
}

// One bot's stretch of a message
type Segment = { botId: string | undefined; parts: ChatPart[] }

// A group reply starts with the bot it was addressed to and passes to another
// bot at each completed handoff, so each stretch gets its own byline
function segmentsOf(message: ChatUIMessage): Segment[] {
  const segments: Segment[] = [{ botId: message.metadata?.botId, parts: [] }]
  for (const part of message.parts) {
    segments.at(-1)!.parts.push(part)
    if (part.type === "tool-handoff" && part.state === "output-available") {
      segments.push({ botId: part.output.botId, parts: [] })
    }
  }
  return segments
}

const toolTitles: Record<ChatToolPart["type"], string> = {
  "tool-bash": "Run command",
  "tool-readFile": "Read file",
  "tool-writeFile": "Write file",
  "tool-listFiles": "List files",
  "tool-mouseClick": "Click",
  "tool-mouseMove": "Move mouse",
  "tool-mouseDrag": "Drag",
  "tool-mouseScroll": "Scroll",
  "tool-keyboardType": "Type",
  "tool-keyboardPress": "Press key",
  "tool-viewScreen": "Look at screen",
  "tool-showScreen": "Show screen",
  "tool-recall": "Recall",
  "tool-remember": "Remember",
  "tool-handoff": "Hand off",
}

function ToolPartView({ part }: { part: ChatToolPart }) {
  const hasOutput = part.state === "output-available"
  const errorText = part.state === "output-error" ? part.errorText : undefined

  let title = toolTitles[part.type]
  let input = <ToolInput input={part.input} />
  let output: unknown = hasOutput ? part.output : undefined

  switch (part.type) {
    case "tool-bash":
      if (part.input?.command) {
        input = <CodeBlock code={part.input.command} language="bash" />
      }
      if (part.state === "output-available") {
        output = (
          <CodeBlock
            code={
              part.output.output ||
              `(no output, exit code ${part.output.exitCode})`
            }
            language="log"
          />
        )
      }
      break
    case "tool-viewScreen":
      input = <></>
      if (hasOutput) {
        output = (
          <p className="p-3 text-muted-foreground">
            Took a screenshot for its own use.
          </p>
        )
      }
      break
    case "tool-showScreen":
      input = <></>
      if (part.state === "output-available") {
        output = (
          <Image
            base64={part.output.base64}
            mediaType={part.output.mediaType}
            alt="The bot's screen"
          />
        )
      }
      break
    case "tool-handoff":
      if (part.state === "output-available") {
        title = `${title} → ${part.output.name}`
        output = (
          <p className="p-3 text-muted-foreground">
            {part.output.name} took over.
          </p>
        )
      }
      break
  }

  return (
    <Tool defaultOpen={part.type === "tool-showScreen"}>
      <ToolHeader type={part.type} state={part.state} title={title} />
      <ToolContent>
        {input}
        <ToolOutput output={output} errorText={errorText} />
      </ToolContent>
    </Tool>
  )
}

// Who wrote an assistant message in a group chat
function BotByline({ bot }: { bot: ChatBot | undefined }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium">
      {bot && <ChatAvatar seed={bot.avatar} className="size-5" />}
      <span className="truncate">{bot?.name ?? "Someone"}</span>
    </div>
  )
}

// bots: only for group chats, where the person picks which bot gets each message
export function Chat({
  chatId,
  bots,
  initialMessages,
}: {
  chatId: string
  bots?: ChatBot[]
  initialMessages: ChatUIMessage[]
}) {
  const router = useRouter()
  const [botId, setBotId] = useState(() => bots?.[0]?.id)
  const [transport] = useState(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        // The server keeps the history, so send only the new message and who it is for
        prepareSendMessagesRequest({ messages, id, body }) {
          return {
            body: {
              id,
              message: messages[messages.length - 1],
              botId: body?.botId,
            },
          }
        },
      })
  )

  const botsById = new Map(bots?.map((bot) => [bot.id, bot]))
  const botName = (id: string | undefined) =>
    (id && botsById.get(id)?.name) || "Someone"

  const { messages, sendMessage, status, stop } = useChat<ChatUIMessage>({
    id: chatId,
    messages: initialMessages,
    transport,
    onFinish: () => {
      // Refresh the sidebar's preview and order
      router.refresh()
    },
    onError: () => {
      toast.add({
        type: "error",
        title: "Couldn't get a reply",
        description: "Something went wrong. Try again.",
      })
    },
  })

  // Before the reply exists the last message is the user's; once it streams,
  // wait for its first text or tool, and again after each handoff
  const lastMessage = messages.at(-1)
  const lastSegment =
    lastMessage?.role === "assistant"
      ? segmentsOf(lastMessage).at(-1)
      : undefined
  const isThinking =
    status === "submitted" ||
    (status === "streaming" &&
      lastSegment !== undefined &&
      !hasVisibleParts(lastSegment.parts))

  // The bot the latest message went to is the one replying, until it hands off
  const replyingBotId =
    lastSegment?.botId ??
    messages.findLast((message) => message.role === "user")?.metadata?.botId

  function onSubmit({ text }: PromptInputMessage) {
    if (!text.trim()) return
    if (bots) {
      sendMessage({ text, metadata: { botId } }, { body: { botId } })
    } else {
      sendMessage({ text })
    }
  }

  return (
    <div data-slot="chat" className="flex min-h-0 flex-1 flex-col">
      <Conversation>
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {/* A reply stopped before it said or did anything is empty; don't leave an empty bubble */}
          {messages.filter(isVisible).flatMap((message) =>
            segmentsOf(message)
              .filter((segment) => hasVisibleParts(segment.parts))
              .map((segment, segmentIndex) => (
                <Message
                  key={`${message.id}-${segmentIndex}`}
                  from={message.role}
                >
                  {bots &&
                    (message.role === "assistant" ? (
                      <BotByline
                        bot={
                          segment.botId
                            ? botsById.get(segment.botId)
                            : undefined
                        }
                      />
                    ) : (
                      <span className="ml-auto text-xs text-muted-foreground">
                        to {botName(message.metadata?.botId)}
                      </span>
                    ))}
                  <MessageContent>
                    {segment.parts.map((part, index) =>
                      part.type === "text" ? (
                        <MessageResponse key={index}>
                          {part.text}
                        </MessageResponse>
                      ) : isToolPart(part) ? (
                        <ToolPartView key={part.toolCallId} part={part} />
                      ) : null
                    )}
                  </MessageContent>
                </Message>
              ))
          )}
          {isThinking && (
            <Message from="assistant">
              {bots && (
                <BotByline
                  bot={replyingBotId ? botsById.get(replyingBotId) : undefined}
                />
              )}
              <MessageContent className="flex-row items-center gap-2">
                <Spinner className="text-muted-foreground" />
                <span className="text-muted-foreground">Thinking…</span>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="mx-auto w-full max-w-3xl p-4 pt-0">
        <PromptInput onSubmit={onSubmit}>
          <PromptInputTextarea placeholder="Send a message..." />
          <PromptInputFooter className={bots ? undefined : "justify-end"}>
            {bots && (
              <PromptInputTools>
                <PromptInputSelect
                  items={bots.map((bot) => ({
                    label: bot.name,
                    value: bot.id,
                  }))}
                  value={botId}
                  onValueChange={(value) => {
                    if (typeof value === "string") setBotId(value)
                  }}
                >
                  <PromptInputSelectTrigger aria-label="Send to">
                    <PromptInputSelectValue>
                      {(value: string) => {
                        const bot = botsById.get(value)
                        return (
                          bot && (
                            <>
                              <ChatAvatar
                                seed={bot.avatar}
                                className="size-5"
                              />
                              <span className="truncate">{bot.name}</span>
                            </>
                          )
                        )
                      }}
                    </PromptInputSelectValue>
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    <SelectGroup>
                      {bots.map((bot) => (
                        <PromptInputSelectItem key={bot.id} value={bot.id}>
                          <ChatAvatar seed={bot.avatar} className="size-5" />
                          {bot.name}
                        </PromptInputSelectItem>
                      ))}
                    </SelectGroup>
                  </PromptInputSelectContent>
                </PromptInputSelect>
              </PromptInputTools>
            )}
            <PromptInputSubmit status={status} onStop={stop} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
