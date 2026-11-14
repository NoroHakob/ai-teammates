"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { useRouter } from "next/navigation"
import { useState } from "react"

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
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
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"

function hasVisibleText(message: UIMessage) {
  return message.parts.some(
    (part) => part.type === "text" && part.text.trim() !== ""
  )
}

export function Chat({
  chatId,
  initialMessages,
}: {
  chatId: string
  initialMessages: UIMessage[]
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

  const { messages, sendMessage, status, stop } = useChat({
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

  // Before the reply exists the last message is the user's; once it streams, wait for its first text
  const lastMessage = messages.at(-1)
  const isThinking =
    status === "submitted" ||
    (status === "streaming" &&
      lastMessage?.role === "assistant" &&
      !hasVisibleText(lastMessage))

  function onSubmit({ text }: PromptInputMessage) {
    if (!text.trim()) return
    sendMessage({ text })
  }

  return (
    <div data-slot="chat" className="flex min-h-0 flex-1 flex-col">
      <Conversation>
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {/* A reply stopped before it said anything has no text; don't leave an empty bubble */}
          {messages.filter(hasVisibleText).map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent>
                {message.parts.map((part, index) =>
                  part.type === "text" ? (
                    <MessageResponse key={index}>{part.text}</MessageResponse>
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
