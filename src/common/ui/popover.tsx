"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

/**
 * A popover is a panel, so it is padded like one: 12px inside a 24px corner, which
 * leaves a 12px inner radius for the fields and buttons that sit in it. Menus are the
 * exception — they pass `rounded-2xl p-1.5` and let their own items carry the padding,
 * because a menu row has to run the full width of the surface to be clickable.
 */
function PopoverContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  anchor,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        // Something other than the trigger to hang off: a popover opened from a menu
        // belongs beside the thing the menu was about, not beside the menu.
        anchor={anchor}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "relative isolate z-50 max-h-(--available-height) origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-3xl border border-transparent glass-surface backdrop-blur-[var(--glass-blur)] backdrop-saturate-[1.6] text-popover-foreground shadow-(--glass-shadow-raised) reduce-transparency:glass-flat reduce-transparency:bg-popover reduce-transparency:backdrop-blur-none more-contrast:glass-flat more-contrast:bg-popover more-contrast:border-foreground/60 p-3 duration-150 motion-reduce:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 motion-safe:data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 motion-safe:data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
