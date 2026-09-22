"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Download, Film, SlidersHorizontal, Trash2 } from "lucide-react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/common/ui/button";
import { clipUrl, thumbUrl } from "@/common/api/client";
import { count, runtime } from "@/common/lib/format";
import type { ProjectVideo } from "@/modules/project/lib/overview";
import type { SequenceStatus } from "@/modules/plan/types";

/**
 * Status reads as a dot plus its word, never as a colour on its own: four states
 * told apart by hue alone are four states nobody can tell apart.
 */
export const STATUS: Record<SequenceStatus, { label: string; dot: string }> = {
  pending: { label: "Pending", dot: "bg-transparent ring-1 ring-inset ring-muted-foreground" },
  edited: { label: "Edited", dot: "bg-muted-foreground" },
  approved: { label: "Approved", dot: "bg-primary" },
  rendered: { label: "Rendered", dot: "bg-primary" },
};

export function StatusDot({ status }: { status: SequenceStatus }) {
  if (status === "rendered") return <Check aria-hidden className="size-3 text-primary" />;
  return <span aria-hidden className={cn("size-2 rounded-full", STATUS[status].dot)} />;
}

export type ClipListHandlers = {
  onSelect: (id: string) => void;
  onOpen: (video: ProjectVideo) => (event: React.MouseEvent) => void;
  onApprove: (video: ProjectVideo) => void;
  onDelete: (video: ProjectVideo) => void;
  href: (video: ProjectVideo) => string;
};

/**
 * Forty candidates, ranked.
 *
 * Rows, not a grid of posters: at this count the decision is "which of these is worth
 * my time", and that is read down a column of scores and titles, not across ten rows
 * of tall pictures. The one vertical thing on the screen is the preview beside it —
 * showing the same shape twice bought nothing and cost five screens of scrolling.
 */
export function ClipList({
  videos,
  projectId,
  revision,
  selectedId,
  rendered,
  handlers,
}: {
  videos: ProjectVideo[];
  projectId: string;
  revision: number;
  selectedId: string | null;
  rendered: string[];
  handlers: ClipListHandlers;
}) {
  const list = useRef<HTMLUListElement>(null);

  // Arrows walk the list and Tab leaves it: one stop for forty rows, the way every
  // other list of this shape behaves.
  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const index = videos.findIndex((v) => v.id === selectedId);
    if (index < 0) return;
    const next =
      event.key === "ArrowDown" ? Math.min(videos.length - 1, index + 1)
      : event.key === "ArrowUp" ? Math.max(0, index - 1)
      : event.key === "Home" ? 0
      : videos.length - 1;
    if (next === index) return;
    event.preventDefault();
    handlers.onSelect(videos[next].id);
    list.current?.querySelectorAll<HTMLButtonElement>("[data-row]")[next]?.focus();
  };

  return (
    <ul ref={list} onKeyDown={onKeyDown} className="flex flex-col gap-1">
      {videos.map((video) => (
        <ClipRow
          key={video.id}
          video={video}
          projectId={projectId}
          revision={revision}
          selected={video.id === selectedId}
          rendered={rendered.includes(video.id)}
          handlers={handlers}
        />
      ))}
    </ul>
  );
}

function ClipRow({
  video,
  projectId,
  revision,
  selected,
  rendered,
  handlers,
}: {
  video: ProjectVideo;
  projectId: string;
  revision: number;
  selected: boolean;
  rendered: boolean;
  handlers: ClipListHandlers;
}) {
  const [poster, setPoster] = useState(true);
  const row = useRef<HTMLLIElement>(null);
  const status = STATUS[video.status];
  const approved = video.status === "approved" || video.status === "rendered";

  // Arrowing past the edge of the pane has to bring the row with it.
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <li
      ref={row}
      className={cn(
        "group/row relative flex items-center gap-3 rounded-2xl p-2 transition-colors duration-150 ease-out motion-reduce:transition-none",
        selected ? "bg-white/8 ring-1 ring-inset ring-primary/50" : "hover:bg-white/5",
      )}
    >
      <button
        data-row
        type="button"
        tabIndex={selected ? 0 : -1}
        aria-pressed={selected}
        onClick={() => handlers.onSelect(video.id)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex w-9 shrink-0 flex-col items-center gap-1.5">
          <span className={cn("text-base leading-none font-semibold tabular-nums", video.score === null && "text-muted-foreground")}>
            {video.score ?? "–"}
          </span>
          {video.score !== null && (
            // Neutral, not accent: the accent means "interactive" everywhere else on
            // this screen, and a score is not something you can click.
            <span aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-white/12">
              <span className="block h-full rounded-full bg-white/65" style={{ width: `${video.score}%` }} />
            </span>
          )}
        </span>

        <span className="relative h-[70px] w-10 shrink-0 overflow-hidden rounded-lg bg-black ring-1 ring-foreground/10">
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbUrl(projectId, video.id, revision)}
              alt=""
              loading="lazy"
              onError={() => setPoster(false)}
              className="size-full object-cover"
            />
          ) : (
            <span className="flex size-full items-center justify-center">
              <Film aria-hidden className="size-4 text-muted-foreground" />
            </span>
          )}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-medium">{video.title}</span>
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            {video.sourceStart !== null ? `${runtime(video.sourceStart)} → ${runtime(video.sourceStart + video.durationSec)} · ` : ""}
            {runtime(video.durationSec)} · {count(video.shots, "shot", "shots")}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot status={video.status} />
            {status.label}
            {video.tags.length ? <span className="truncate">· {video.tags.join(", ")}</span> : null}
          </span>
        </span>
      </button>

      {/* Visible on the selected row at every size, and on hover where there is a
          pointer. Hidden rows' controls are `invisible`, so they leave the tab order
          instead of sitting there transparent and still clickable. */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-1",
          selected ? "visible" : "invisible lg:group-hover/row:visible",
        )}
      >
        <Button
          size="icon-sm"
          variant="ghost"
          aria-pressed={approved}
          aria-label={approved ? `Move ${video.title} back to pending` : `Approve ${video.title}`}
          title={approved ? "Back to pending" : "Approve"}
          disabled={!video.sequence}
          onClick={() => handlers.onApprove(video)}
          className={cn(approved && "text-primary")}
        >
          <Check aria-hidden />
        </Button>
        <Link
          href={handlers.href(video)}
          onClick={handlers.onOpen(video)}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          <SlidersHorizontal aria-hidden />
          Edit
        </Link>
        {rendered && (
          <a
            download
            href={clipUrl(projectId, video.id)}
            aria-label={`Download ${video.title}`}
            className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
          >
            <Download aria-hidden />
          </a>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete ${video.title}`}
          onClick={() => handlers.onDelete(video)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  );
}
