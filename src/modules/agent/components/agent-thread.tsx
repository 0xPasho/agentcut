"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ChevronRight, Loader2 } from "lucide-react";
import { useStickToBottom } from "@/common/hooks/use-stick-to-bottom";
import { assetFileUrl, type LogEvent, type Message } from "@/common/api/client";
import { buildThread } from "@/modules/agent/lib/thread";
import { AgentLog, ActivityTail } from "./agent-log";
import { isActivity } from "../lib/agent-log";
import { Button } from "../../../common/ui/button";
import { Progress } from "../../../common/ui/progress";
import { SOURCE_LABELS } from "../data";
import { formatElapsed, took } from "../lib/agent-thread";

function UserMessage({ message }: { message: Message }) {
  const label = SOURCE_LABELS[message.source];
  const attachments = message.context?.attachments ?? [];
  return (
    <li className="flex flex-col items-end gap-1">
      {label ? <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span> : null}
      {/* What they dropped stays with what they said — a turn that reads "like this
          one" is meaningless a week later without the picture next to it. */}
      {attachments.length ? (
        <ul className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {attachments.map((a) => (
            <li key={a.id}>
              {a.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetFileUrl(a.id)} alt={a.name} title={a.name} className="size-16 rounded-lg border border-border object-cover" />
              ) : (
                <span className="flex items-center gap-1 rounded-lg border border-border bg-card/60 px-2 py-1 text-xs">
                  <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground uppercase">{a.kind}</span>
                  <span className="max-w-32 truncate">{a.name}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {message.text ? (
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap">
          {message.text}
        </div>
      ) : null}
    </li>
  );
}

function AgentMessage({ message, onUndo, busy }: { message: Message; onUndo?: (id: number) => void; busy?: boolean }) {
  const changes = message.changes;
  return (
    <li className="flex flex-col gap-1">
      <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-border bg-card/60 px-3 py-2 text-sm break-words whitespace-pre-wrap">
        {message.text}
      </div>
      {changes && changes.operations > 0 ? (
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{changes.operations} change{changes.operations === 1 ? "" : "s"} saved{changes.undone ? ", undone" : ""}</span>
          {!changes.undone && onUndo ? (
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => onUndo(message.id)}>Undo this turn</Button>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}

/**
 * What the run did, inside the turn. Collapsed it is one line — how many steps and
 * how long they took — because a finished turn is usually read for its result. Open,
 * it is the whole trail, and while the run is live it is open by default: waiting is
 * exactly when somebody wants to see it.
 */
function TurnSteps({ events, live }: { events: LogEvent[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const steps = useMemo(() => events.filter(isActivity), [events]);
  const shown = open || live;
  const last = steps[steps.length - 1] ?? events[events.length - 1];

  return (
    <li className="rounded-xl border border-border/60 bg-card/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={shown}
        className="flex w-full items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ChevronRight className={`size-3 shrink-0 transition-transform ${shown ? "rotate-90" : ""}`} aria-hidden />
        <span className="shrink-0">{steps.length || events.length} step{(steps.length || events.length) === 1 ? "" : "s"}</span>
        <span className="shrink-0 text-muted-foreground/60">· {formatElapsed(took(events))}</span>
        {!shown && last ? <span className="min-w-0 truncate font-mono text-muted-foreground/70">{last.name ? `${last.name} ` : ""}{last.text}</span> : null}
      </button>
      {shown ? <AgentLog events={events} className="h-44 border-t border-border/60" /> : null}
    </li>
  );
}

/** The run in progress: its stage, how long it has taken, and its last few steps. */
function Working({ events, label, stage, elapsed, progress, onStop, canStop }: {
  events: LogEvent[];
  label: string;
  stage?: string | null;
  elapsed: number;
  progress?: number;
  onStop?: () => void;
  canStop?: boolean;
}) {
  return (
    <li className="space-y-1.5 rounded-xl border border-border/60 bg-card/30 p-2.5" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 shrink-0 text-primary motion-safe:animate-spin" />
        <span className="font-medium text-foreground">{label}</span>
        {stage ? <span>· {stage}</span> : null}
        <span className="tabular-nums">· {formatElapsed(elapsed)}</span>
        {canStop && onStop ? <Button type="button" size="xs" variant="ghost" className="ml-auto" onClick={onStop}>Stop and unlock</Button> : null}
      </div>
      {progress ? <Progress value={Math.round(progress * 100)} className="gap-0" /> : null}
      {events.length ? <ActivityTail events={events} lines={5} /> : <p className="text-[11px] text-muted-foreground">Reading the project…</p>}
    </li>
  );
}

export function AgentThread({ messages, events, working, workingLabel, stage, elapsed, progress, onStop, canStop, onUndo, busy, interrupted, header, className = "h-[22rem]" }: {
  messages: Message[];
  events: LogEvent[];
  working: boolean;
  workingLabel: string;
  stage?: string | null;
  elapsed: number;
  progress?: number;
  onStop?: () => void;
  canStop?: boolean;
  onUndo?: (id: number) => void;
  busy?: boolean;
  /** The last turn was never answered and nothing is running: say so instead of spinning. */
  interrupted?: boolean;
  /** Anything that belongs above the first turn, e.g. the setup interview. */
  header?: React.ReactNode;
  className?: string;
}) {
  const items = useMemo(() => buildThread(messages, events), [messages, events]);
  // While a run is live its steps are the tail of the thread; they become an ordinary
  // collapsed group the moment it ends.
  const tail = items[items.length - 1];
  const liveEvents = working && tail?.kind === "steps" ? tail.events : [];
  const shown = liveEvents.length ? items.slice(0, -1) : items;
  const { ref, onScroll, atBottom, toBottom } = useStickToBottom<HTMLDivElement>(
    `${items.length}:${events.length}:${messages.length}:${working}`,
  );

  return (
    <div className="relative min-h-0">
      <div ref={ref} onScroll={onScroll} // A well, not a box: inside a card a hairline draws a second edge around the same
      // colour. The recess is what says the thread scrolls under the panel's own rim.
      className={`overflow-y-auto overscroll-contain rounded-xl bg-black/20 shadow-(--field-shadow) ${className}`}>
        <ol className="flex flex-col gap-2.5 p-3 text-sm">
          {header ? <li>{header}</li> : null}
          {!shown.length && !working ? (
            <li className="px-1 py-8 text-center text-xs text-muted-foreground">
              Ask for an edit and the agent works on this project — every step it takes shows up here.
            </li>
          ) : null}
          {shown.map((item) =>
            item.kind === "steps" ? (
              <TurnSteps key={item.id} events={item.events} />
            ) : item.message.role === "user" ? (
              <UserMessage key={`m${item.message.id}`} message={item.message} />
            ) : (
              <AgentMessage key={`m${item.message.id}`} message={item.message} onUndo={onUndo} busy={busy} />
            ),
          )}
          {working ? (
            <Working events={liveEvents} label={workingLabel} stage={stage} elapsed={elapsed} progress={progress} onStop={onStop} canStop={canStop} />
          ) : null}
          {interrupted && !working ? (
            <li className="text-[11px] text-muted-foreground">That run ended without a reply — the app closed or the process was stopped. Send it again to pick it up.</li>
          ) : null}
        </ol>
      </div>
      {!atBottom ? (
        <button
          type="button"
          onClick={toBottom}
          className="absolute right-3 bottom-2 flex items-center gap-1 rounded-full border border-border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
        >
          <ArrowDown className="size-3" />Latest
        </button>
      ) : null}
    </div>
  );
}
