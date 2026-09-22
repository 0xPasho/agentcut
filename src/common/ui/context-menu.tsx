"use client"

import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { Check } from "lucide-react"
import { cn } from "cn"

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger

/** The same material as Select's popup, so every floating surface reads as one system. */
function ContextMenuContent({ className, children, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none" collisionAvoidance={{ side: "flip", align: "shift" }} collisionPadding={12}>
        <MenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "relative isolate z-50 min-w-48 origin-(--transform-origin) overflow-hidden rounded-2xl border border-transparent glass-surface backdrop-blur-[var(--glass-blur)] backdrop-saturate-[1.6] p-1 text-popover-foreground shadow-(--glass-shadow-raised) outline-none reduce-transparency:glass-flat reduce-transparency:bg-popover reduce-transparency:backdrop-blur-none more-contrast:glass-flat more-contrast:bg-popover more-contrast:border-foreground/60 duration-150 motion-reduce:animate-none motion-safe:data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 motion-safe:data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({ className, shortcut, children, ...props }: MenuPrimitive.Item.Props & { shortcut?: string }) {
  return (
    <MenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-xl px-2.5 py-2 text-sm outline-hidden select-none data-highlighted:bg-white/12 data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className="flex flex-1 items-center gap-2 whitespace-nowrap">{children}</span>
      {shortcut ? <span className="text-[11px] tracking-wide text-muted-foreground">{shortcut}</span> : null}
    </MenuPrimitive.Item>
  )
}

/** A heading for the menu, not a group part: Base UI's GroupLabel requires a Menu.Group parent. */
function ContextMenuLabel({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="context-menu-label" className={cn("truncate px-2.5 py-1.5 text-xs text-muted-foreground", className)} {...props} />
}

function ContextMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return <MenuPrimitive.Separator data-slot="context-menu-separator" className={cn("my-1 h-px bg-white/10", className)} {...props} />
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator }

/** The same popup, opened from a control instead of a right-click, so it is keyboard-reachable. */
const Menu = MenuPrimitive.Root
const MenuTrigger = MenuPrimitive.Trigger

function MenuContent({ className, children, side = "bottom", align = "start", ...props }: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, "side" | "align">) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner side={side} align={align} sideOffset={6} collisionPadding={12} className="isolate z-50 outline-none">
        <MenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "relative isolate z-50 min-w-48 origin-(--transform-origin) overflow-hidden rounded-2xl border border-transparent glass-surface backdrop-blur-[var(--glass-blur)] backdrop-saturate-[1.6] p-1 text-popover-foreground shadow-(--glass-shadow-raised) outline-none reduce-transparency:glass-flat reduce-transparency:bg-popover reduce-transparency:backdrop-blur-none more-contrast:glass-flat more-contrast:bg-popover more-contrast:border-foreground/60 duration-150 motion-reduce:animate-none motion-safe:data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 motion-safe:data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

/**
 * A set of choices where exactly one is current — a transition's kind, its length.
 *
 * The platform's own radio semantics rather than a colour: `aria-checked` says which
 * one is on, and the indicator says it again in ink for everyone who is not listening.
 */
const MenuRadioGroup = MenuPrimitive.RadioGroup

function MenuRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-xl py-2 pr-2.5 pl-8 text-sm outline-hidden select-none data-highlighted:bg-white/12 data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <MenuPrimitive.RadioItemIndicator className="absolute left-2.5 flex items-center justify-center text-primary">
        <Check className="size-3.5" />
      </MenuPrimitive.RadioItemIndicator>
      <span className="flex flex-1 items-center gap-2 whitespace-nowrap">{children}</span>
    </MenuPrimitive.RadioItem>
  )
}

export { Menu, MenuTrigger, MenuContent, MenuRadioGroup, MenuRadioItem }
