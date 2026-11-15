"use client"

import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Trash2Icon, UsersIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"

import {
  createGroupChat,
  deleteGroupChat,
  updateGroupChat,
} from "@/actions/chat"
import { ChatAvatar } from "@/components/chat-avatar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
  DialogTrigger,
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

// The group chat being edited
type EditedChat = { id: string; name: string | null; bots: { id: string }[] }

// bots: all of the user's bots, the ones that can be in the group.
// With chat it edits that chat, without it it creates one.
// With children it renders its own trigger and owns the open state;
// without children the parent controls it through open/onOpenChange.
export function GroupChatDialog({
  bots,
  chat,
  trigger = <Button variant="secondary" />,
  children,
  open: openProp,
  onOpenChange,
}: {
  bots: Bot[]
  chat?: EditedChat
  trigger?: React.ReactElement
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState

  function setOpen(next: boolean) {
    setOpenState(next)
    onOpenChange?.(next)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger render={trigger}>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {chat ? "Edit group chat" : "New group chat"}
          </DialogTitle>
          <DialogDescription>
            {chat
              ? "Rename it or change which bots are in it."
              : "Pick the bots that should be in it."}
          </DialogDescription>
        </DialogHeader>
        {/* Editing stays possible with fewer bots, so the group can still be deleted */}
        {!chat && bots.length < 2 ? (
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
          <GroupChatForm
            bots={bots}
            chat={chat}
            onSaved={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function GroupChatForm({
  bots,
  chat,
  onSaved,
}: {
  bots: Bot[]
  chat?: EditedChat
  onSaved: () => void
}) {
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(groupChatInsertSchema),
    defaultValues: {
      name: chat?.name ?? "",
      botIds: chat?.bots.map((bot) => bot.id) ?? [],
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (chat) {
        const updated = await updateGroupChat(chat.id, values)
        toast.add({ title: `${updated.name} is updated`, type: "success" })
        onSaved()
        // The chat picks up its new members and event lines
        router.refresh()
      } else {
        const created = await createGroupChat(values)
        toast.add({ title: `${created.name} is ready`, type: "success" })
        onSaved()
        router.push(`/chats/${created.id}`)
      }
    } catch {
      toast.add({
        title: chat ? "Couldn't update the group" : "Couldn't create the group",
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
        {chat && <GroupChatDeleteButton chat={chat} onDeleted={onSaved} />}
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner data-icon="inline-start" />}
          {chat ? "Save changes" : "Create group"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function GroupChatDeleteButton({
  chat,
  onDeleted,
}: {
  chat: EditedChat
  onDeleted: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const name = chat.name ?? "this group"

  async function onConfirm() {
    setIsDeleting(true)
    try {
      await deleteGroupChat(chat.id)
      toast.add({ title: `${name} is deleted`, type: "success" })
      setOpen(false)
      onDeleted()
      router.push("/")
    } catch {
      toast.add({
        title: "Couldn't delete the group",
        description: "Something went wrong. Try again.",
        type: "error",
      })
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Stay open while the delete is running
        if (!isDeleting) setOpen(next)
      }}
    >
      <AlertDialogTrigger
        render={
          <Button type="button" variant="destructive" className="sm:mr-auto" />
        }
      >
        <Trash2Icon data-icon="inline-start" />
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the group chat and its messages. The bots in it stay.
            It can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting && <Spinner data-icon="inline-start" />}
            Delete group
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
