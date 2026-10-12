"use client";
import { Download, ExternalLink, X } from "lucide-react";
import { Button } from "@/common/ui/button";
import { deepLink, saveFileUrl, saveLabel } from "@agentcut/core/modules/ideas/lib";
import type { Save } from "@agentcut/core/modules/ideas/types";

/** One save in a list: its picture, who and what, the note it was kept with, and a way out. */
export function SaveRow({ save, onOpen, onRemove, removeLabel }: { save: Save; onOpen: () => void; onRemove: () => void; removeLabel: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2">
      {save.screenshot && (
        <button type="button" onClick={onOpen} aria-label={`Preview ${saveLabel(save)}`} className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={saveFileUrl(save.id, save.screenshot)} alt="" className="h-16 w-24 rounded-lg object-cover object-top outline outline-1 -outline-offset-1 outline-white/10" />
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <button type="button" onClick={onOpen} className="truncate text-left text-xs font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring">{saveLabel(save)}</button>
          <a href={deepLink(save)} target="_blank" rel="noreferrer noopener" aria-label="Open the original" className="shrink-0 text-muted-foreground hover:text-foreground">
            <ExternalLink aria-hidden className="size-3" />
          </a>
        </span>
        {save.note && <p className="text-xs text-foreground/90">“{save.note}”</p>}
        {save.text && <p className="line-clamp-2 text-xs text-muted-foreground">{save.text}</p>}
        {save.mediaStatus === "done" && save.mediaFile && (
          <a href={saveFileUrl(save.id, save.mediaFile)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <Download aria-hidden className="size-3" />Video kept
          </a>
        )}
      </div>
      <Button variant="ghost" size="icon-xs" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
        <X />
      </Button>
    </div>
  );
}
