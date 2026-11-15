"use client"

import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { ShuffleIcon, Trash2Icon } from "lucide-react"
import { nanoid } from "nanoid"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"

import { createBot, deleteBot, updateBot } from "@/actions/bot"
import { usePaywall } from "@/hooks/use-paywall"
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
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { botInsertSchema, type Bot } from "@/db/schema"

const presets = [
  {
    job: "Research assistant",
    instructions:
      "Find reliable sources, summarize what they say, and cite every claim. Say so when the evidence is thin.",
  },
  {
    job: "Code reviewer",
    instructions:
      "Review changes for bugs, security issues, and unclear code. Point to the exact lines and suggest a fix.",
  },
  {
    job: "Writing editor",
    instructions:
      "Tighten prose without changing its voice. Explain each edit briefly and flag anything ambiguous.",
  },
  {
    job: "Tutor",
    instructions:
      "Teach step by step, check understanding with questions, and give hints before giving answers.",
  },
]

// With children it renders its own trigger and owns the open state;
// without children the parent controls it through open/onOpenChange.
export function BotDialog({
  bot,
  trigger = <Button variant="secondary" />,
  children,
  open: openProp,
  onOpenChange,
}: {
  bot?: Bot
  trigger?: React.ReactElement
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const { check } = usePaywall()

  function setOpen(next: boolean) {
    // A new bot comes with a sandbox, so it needs both; editing stays free.
    // A parent that controls open (the create menu) checks before opening.
    if (next && !bot && !(check("bots") && check("sandboxes"))) return
    setOpenState(next)
    onOpenChange?.(next)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger render={trigger}>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{bot ? "Edit bot" : "New bot"}</DialogTitle>
          <DialogDescription>
            {bot
              ? "Change its face, its name, or the job it does."
              : "Give it a face, a name, and a job to do."}
          </DialogDescription>
        </DialogHeader>
        <BotForm bot={bot} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function BotForm({ bot, onSaved }: { bot?: Bot; onSaved: () => void }) {
  const [initialAvatar] = useState(() => bot?.avatar ?? nanoid())

  const form = useForm({
    resolver: zodResolver(botInsertSchema),
    defaultValues: {
      name: bot?.name ?? "",
      avatar: initialAvatar,
      job: bot?.job ?? "",
      instructions: bot?.instructions ?? "",
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (bot) {
        const updated = await updateBot(bot.id, values)
        toast.add({ title: `${updated.name} is updated`, type: "success" })
      } else {
        const created = await createBot(values)
        toast.add({ title: `${created.name} is ready`, type: "success" })
      }
      onSaved()
    } catch {
      toast.add({
        title: bot ? "Couldn't update the bot" : "Couldn't create the bot",
        description: "Something went wrong. Try again.",
        type: "error",
      })
    }
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.job}
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => {
              const options = { shouldDirty: true, shouldValidate: true }
              form.setValue("job", preset.job, options)
              form.setValue("instructions", preset.instructions, options)
            }}
          >
            {preset.job}
          </Button>
        ))}
      </div>
      <FieldGroup>
        <Controller
          name="avatar"
          control={form.control}
          render={({ field }) => (
            <Field orientation="horizontal">
              <ChatAvatar seed={field.value ?? ""} className="size-10" />
              <FieldContent>
                <FieldTitle>Face</FieldTitle>
                <FieldDescription>
                  Shuffle until you find one you like.
                </FieldDescription>
              </FieldContent>
              <Button
                type="button"
                variant="outline"
                onClick={() => field.onChange(nanoid())}
              >
                <ShuffleIcon data-icon="inline-start" />
                Shuffle
              </Button>
            </Field>
          )}
        />
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="bot-name">Name</FieldLabel>
              <Input
                {...field}
                id="bot-name"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="job"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="bot-job">Job</FieldLabel>
              <Input
                {...field}
                id="bot-job"
                placeholder="Research assistant"
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="instructions"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="bot-instructions">
                How it should work
              </FieldLabel>
              <Textarea
                {...field}
                value={field.value ?? ""}
                id="bot-instructions"
                className="min-h-24"
                placeholder="Answer briefly, cite sources, and ask before running anything destructive."
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>
      <DialogFooter>
        {bot && <BotDeleteButton bot={bot} onDeleted={onSaved} />}
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner data-icon="inline-start" />}
          {bot ? "Save changes" : "Create bot"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function BotDeleteButton({
  bot,
  onDeleted,
}: {
  bot: Bot
  onDeleted: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  async function onConfirm() {
    setIsDeleting(true)
    try {
      await deleteBot(bot.id)
      toast.add({ title: `${bot.name} is deleted`, type: "success" })
      setOpen(false)
      onDeleted()
      router.push("/")
    } catch {
      toast.add({
        title: "Couldn't delete the bot",
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
          <AlertDialogTitle>Delete {bot.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the bot and your chat with it. It can&apos;t be undone.
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
            Delete bot
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
