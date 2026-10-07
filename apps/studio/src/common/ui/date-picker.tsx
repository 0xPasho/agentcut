"use client";

import { useState, type ComponentProps } from "react";
import { format, isValid, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import { cn } from "cn";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export function DatePickerTrigger({
  label,
  children,
  className,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <PopoverTrigger
      render={
        <Button
          type="button"
          variant="outline"
          static
          aria-label={`${label}: ${children}`}
          className={cn("w-full min-w-0 justify-between gap-3 font-normal", className)}
          {...props}
        />
      }
    >
      <span className="truncate tabular-nums">{children}</span>
      <CalendarDays className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
    </PopoverTrigger>
  );
}

/** Civil dates stay civil: never pass a date-only value through UTC serialization. */
export function DatePicker({
  value,
  onChange,
  label,
  today,
  id,
  disabled,
  className,
  align = "start",
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  today?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const parsed = parseISO(value);
  const selected = isValid(parsed) ? parsed : undefined;
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <DatePickerTrigger id={id} label={label} disabled={disabled} className={className}>
        {selected ? format(selected, "MMM d, yyyy") : "Choose date"}
      </DatePickerTrigger>
      <PopoverContent side="bottom" align={align} className="w-auto max-w-[calc(100vw-1rem)]" aria-label={label}>
        <Calendar
          mode="single"
          required
          selected={selected}
          defaultMonth={selected}
          today={today ? parseISO(today) : undefined}
          autoFocus
          onSelect={(date) => {
            onChange(format(date, "yyyy-MM-dd"));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
