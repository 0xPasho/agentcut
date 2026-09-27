"use client";

import { useState, type ReactNode } from "react";
import { CheckCheck, ChevronDown, Clapperboard, Trash2, X } from "lucide-react";
import { Button } from "@/common/ui/button";
import { Checkbox } from "@/common/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/common/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/common/ui/popover";
import { count } from "@/common/lib/format";
import type { ProjectVideo } from "../lib/overview";
import type { SequenceStatus } from "@/modules/plan/types";
import { STATUSES, STATUS } from "../data";
import { StatusIcon } from "./clip-list";

export function VideoSelectionBar({ videos, visibleCount, all, busy, error, onSelectAll, onClear, onStatus, onRender, onDelete, children, publicationAction }: {
  videos: ProjectVideo[];
  visibleCount: number;
  all: boolean;
  busy: boolean;
  error?: string | null;
  onSelectAll: () => void;
  onClear: () => void;
  onStatus: (status: SequenceStatus) => void;
  onRender: () => void;
  onDelete: (ids: string[]) => Promise<boolean>;
  children?: ReactNode;
  publicationAction?: ReactNode;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [targets, setTargets] = useState<ProjectVideo[]>([]);
  const selected = videos.length > 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Checkbox checked={all} indeterminate={selected && !all} disabled={!visibleCount || busy}
          className="min-h-10 shrink-0 px-1"
          onCheckedChange={() => all ? onClear() : onSelectAll()} aria-label={`Select visible videos (${visibleCount})`}>
          <span className="text-xs">Select visible</span>
        </Checkbox>
        {children}
      </div>
      {(selected || targets.length > 0) && <>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/5 p-2">
          <span role="status" className="me-auto px-1 text-xs font-medium tabular-nums">
            {videos.length} selected
          </span>
          <Button size="sm" className="min-h-9" disabled={busy} onClick={onRender}><Clapperboard aria-hidden className="size-4" />Render {count(videos.length, "video", "videos")}</Button>
          {publicationAction}
          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger render={<Button size="sm" variant="ghost" className="min-h-9" disabled={busy}><CheckCheck aria-hidden className="size-4" /> Set status <ChevronDown aria-hidden className="size-3.5" /></Button>} />
            <PopoverContent align="start" className="w-48 rounded-2xl p-1.5">
              {STATUSES.map(status => (
                <Button key={status} variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => { setStatusOpen(false); onStatus(status); }}>
                  <StatusIcon status={status} />{STATUS[status].label}
                </Button>
              ))}
            </PopoverContent>
          </Popover>
          <Dialog open={targets.length > 0} onOpenChange={open => { if (!open && !deleting) setTargets([]); }}>
            <DialogTrigger render={<Button size="icon" variant="ghost" aria-label={`Delete ${count(videos.length, "selected video", "selected videos")}`} title="Delete selected videos" disabled={busy} onClick={() => setTargets([...videos])}><Trash2 aria-hidden className="size-4" /></Button>} />
            <DialogContent showCloseButton={!deleting}>
              <DialogHeader>
                <DialogTitle>Delete {count(targets.length, "video", "videos")}?</DialogTitle>
                <DialogDescription>These videos and their edits will be removed from this project. Source media will be kept.</DialogDescription>
              </DialogHeader>
              <ul className="max-h-48 space-y-2 overflow-y-auto text-sm text-muted-foreground">
                {targets.map(video => <li key={video.id} className="break-words">{video.title}</li>)}
              </ul>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button variant="ghost" disabled={deleting} onClick={() => setTargets([])}>Cancel</Button>
                <Button variant="destructive" disabled={busy || deleting} onClick={async () => {
                  setDeleting(true);
                  try { if (await onDelete(targets.map(video => video.id))) setTargets([]); }
                  finally { setDeleting(false); }
                }}><Trash2 aria-hidden />{deleting ? "Deleting…" : `Delete ${count(targets.length, "video", "videos")}`}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button size="icon" variant="ghost" aria-label="Clear selection" title="Clear selection" disabled={busy} onClick={onClear}><X aria-hidden className="size-4" /></Button>
        </div>
      </>}
    </div>
  );
}
