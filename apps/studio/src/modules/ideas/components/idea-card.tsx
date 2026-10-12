"use client";
import { Clapperboard, Link2 } from "lucide-react";
import { cn } from "cn";
import { chosenRun, hostOf, latestRuns, saveFileUrl } from "@agentcut/core/modules/ideas/lib";
import type { Idea } from "@agentcut/core/modules/ideas/types";
import { HarnessMark } from "./harness-toggles";
import { RunStatusIcon } from "./run-status";

export function IdeaCard({ idea, onOpen, dragging, onDragStart, onDragEnd }: {
  idea: Idea;
  onOpen: () => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const shot = idea.saves.find((save) => save.screenshot);
  const site = idea.saves[0] ? idea.saves[0].site || hostOf(idea.saves[0].url) : "";
  const brief = chosenRun(idea)?.brief;
  return (
    <button
      type="button"
      draggable
      data-idea-card={idea.id}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", idea.id); e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        "group flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-card text-left shadow-sm transition-[border-color,opacity] motion-reduce:transition-none",
        "hover:border-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        dragging && "opacity-40",
      )}
    >
      {shot && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={saveFileUrl(shot.id, shot.screenshot!)} alt="" loading="lazy" className="aspect-video w-full object-cover object-top outline outline-1 -outline-offset-1 outline-white/10" />
      )}
      <span className="flex flex-col gap-2 p-3">
        <span className="line-clamp-3 text-sm font-medium leading-snug text-pretty">{brief?.title || idea.title}</span>
        {brief?.hooks[0] && <span className="line-clamp-2 text-xs text-muted-foreground">“{brief.hooks[0]}”</span>}
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {site && <span className="inline-flex min-w-0 items-center gap-1"><Link2 aria-hidden className="size-3 shrink-0" /><span className="truncate">{site}</span></span>}
          {idea.saves.length > 1 && <span className="tabular-nums">+{idea.saves.length - 1}</span>}
          {idea.projectId && <Clapperboard aria-label="Has a project" className="size-3.5" />}
          <span className="ml-auto flex items-center gap-1.5">
            {latestRuns(idea).map((run) => (
              <span key={run.id} className="inline-flex items-center gap-0.5" title={`${run.harness}: ${run.status}`}>
                <HarnessMark id={run.harness} className="size-3" />
                <RunStatusIcon status={run.status} className="size-3" />
              </span>
            ))}
          </span>
        </span>
      </span>
    </button>
  );
}
