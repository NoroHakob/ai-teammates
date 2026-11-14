"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { SearchIcon } from "lucide-react"
import { useRouter } from "next/navigation"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

// Lets an item close the dialog it is rendered in
const SearchCommandContext = createContext<{ close: () => void }>({
  close: () => {},
})

// Children are the SearchCommandItems, rendered by the server so the avatars stay out of the client bundle
export function SearchCommand({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key?.toLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            variant="outline"
            tooltip="Search"
            onClick={() => setOpen(true)}
            className="text-muted-foreground group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:text-sidebar-foreground group-data-[collapsible=icon]:shadow-none group-data-[collapsible=icon]:hover:bg-sidebar-accent"
          >
            <SearchIcon />
            <span>Search</span>
            <Kbd className="ml-auto">Ctrl K</Kbd>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search your chats"
      >
        <SearchCommandContext value={{ close: () => setOpen(false) }}>
          <Command>
            <CommandInput placeholder="Search chats..." />
            <CommandList>
              <CommandEmpty>No chats found.</CommandEmpty>
              <CommandGroup heading="Chats">{children}</CommandGroup>
            </CommandList>
          </Command>
        </SearchCommandContext>
      </CommandDialog>
    </>
  )
}

export function SearchCommandItem({
  href,
  ...props
}: React.ComponentProps<typeof CommandItem> & { href: string }) {
  const { close } = useContext(SearchCommandContext)
  const router = useRouter()

  return (
    <CommandItem
      {...props}
      onSelect={() => {
        close()
        router.push(href)
      }}
    />
  )
}
