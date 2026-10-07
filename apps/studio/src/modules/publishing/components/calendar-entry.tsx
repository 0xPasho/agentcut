"use client";
import { CalendarArrowUp, Film, GripVertical } from "lucide-react";
import { cn } from "cn";
import { Button } from "../../../common/ui/button";
import type {
  CalendarDrag,
  PublicationDetail,
  PublishingOverview,
} from "@agentcut/core/modules/publishing/types";
import { CALENDAR_DRAG_TYPE, NETWORK_LABELS } from "@agentcut/core/modules/publishing/data";
import {
  calendarDestinations,
  calendarInstant,
  calendarTime,
} from "@agentcut/core/modules/publishing/lib/calendar";
import { NetworkIcon } from "./network-icon";
import { PublicationStatusBadge } from "./status";

export function CalendarEntry({
  publication: p,
  date,
  data,
  onOpen,
  onMove,
  onDrag,
  account = "",
  compact = false,
  busy,
}: {
  compact?: boolean;
  publication: PublicationDetail;
  date: string | null;
  data: PublishingOverview;
  account?: string;
  busy: boolean;
  onOpen: () => void;
  onMove: (ids: string[]) => void;
  onDrag: (drag: CalendarDrag | null) => void;
}) {
  const destinations = calendarDestinations(
    p,
    date,
    data.settings.timezone,
    account,
  );
  const group =
    destinations.length > 0 &&
    destinations.every((d) => ["not_sent", "failed"].includes(d.state));
  const draggable =
    group ||
    (destinations.length === 1 && destinations[0].state === "scheduled");
  const ids = destinations.map((d) => d.id);
  return (
    <article
      aria-label={p.label}
      draggable={draggable && !busy}
      onDragStart={(e) => {
        if (!draggable || busy) {
          e.preventDefault();
          return;
        }
        const drag = {
          publicationId: p.id,
          revision: p.revision,
          destinationIds: ids,
        };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(CALENDAR_DRAG_TYPE, JSON.stringify(drag));
        onDrag(drag);
      }}
      onDragEnd={() => onDrag(null)}
      className={cn(
        "min-w-0 rounded-xl bg-foreground/[0.055] p-2 ring-1 ring-foreground/5",
        draggable && !busy && "cursor-grab active:cursor-grabbing",
      )}
    >
      <button
        className="flex min-h-8 w-full items-start gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring"
        onClick={onOpen}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/30",
            compact ? "size-6" : "size-8",
          )}
        >
          {p.artifact ? (
            <video
              src={`/api/publishing/artifact/${p.artifact.id}#t=0.1`}
              preload="metadata"
              muted
              playsInline
              aria-hidden
              className="size-full object-cover"
            />
          ) : (
            <Film className="size-4 text-muted-foreground" aria-hidden />
          )}
        </span>
        <span
          title={p.label}
          className={cn(
            "min-w-0 break-words text-xs font-medium leading-snug",
            compact && "line-clamp-2",
          )}
        >
          {p.label}
        </span>
      </button>
      <div className="mt-2">
        <PublicationStatusBadge status={p.status} />
      </div>
      <div className="mt-2 space-y-1">
        {destinations.map((d) => {
          const a = data.accounts.find((a) => a.id === d.accountId);
          const at = calendarInstant(p, d);
          const movable = ["not_sent", "failed", "scheduled"].includes(d.state);
          return (
            <div
              key={d.id}
              className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
            >
              {a && (
                <span
                  className="flex min-w-0 items-center gap-1"
                  title={a.name}
                >
                  <NetworkIcon
                    network={a.network}
                    className="size-3.5 shrink-0"
                  />
                  <span className={compact ? "sr-only" : "min-w-0 break-words"}>
                    {a.name} · {NETWORK_LABELS[a.network]}
                  </span>
                </span>
              )}
              {at && (
                <span className="tabular-nums">
                  {calendarTime(at, data.settings.timezone)}
                </span>
              )}
              {!group && movable && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Move ${p.label} for ${a?.name ?? "account"}`}
                  onClick={() => onMove([d.id])}
                >
                  <CalendarArrowUp className="size-3.5" aria-hidden />
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {group && (
        <div className="mt-1 flex items-center justify-between gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            className="min-h-8 px-1 text-xs"
            aria-label={`Move ${p.label}`}
            onClick={() => onMove(ids)}
          >
            <CalendarArrowUp className="size-3.5" aria-hidden />
            {date ? "Move" : "Choose day"}
          </Button>
          <GripVertical
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </div>
      )}
    </article>
  );
}
