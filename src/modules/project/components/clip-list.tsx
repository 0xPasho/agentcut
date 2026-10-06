"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck, CircleX, Clock3, Download, FileVideo, Film, PencilLine, SlidersHorizontal, Trash2 } from "lucide-react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/common/ui/button";
import { Checkbox } from "@/common/ui/checkbox";
import { clipUrl, thumbUrl } from "@/common/api/client";
import { count, runtime } from "@/common/lib/format";
import type { ProjectVideo } from "@/modules/project/lib/overview";
import type { SequenceStatus } from "@/modules/plan/types";
import { STATUS } from "../data";
import { usePublishing } from "../../publishing/hooks";
import { PublicationStatusBadge } from "../../publishing/components/status";
import type { PublicationStatus } from "../../publishing/types";
import { type VideoLayout, type ClipListHandlers } from "../types";

export function StatusIcon({ status }: { status: SequenceStatus }) {
  if (status === "pending") return <Clock3 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
  if (status === "edited") return <PencilLine aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
  if (status === "approved") return <BadgeCheck aria-hidden className="size-3.5 shrink-0 text-primary" />;
  if (status === "rejected") return <CircleX aria-hidden className="size-3.5 shrink-0 text-destructive" />;
  return <FileVideo aria-hidden className="size-3.5 shrink-0 text-primary" />;
}

export function ClipList({
  videos,
  layout,
  projectId,
  revision,
  selectedId,
  rendered,
  handlers,
  checkedIds = [],
  onToggle,
}: {
  videos: ProjectVideo[];
  layout: VideoLayout;
  projectId: string;
  revision: number;
  selectedId: string | null;
  rendered: string[];
  handlers: ClipListHandlers;
  checkedIds?: string[];
  onToggle?: (id: string) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const { data: publishing } = usePublishing(projectId);

  // Arrows walk the list and Tab leaves it: one stop for forty rows, the way every
  // other list of this shape behaves.
  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (layout === "grid") keys.push("ArrowLeft", "ArrowRight");
    if (!keys.includes(event.key) || !(event.target as HTMLElement).matches("[data-row]")) return;
    const index = Array.from(list.current?.querySelectorAll("[data-row]") ?? []).indexOf(event.target as Element);
    if (index < 0) return;
    const rows = Array.from(list.current?.children ?? []) as HTMLLIElement[];
    const columns = layout === "grid" ? Math.max(1, rows.filter(row => row.offsetTop === rows[0]?.offsetTop).length) : 1;
    const next =
      event.key === "ArrowDown" ? Math.min(videos.length - 1, index + columns)
      : event.key === "ArrowUp" ? Math.max(0, index - columns)
      : event.key === "ArrowRight" ? Math.min(videos.length - 1, index + 1)
      : event.key === "ArrowLeft" ? Math.max(0, index - 1)
      : event.key === "Home" ? 0
      : videos.length - 1;
    event.preventDefault();
    if (next === index) return;
    handlers.onSelect(videos[next].id);
    list.current?.querySelectorAll<HTMLButtonElement>("[data-row]")[next]?.focus();
  };

  return (
    <ul ref={list} onKeyDown={onKeyDown} className={layout === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-3" : "flex flex-col gap-1"}>
      {videos.map((video) => (
        <ClipRow
          key={video.id}
          layout={layout}
          video={video}
          publicationStatus={publishing?.publications.filter(p => p.sequenceId === video.id).at(-1)?.status}
          projectId={projectId}
          revision={revision}
          selected={video.id === selectedId}
          tabbable={video.id === selectedId || (!videos.some(v => v.id === selectedId) && video.id === videos[0]?.id)}
          rendered={rendered.includes(video.id)}
          handlers={handlers}
          checked={checkedIds.includes(video.id)}
          selecting={checkedIds.length > 0}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}

function ClipRow({
  video,
  publicationStatus,
  layout,
  tabbable,
  projectId,
  revision,
  selected,
  rendered,
  handlers,
  checked,
  selecting,
  onToggle,
}: {
  video: ProjectVideo;
  publicationStatus?: PublicationStatus;
  layout: VideoLayout;
  tabbable: boolean;
  projectId: string;
  revision: number;
  selected: boolean;
  rendered: boolean;
  handlers: ClipListHandlers;
  checked: boolean;
  selecting: boolean;
  onToggle?: (id: string) => void;
}) {
  const [poster, setPoster] = useState(true);
  const row = useRef<HTMLLIElement>(null);
  const grid = layout === "grid";
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
        "group/row relative flex min-w-0 flex-wrap items-center gap-3 rounded-2xl p-2 transition-colors duration-150 ease-out motion-reduce:transition-none sm:flex-nowrap",
        grid && "flex-col items-stretch bg-white/3",
        selected ? "bg-white/8 ring-1 ring-inset ring-primary/50" : "hover:bg-white/5",
        checked && "bg-primary/8 ring-2 ring-inset ring-primary/70",
      )}
    >
      {onToggle && (
        <Checkbox
          checked={checked}
          onCheckedChange={() => onToggle(video.id)}
          aria-label={`Select ${video.title}`}
          className={cn(
            "z-10 size-10 shrink-0 justify-center rounded-xl transition-opacity duration-150 motion-reduce:transition-none",
            grid && "absolute end-3 top-3 bg-background/90 shadow-sm",
            !selecting && "[@media(hover:hover)]:opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 group-focus-within/row:opacity-100",
          )}
          boxClassName="size-5 rounded-md"
        />
      )}
      <button
        data-row
        type="button"
        tabIndex={tabbable ? 0 : -1}
        aria-pressed={selected}
        onClick={() => handlers.onSelect(video.id)}
        className={cn("flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50", grid && "relative flex-col items-stretch")}
      >
        <span className={cn("flex w-9 shrink-0 flex-col items-center gap-1.5", grid && "absolute start-2 top-2 z-10 rounded-lg bg-black/80 p-1.5 text-white")}>
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

        <span className={cn("relative shrink-0 overflow-hidden rounded-lg bg-black ring-1 ring-foreground/10", grid ? "w-full" : "h-[70px] w-10")}>
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbUrl(projectId, video.id, revision)}
              alt=""
              loading="lazy"
              onError={() => setPoster(false)}
              className={cn("object-contain", grid ? "block h-auto w-full" : "size-full")}
            />
          ) : (
            <span className={cn("flex size-full items-center justify-center", grid && "aspect-video")}>
              <Film aria-hidden className="size-4 text-muted-foreground" />
            </span>
          )}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn("text-sm font-medium", grid ? "line-clamp-2" : "truncate")}>{video.title}</span>
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            {video.sourceStart !== null ? `${runtime(video.sourceStart)} → ${runtime(video.sourceStart + video.durationSec)} · ` : ""}
            {runtime(video.durationSec)} · {count(video.shots, "shot", "shots")}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {publicationStatus ? <PublicationStatusBadge status={publicationStatus} /> : <StatusIcon status={video.status} />}
            {!publicationStatus && status.label}
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
          !grid && "w-full justify-end sm:w-auto",
          (selected || grid) ? "visible" : "invisible lg:group-hover/row:visible",
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
          <BadgeCheck aria-hidden />
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
