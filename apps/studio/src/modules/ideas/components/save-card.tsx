"use client";
import { Check, CircleAlert, Download, ExternalLink, Lightbulb, Loader2 } from "lucide-react";
import { cn } from "cn";
import { deepLink, saveFileUrl, saveLabel } from "@agentcut/core/modules/ideas/lib";
import type { Save } from "@agentcut/core/modules/ideas/types";

/**
 * A save in the library. A click opens its preview; the circle in the corner selects
 * it. Once anything is selected, a click selects too — the way a photo library works.
 */
export function SaveCard({ save, selected, selecting, previewing, onOpen, onToggle }: {
  save: Save;
  selected: boolean;
  selecting: boolean;
  previewing: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-card transition-[border-color,box-shadow] motion-reduce:transition-none",
        selected && "border-primary/70 shadow-[0_0_0_1px_var(--primary)]",
        !selected && previewing && "border-white/40",
        !selected && !previewing && "border-white/10 hover:border-white/25",
      )}
    >
      <button
        type="button"
        aria-label={selecting ? `${selected ? "Unselect" : "Select"} ${saveLabel(save)}` : `Preview ${saveLabel(save)}`}
        aria-pressed={selecting ? selected : undefined}
        aria-current={previewing || undefined}
        onClick={(e) => (selecting || e.metaKey || e.shiftKey ? onToggle() : onOpen())}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${selected ? "Unselect" : "Select"} ${saveLabel(save)}`}
        onClick={onToggle}
        className={cn(
          "absolute top-2 left-2 z-10 grid size-7 place-items-center rounded-full transition-opacity motion-reduce:transition-none",
          "focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          selected || selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <span className={cn("grid size-5 place-items-center rounded-full border", selected ? "border-primary bg-primary text-primary-foreground" : "border-white/60 bg-black/50")}>
          {selected && <Check className="size-3" strokeWidth={3} />}
        </span>
      </button>
      {save.screenshot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={saveFileUrl(save.id, save.screenshot)} alt="" loading="lazy" className="pointer-events-none aspect-[4/3] w-full object-cover object-top" />
      ) : save.mediaStatus === "done" && save.mediaFile ? (
        // No screenshot, but the video is kept: the browser draws its frame at the saved second.
        <video src={`${saveFileUrl(save.id, save.mediaFile)}#t=${save.atSec || 1}`} muted playsInline preload="metadata" className="pointer-events-none aspect-[4/3] w-full bg-black object-cover" />
      ) : (
        <div className="pointer-events-none grid aspect-[4/3] place-items-center bg-white/[0.03] px-4 text-center text-xs text-muted-foreground">{save.title || save.url}</div>
      )}
      <div className="pointer-events-none flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="truncate font-medium">{saveLabel(save)}</span>
          <a
            href={deepLink(save)}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open the original"
            className="pointer-events-auto relative z-10 ml-auto shrink-0 rounded-full p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        {save.note && <p className="line-clamp-3 text-sm leading-snug text-pretty">“{save.note}”</p>}
        {save.text && <p className="line-clamp-2 text-xs text-muted-foreground">{save.text}</p>}
        <div className="mt-auto flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
          {save.mediaStatus === "pending" && <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin motion-reduce:animate-none" />Keeping video</span>}
          {save.mediaStatus === "done" && <span className="inline-flex items-center gap-1"><Download className="size-3" />Video kept</span>}
          {save.mediaStatus === "failed" && <span className="inline-flex items-center gap-1" title={save.mediaError ?? undefined}><CircleAlert className="size-3" />Video not kept</span>}
          {save.ideaIds.length > 0 && (
            <span className="ml-auto inline-flex items-center gap-1"><Lightbulb className="size-3" />{save.ideaIds.length === 1 ? "In 1 idea" : `In ${save.ideaIds.length} ideas`}</span>
          )}
        </div>
      </div>
    </article>
  );
}
