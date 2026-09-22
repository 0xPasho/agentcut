"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "cn";

/**
 * A tick box with its word beside it.
 *
 * The real `<input type="checkbox">` is still the control — visually hidden, not
 * hidden from the keyboard or a screen reader — so Space, the label, the focus ring
 * and the form all behave natively. Only the box is ours, because the platform one is
 * a light-mode square that no dark surface can absorb, and `accent-color` cannot give
 * it a radius or a border.
 *
 * The same box as `<Toggle>`'s switch, for the same reason: on and off are a colour
 * *and* a mark, never colour alone.
 */
export function Checkbox({
  checked,
  onCheckedChange,
  children,
  className,
  boxClassName,
  disabled,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "checked" | "onChange" | "children"> & {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** The visible word. A box with nothing beside it says nothing. */
  children?: React.ReactNode;
  boxClassName?: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
        {...props}
      />
      <span
        aria-hidden
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-[6px] bg-black/25 text-transparent ring-1 ring-foreground/25 shadow-(--field-shadow) transition-colors duration-150",
          "peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:ring-primary",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring motion-reduce:transition-none",
          boxClassName,
        )}
      >
        <Check className="size-3 stroke-[3]" />
      </span>
      {children ? <span className="min-w-0">{children}</span> : null}
    </label>
  );
}
