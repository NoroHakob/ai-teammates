"use client"

import type RFB from "@novnc/novnc"
import { RefreshCwIcon } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { getDesktopUrl } from "@/actions/chat"
import { AspectRatio } from "@/components/ui/aspect-ratio"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ResizableHandle, ResizablePanel } from "@/components/ui/resizable"
import { Spinner } from "@/components/ui/spinner"
import { usePaywall } from "@/hooks/use-paywall"
import { USAGE_LIMIT_ERROR } from "@/lib/billing"

type DesktopStatus = "idle" | "connecting" | "connected" | "disconnected"

type DesktopPanelContextValue = {
  open: boolean
  toggle: () => void
  status: DesktopStatus
  connect: () => void
  // Shows the screen in this slot; the returned function gives it back to the previous slot
  attachScreen: (slot: HTMLElement) => () => void
  setInteractive: (interactive: boolean) => void
}

const DesktopPanelContext = createContext<DesktopPanelContextValue | null>(null)

export function useDesktopPanel() {
  const context = useContext(DesktopPanelContext)
  if (!context) {
    throw new Error("useDesktopPanel must be used inside DesktopPanelProvider")
  }
  return context
}

export function DesktopPanelProvider({
  chatId,
  children,
}: {
  chatId: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<DesktopStatus>("idle")
  const { check, showUsageLimit } = usePaywall()

  // noVNC draws into this div. React never renders it; it is moved between
  // slots, so switching between the panel and fullscreen never reconnects.
  const screenRef = useRef<HTMLDivElement | null>(null)
  const slotsRef = useRef<HTMLElement[]>([])
  const rfbRef = useRef<RFB | null>(null)
  const attemptRef = useRef(0)
  const interactiveRef = useRef(false)

  const getScreen = useCallback(() => {
    if (!screenRef.current) {
      const screen = document.createElement("div")
      screen.style.width = "100%"
      screen.style.height = "100%"
      screenRef.current = screen
    }
    return screenRef.current
  }, [])

  const connect = useCallback(async () => {
    // Only the latest attempt may touch the status
    const attempt = ++attemptRef.current
    const isLatest = () => attempt === attemptRef.current

    rfbRef.current?.disconnect()
    rfbRef.current = null
    setStatus("connecting")

    try {
      const [url, { default: RFBClient }] = await Promise.all([
        getDesktopUrl(chatId),
        import("@novnc/novnc"),
      ])
      if (!isLatest()) return

      const rfb = new RFBClient(getScreen(), url)
      rfb.scaleViewport = true
      rfb.viewOnly = !interactiveRef.current
      rfb.addEventListener("connect", () => {
        if (isLatest()) setStatus("connected")
      })
      rfb.addEventListener("disconnect", () => {
        if (isLatest()) setStatus("disconnected")
      })
      rfbRef.current = rfb
    } catch (error) {
      // The URL is a credential and errors can carry it, so nothing is logged
      if (!isLatest()) return
      setStatus("disconnected")
      // Production hides server error messages, so this only matches in development
      if (error instanceof Error && error.message === USAGE_LIMIT_ERROR) {
        showUsageLimit()
      }
    }
  }, [chatId, getScreen, showUsageLimit])

  const toggle = useCallback(() => {
    const next = !open
    // Closing is always allowed; opening needs a sandbox
    if (next && !check("sandboxes")) return
    setOpen(next)
    // Connect on the first open; afterwards the connection outlives a hidden panel
    if (next && status === "idle") {
      void connect()
    }
  }, [open, status, connect, check])

  const attachScreen = useCallback(
    (slot: HTMLElement) => {
      slotsRef.current.push(slot)
      slot.appendChild(getScreen())
      return () => {
        slotsRef.current = slotsRef.current.filter((s) => s !== slot)
        slotsRef.current.at(-1)?.appendChild(getScreen())
      }
    },
    [getScreen]
  )

  const setInteractive = useCallback((interactive: boolean) => {
    interactiveRef.current = interactive
    if (rfbRef.current) {
      rfbRef.current.viewOnly = !interactive
    }
  }, [])

  useEffect(
    () => () => {
      attemptRef.current++
      rfbRef.current?.disconnect()
      rfbRef.current = null
    },
    []
  )

  const value = useMemo(
    () => ({
      open,
      toggle,
      status,
      connect: () => void connect(),
      attachScreen,
      setInteractive,
    }),
    [open, toggle, status, connect, attachScreen, setInteractive]
  )

  return (
    <DesktopPanelContext.Provider value={value}>
      {children}
    </DesktopPanelContext.Provider>
  )
}

function ScreenStatus({ status }: { status: DesktopStatus }) {
  if (status === "connected") return null
  return (
    <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
      {status === "disconnected" ? "Screen disconnected" : <Spinner />}
    </div>
  )
}

export function DesktopPanel({ name }: { name: string }) {
  const { open, status, connect, attachScreen, setInteractive } =
    useDesktopPanel()
  const [fullscreen, setFullscreen] = useState(false)
  const caption = `${name}'s screen`
  const connected = status === "connected"

  const panelSlotRef = useCallback(
    (slot: HTMLDivElement | null) => (slot ? attachScreen(slot) : undefined),
    [attachScreen]
  )

  // While the fullscreen slot exists the screen lives there and takes input
  const dialogSlotRef = useCallback(
    (slot: HTMLDivElement | null) => {
      if (!slot) return
      const detach = attachScreen(slot)
      setInteractive(true)
      return () => {
        setInteractive(false)
        detach()
      }
    },
    [attachScreen, setInteractive]
  )

  if (!open) return null

  return (
    <>
      <ResizableHandle withHandle />
      <ResizablePanel id="desktop" defaultSize="50%" minSize="20%">
        <div className="flex h-full flex-col">
          <div className="flex h-12 shrink-0 items-center justify-end border-b px-4">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Reconnect"
              disabled={status === "connecting"}
              onClick={connect}
            >
              <RefreshCwIcon />
            </Button>
          </div>
          <figure className="flex flex-col gap-2 p-4">
            <Dialog
              open={fullscreen}
              // Escape belongs to the desktop and outside clicks are easy to
              // make by accident, so only the close button closes it
              disablePointerDismissal
              onOpenChange={(next, details) => {
                if (!next && details.reason !== "close-press") {
                  details.cancel()
                  return
                }
                setFullscreen(next)
              }}
            >
              <AspectRatio
                ratio={4 / 3}
                className="relative overflow-hidden rounded-lg bg-muted"
              >
                <div ref={panelSlotRef} className="absolute inset-0" />
                {/* noVNC's canvas takes the pointer events, so the trigger sits on top of it */}
                {connected ? (
                  <DialogTrigger
                    aria-label={`Open ${caption} fullscreen`}
                    className="absolute inset-0 cursor-zoom-in rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                ) : (
                  <ScreenStatus status={status} />
                )}
              </AspectRatio>
              <DialogContent className="flex h-svh w-screen max-w-none flex-col rounded-none sm:max-w-none">
                <DialogHeader>
                  <DialogTitle>{caption}</DialogTitle>
                </DialogHeader>
                <div className="relative min-h-0 flex-1">
                  <div ref={dialogSlotRef} className="absolute inset-0" />
                  <ScreenStatus status={status} />
                </div>
              </DialogContent>
            </Dialog>
            <figcaption className="text-center text-sm text-muted-foreground">
              {caption}
            </figcaption>
          </figure>
        </div>
      </ResizablePanel>
    </>
  )
}
