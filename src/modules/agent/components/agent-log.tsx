"use client";

import { useEffect, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useStickToBottom } from "@/common/hooks/use-stick-to-bottom";
import type { LogEvent } from "@/common/api/client";
import { STYLES } from "../data";
import { time, isActivity } from "../lib/agent-log";

/**
 * One step of the run. A `Grep` whose pattern is cut off at the panel's edge says
 * nothing, so every line that does not fit opens in place — full text, wrapped and
 * selectable — and closes again.
 */
export function ActivityRow({ event, stamp = false }: { event: LogEvent; stamp?: boolean }) {
  const [open, setOpen] = useState(false);
  const style = STYLES[event.kind] ?? "text-muted-foreground";
  const body = (
    <>
      {stamp ? <span className="shrink-0 tabular-nums text-muted-foreground/50">{time(event.at)}</span> : null}
      {event.name ? (
        <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] leading-5 text-muted-foreground">{event.name}</span>
      ) : null}
      <span className={`min-w-0 flex-1 ${style} ${open ? "break-all whitespace-pre-wrap" : "truncate"}`}>{event.text}</span>
    </>
  );
  // Short lines are already whole: no affordance to click, nothing to open.
  if (event.text.length < 64 && !event.text.includes("\n")) return <li className="flex gap-2 leading-relaxed">{body}</li>;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "Show less" : "Show the whole line"}
        className="flex w-full select-text gap-2 rounded text-left leading-relaxed hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {body}
      </button>
    </li>
  );
}

/** The whole stream, scrollable, following the newest line unless you scrolled away. */
export function AgentLog({ events, className = "h-64" }: { events: LogEvent[]; className?: string }) {
  const { ref, onScroll, atBottom, toBottom } = useStickToBottom<HTMLDivElement>(events.length);
  // Opening the panel starts at the newest line, wherever the list was left.
  useEffect(() => { toBottom(); }, [toBottom]);

  if (!events.length) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        The agent&apos;s tool calls and reasoning will stream here.
      </p>
    );
  }

  return (
    <div className="relative">
      <div ref={ref} onScroll={onScroll} className={`overflow-y-auto overscroll-contain ${className}`}>
        <ol className="flex flex-col gap-1 p-3 font-mono text-xs">
          {events.map((e) => <ActivityRow key={e.id} event={e} stamp />)}
        </ol>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={toBottom}
          className="absolute right-3 bottom-2 flex items-center gap-1 rounded-full border border-border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
        >
          <ArrowDown className="size-3" />Latest
        </button>
      )}
    </div>
  );
}

/** The last few lines of the run, the way a terminal shows the tail of a task. */
export function ActivityTail({ events, lines = 4 }: { events: LogEvent[]; lines?: number }) {
  const shown = events.filter(isActivity).slice(-lines);
  if (!shown.length) return null;
  return (
    <ol className="space-y-0.5 font-mono text-[11px] leading-relaxed">
      {shown.map((e) => <ActivityRow key={e.id} event={e} />)}
    </ol>
  );
}
