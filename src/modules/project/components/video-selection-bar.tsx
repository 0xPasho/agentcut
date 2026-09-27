"use client";

import { useState } from "react";
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

export function VideoSelectionBar({ videos, visibleCount, all, busy, error, onSelectAll, onClear, onStatus, onRender, onDelete }: {
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
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [targets, setTargets] = useState<ProjectVideo[]>([]);
  const selected = videos.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-muted/40 px-3 py-2 ring-1 ring-inset ring-foreground/10">
      <Checkbox checked={all} indeterminate={selected && !all} disabled={!visibleCount || busy}
        onCheckedChange={() => all ? onClear() : onSelectAll()} aria-label={`Select all visible videos (${visibleCount})`}>
        <span className="text-xs">Select visible</span>
      </Checkbox>
      <span role="status" className="text-xs font-medium tabular-nums text-muted-foreground">
        {selected ? `${videos.length} selected` : `${visibleCount} visible`}
      </span>
      {(selected || targets.length > 0) && <>
        <div className="ms-auto flex flex-wrap items-center gap-1">
          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger render={<Button size="sm" variant="ghost" disabled={busy}><CheckCheck aria-hidden /> Set status <ChevronDown aria-hidden /></Button>} />
            <PopoverContent align="start" className="w-48 rounded-2xl p-1.5">
              {STATUSES.map(status => (
                <Button key={status} variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => { setStatusOpen(false); onStatus(status); }}>
                  <StatusIcon status={status} />{STATUS[status].label}
                </Button>
              ))}
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="outline" disabled={busy} onClick={onRender}><Clapperboard aria-hidden />Render selected</Button>
          <Dialog open={targets.length > 0} onOpenChange={open => { if (!open && !deleting) setTargets([]); }}>
            <DialogTrigger render={<Button size="sm" variant="ghost" disabled={busy} onClick={() => setTargets([...videos])}><Trash2 aria-hidden />Delete</Button>} />
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
          <Button size="icon-sm" variant="ghost" aria-label="Clear selection" disabled={busy} onClick={onClear}><X aria-hidden /></Button>
        </div>
      </>}
    </div>
  );
}
