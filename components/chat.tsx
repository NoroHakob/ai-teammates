"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useRouter } from "next/navigation"
import { useState } from "react"

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
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import type { ChatUIMessage } from "@/lib/sandbox-tools"

type ChatPart = ChatUIMessage["parts"][number]
type ChatToolPart = Extract<ChatPart, { type: `tool-${string}` }>

function isToolPart(part: ChatPart): part is ChatToolPart {
  return part.type.startsWith("tool-")
}

// Something to show: text it said or a tool it used
function isVisible(message: ChatUIMessage) {
  return message.parts.some(
    (part) =>
      (part.type === "text" && part.text.trim() !== "") || isToolPart(part)
  )
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
}

function ToolPartView({ part }: { part: ChatToolPart }) {
  const hasOutput = part.state === "output-available"
  const errorText = part.state === "output-error" ? part.errorText : undefined

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
  }

  return (
    <Tool defaultOpen={part.type === "tool-showScreen"}>
      <ToolHeader
        type={part.type}
        state={part.state}
        title={toolTitles[part.type]}
      />
      <ToolContent>
        {input}
        <ToolOutput output={output} errorText={errorText} />
      </ToolContent>
    </Tool>
  )
}

export function Chat({
  chatId,
  initialMessages,
}: {
  chatId: string
  initialMessages: ChatUIMessage[]
}) {
  const router = useRouter()
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        // The server keeps the history, so send only the new message
        prepareSendMessagesRequest({ messages, id }) {
          return { body: { id, message: messages[messages.length - 1] } }
        },
      })
  )

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

  // Before the reply exists the last message is the user's; once it streams, wait for its first text or tool
  const lastMessage = messages.at(-1)
  const isThinking =
    status === "submitted" ||
    (status === "streaming" &&
      lastMessage?.role === "assistant" &&
      !isVisible(lastMessage))

  function onSubmit({ text }: PromptInputMessage) {
    if (!text.trim()) return
    sendMessage({ text })
  }

  return (
    <div data-slot="chat" className="flex min-h-0 flex-1 flex-col">
      <Conversation>
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {/* A reply stopped before it said or did anything is empty; don't leave an empty bubble */}
          {messages.filter(isVisible).map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent>
                {message.parts.map((part, index) =>
                  part.type === "text" ? (
                    <MessageResponse key={index}>{part.text}</MessageResponse>
                  ) : isToolPart(part) ? (
                    <ToolPartView key={part.toolCallId} part={part} />
                  ) : null
                )}
              </MessageContent>
            </Message>
          ))}
          {isThinking && (
            <Message from="assistant">
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
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status} onStop={stop} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
