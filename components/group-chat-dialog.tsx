"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { UsersIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"

import { createGroupChat } from "@/actions/chat"
import { ChatAvatar } from "@/components/chat-avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { groupChatInsertSchema, type Bot } from "@/db/schema"

// Opened from the create menu, so the parent controls it through open/onOpenChange
export function GroupChatDialog({
  bots,
  open,
  onOpenChange,
}: {
  bots: Bot[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New group chat</DialogTitle>
          <DialogDescription>
            Pick the bots that should be in it.
          </DialogDescription>
        </DialogHeader>
        {bots.length < 2 ? (
          <>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersIcon />
                </EmptyMedia>
                <EmptyDescription>
                  You need at least two bots for a group.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Close
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <GroupChatForm bots={bots} onCreated={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function GroupChatForm({
  bots,
  onCreated,
}: {
  bots: Bot[]
  onCreated: () => void
}) {
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(groupChatInsertSchema),
    defaultValues: {
      name: "",
      botIds: [] as string[],
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const chat = await createGroupChat(values)
      toast.add({ title: `${chat.name} is ready`, type: "success" })
      onCreated()
      router.push(`/chats/${chat.id}`)
    } catch {
      toast.add({
        title: "Couldn't create the group",
        description: "Something went wrong. Try again.",
        type: "error",
      })
    }
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="group-chat-name">Name</FieldLabel>
              <Input
                {...field}
                value={field.value ?? ""}
                id="group-chat-name"
                autoComplete="off"
                placeholder="Launch team"
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="botIds"
          control={form.control}
          render={({ field, fieldState }) => (
            <FieldSet data-invalid={fieldState.invalid}>
              <FieldLegend variant="label">Bots</FieldLegend>
              <FieldGroup className="gap-3">
                {bots.map((bot) => {
                  const id = `group-chat-bot-${bot.id}`
                  return (
                    <Field
                      key={bot.id}
                      orientation="horizontal"
                      data-invalid={fieldState.invalid}
                    >
                      <Checkbox
                        id={id}
                        name={field.name}
                        checked={field.value.includes(bot.id)}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked
                              ? [...field.value, bot.id]
                              : field.value.filter((botId) => botId !== bot.id)
                          )
                        }
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldLabel htmlFor={id} className="font-normal">
                        <ChatAvatar seed={bot.avatar} className="size-6" />
                        <span className="truncate">{bot.name}</span>
                      </FieldLabel>
                    </Field>
                  )
                })}
              </FieldGroup>
              <FieldError errors={[fieldState.error]} />
            </FieldSet>
          )}
        />
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner data-icon="inline-start" />}
          Create group
        </Button>
      </DialogFooter>
    </form>
  )
}
