import { cn } from "cn"

import { ChatAvatar } from "@/components/chat-avatar"

// Several bot faces in the square one ChatAvatar takes:
// 2 overlap side by side, 3 form a triangle, 4+ fill a 2x2 grid with "+N" last
export function GroupChatAvatar({
  seeds,
  className,
}: {
  seeds: string[]
  className?: string
}) {
  if (seeds.length <= 1) {
    return <ChatAvatar seed={seeds[0] ?? ""} className={className} />
  }

  if (seeds.length === 2) {
    return (
      <div
        data-slot="group-chat-avatar"
        className={cn("relative size-8 shrink-0", className)}
      >
        <ChatAvatar
          seed={seeds[0]}
          className="absolute top-0 left-0 size-[65%]"
        />
        <ChatAvatar
          seed={seeds[1]}
          className="absolute right-0 bottom-0 size-[65%]"
        />
      </div>
    )
  }

  if (seeds.length === 3) {
    return (
      <div
        data-slot="group-chat-avatar"
        className={cn("relative size-8 shrink-0", className)}
      >
        <ChatAvatar
          seed={seeds[0]}
          className="absolute top-0 left-1/2 size-1/2 -translate-x-1/2"
        />
        <ChatAvatar
          seed={seeds[1]}
          className="absolute bottom-0 left-0 size-1/2"
        />
        <ChatAvatar
          seed={seeds[2]}
          className="absolute right-0 bottom-0 size-1/2"
        />
      </div>
    )
  }

  const extra = seeds.length - 3

  return (
    <div
      data-slot="group-chat-avatar"
      className={cn("grid size-8 shrink-0 grid-cols-2 grid-rows-2", className)}
    >
      {seeds.slice(0, 3).map((seed, index) => (
        <ChatAvatar key={index} seed={seed} className="size-full" />
      ))}
      {extra === 1 ? (
        <ChatAvatar seed={seeds[3]} className="size-full" />
      ) : (
        <span className="flex items-center justify-center overflow-hidden rounded-sm bg-muted text-[0.5rem] leading-none font-medium text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  )
}
