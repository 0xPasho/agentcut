"use client";

import { useId, useState } from "react";
import { format, parseISO } from "date-fns";
import { Clock3 } from "lucide-react";
import { Button } from "../../../common/ui/button";
import { Calendar } from "../../../common/ui/calendar";
import { DatePickerTrigger } from "../../../common/ui/date-picker";
import { Disclosure } from "../../../common/ui/disclosure";
import { Input } from "../../../common/ui/input";
import { Popover, PopoverContent } from "../../../common/ui/popover";
import { calendarTime } from "@agentcut/core/modules/publishing/lib/calendar";
import { dayInZone } from "@agentcut/core/modules/publishing/lib/resolve";
import { resolveTimeField, resolveTimeFieldTimestamp } from "@agentcut/core/modules/publishing/lib/time-field";

/** The calendar edits a draft; only Apply hands a validated instant to the shared commands. */
export function PublicationTimeField({
  value,
  onChange,
  timezone,
  label,
  disabled,
  clearable = true,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  timezone: string;
  label: string;
  disabled?: boolean;
  clearable?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [timestamp, setTimestamp] = useState("");
  const [error, setError] = useState("");
  let today: string | undefined;
  let savedDay = "";
  let savedTime = "";
  let timezoneError = "";
  try {
    today = dayInZone(new Date().toISOString(), timezone);
    if (value) {
      savedDay = dayInZone(value, timezone);
      savedTime = calendarTime(value, timezone);
    }
  } catch {
    timezoneError = "Enter a valid timezone before choosing a time.";
  }
  const commit = (exact = false) => {
    if (disabled) return;
    try {
      const next = exact
        ? resolveTimeFieldTimestamp(timestamp)
        : resolveTimeField(day, time, timezone, value);
      onChange(next);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="min-w-0 space-y-1 text-sm">
      <label htmlFor={id}>{label}</label>
      <Popover open={open && !disabled} onOpenChange={(next) => {
        if (next) {
          setDay(savedDay);
          setTime(savedTime);
          setTimestamp(value ?? "");
          setError("");
        }
        setOpen(next);
      }}>
        <DatePickerTrigger id={id} label={label} disabled={disabled}>
          {savedDay ? `${format(parseISO(savedDay), "MMM d, yyyy")} · ${savedTime}` : "Choose date and time"}
        </DatePickerTrigger>
        <PopoverContent side="bottom" className="w-min max-w-[calc(100vw-1rem)] space-y-3" aria-label={label}>
          <Calendar
            mode="single"
            required
            selected={day ? parseISO(day) : undefined}
            defaultMonth={parseISO(savedDay || today || format(new Date(), "yyyy-MM-dd"))}
            today={today ? parseISO(today) : undefined}
            autoFocus
            disabled={!!timezoneError || disabled}
            onSelect={(date) => { setDay(format(date, "yyyy-MM-dd")); setError(""); }}
          />
          <div className="space-y-3 border-t border-white/10 pt-3">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={`${id}-time`} className="flex items-center gap-2 text-sm">
                <Clock3 className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                Time
              </label>
              <Input
                id={`${id}-time`}
                type="time"
                value={time}
                disabled={disabled || !!timezoneError}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                className="w-32 tabular-nums scheme-dark"
                onChange={(e) => { setTime(e.target.value); setError(""); }}
              />
            </div>
            <p className="text-xs text-muted-foreground">All times in {timezone.replaceAll("_", " ")}.</p>
            {(error || timezoneError) && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error || timezoneError}</p>}
            <div className="flex justify-between gap-2">
              {clearable && <Button type="button" variant="ghost" disabled={disabled || !value} onClick={() => { onChange(null); setOpen(false); }}>Clear</Button>}
              <Button type="button" className="ms-auto" disabled={disabled || !!timezoneError} onClick={() => commit()}>Apply time</Button>
            </div>
          </div>
          <Disclosure summary="Enter an exact timestamp" variant="plain">
            <div className="space-y-2 pt-2">
              <label htmlFor={`${id}-timestamp`} className="text-xs text-muted-foreground">Timestamp with UTC offset</label>
              <Input
                id={`${id}-timestamp`}
                value={timestamp}
                placeholder="2026-10-01T18:00:00-06:00"
                disabled={disabled}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(e) => { setTimestamp(e.target.value); setError(""); }}
              />
              <Button type="button" variant="outline" disabled={disabled} onClick={() => commit(true)}>Apply timestamp</Button>
            </div>
          </Disclosure>
        </PopoverContent>
      </Popover>
    </div>
  );
}
