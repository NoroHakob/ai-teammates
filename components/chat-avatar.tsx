import { Avatar, Style } from "@dicebear/core"
import definition from "@dicebear/styles/gaze.json" with { type: "json" }
import Image from "next/image"
import { cn } from "cn"

const style = new Style(definition)

export function ChatAvatar({
  seed,
  animated,
  className,
}: {
  seed: string
  animated?: boolean
  className?: string
}) {
  const avatar = new Avatar(style, {
    seed,
    ...(animated && { tags: ["animation"] }),
  })

  return (
    <Image
      src={avatar.toDataUri()}
      alt=""
      width={32}
      height={32}
      unoptimized
      data-slot="chat-avatar"
      className={cn("size-8 shrink-0", className)}
    />
  )
}
