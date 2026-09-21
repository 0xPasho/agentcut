"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Download, Film, SlidersHorizontal, Trash2 } from "lucide-react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { clipUrl, thumbUrl } from "@/lib/client";
import { count, runtime } from "@/lib/format";
import type { ProjectVideo } from "@/lib/overview";
import type { SequenceStatus } from "@/lib/plan/schema";

/**
 * Status reads as a dot plus its word, never as a colour on its own: four states
 * told apart by hue alone are four states nobody can tell apart.
 */
export const STATUS: Record<SequenceStatus, { label: string; dot: string }> = {
  pending: { label: "Pending", dot: "bg-transparent ring-1 ring-inset ring-current" },
  edited: { label: "Edited", dot: "bg-current" },
  approved: { label: "Approved", dot: "bg-primary" },
  rendered: { label: "Rendered", dot: "bg-primary" },
};

export function StatusDot({ status }: { status: SequenceStatus }) {
  if (status === "rendered") return <Check aria-hidden className="size-3 text-primary" />;
  return <span aria-hidden className={cn("size-2 rounded-full", STATUS[status].dot)} />;
}

/**
 * One output, as a picture first.
 *
 * The poster is the point: a list of titles and durations is a database view of a
 * clipping project, not an overview of one. Two targets, each doing one thing —
 * the picture selects it for the preview, the button opens it in the editor.
 */
export function VideoCard({
  video,
  projectId,
  revision,
  aspect,
  selected,
  rendered,
  href,
  onSelect,
  onOpen,
  onDelete,
}: {
  video: ProjectVideo;
  projectId: string;
  revision: number;
  aspect: string;
  selected: boolean;
  rendered: boolean;
  href: string;
  onSelect: () => void;
  onOpen: (event: React.MouseEvent) => void;
  onDelete: () => void;
}) {
  const [poster, setPoster] = useState(true);
  const status = STATUS[video.status];

  return (
    <li>
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-3xl bg-card text-card-foreground transition-[box-shadow] duration-150 ease-out motion-reduce:transition-none",
          selected
            ? "ring-2 ring-primary/60"
            : "ring-1 ring-foreground/10 hover:ring-foreground/25",
        )}
      >
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className="cursor-pointer text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <div className="relative bg-black" style={{ aspectRatio: aspect }}>
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
              // A source-free canvas has no frame to show yet, and a broken image icon
              // would read as a failure rather than as an empty video.
              <div className="flex size-full items-center justify-center">
                <Film aria-hidden className="size-7 text-muted-foreground" />
              </div>
            )}

            <span className="absolute top-2 start-2 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              <StatusDot status={video.status} />
              {status.label}
            </span>

            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-linear-to-t from-black/85 via-black/35 to-transparent px-2.5 pt-8 pb-2">
              <span className="text-xs font-medium text-white tabular-nums">
                {runtime(video.durationSec)}
              </span>
              {video.score !== null && (
                <span className="text-xs font-semibold text-primary tabular-nums">
                  {video.score}
                </span>
              )}
            </span>
          </div>

          <div className="px-3.5 pt-3.5">
            <h3 className="line-clamp-2 text-sm leading-[1.4] font-medium text-balance">
              {video.title}
            </h3>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {count(video.shots, "shot", "shots")}
              {video.tags.length ? ` · ${video.tags.join(", ")}` : ""}
            </p>
          </div>
        </button>

        <div className="mt-auto flex items-center gap-1.5 p-3.5 pt-3">
          {/* A real anchor, not a button rendering one: ⌘-click, middle-click and
              "open in new tab" all come free, and Base UI stops warning about it. */}
          <Link
            href={href}
            onClick={onOpen}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
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
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
    </li>
  );
}
