"use client";

import type { Clip, Edit } from "@/lib/edl";
import { buildTimeMap, srcToOut, type TimeMap } from "@/lib/timeline";
import { fmt } from "@/lib/transcript";

const LANES: Array<{ type: Edit["type"]; label: string; className: string }> = [
  { type: "silence", label: "Silence", className: "bg-destructive/70 text-white" },
  { type: "punch", label: "Punch", className: "bg-primary/80 text-black" },
  { type: "emphasis", label: "Emphasis", className: "bg-[oklch(0.7_0.19_42)]/85 text-white" },
  { type: "text", label: "Title", className: "bg-white/90 text-black" },
  { type: "image", label: "Image", className: "bg-[oklch(0.6_0.18_265)]/85 text-white" },
];

/**
 * Edits are authored in clip-relative SOURCE time, but the playhead runs in OUTPUT
 * time — silence cuts shift everything after them. Every block is positioned
 * through the time map so the timeline matches what you actually see.
 */
export function Timeline({
  clip,
  currentSec,
  selected,
  onSelect,
  onSeek,
}: {
  clip: Clip;
  currentSec: number;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onSeek: (sec: number) => void;
}) {
  const map: TimeMap = buildTimeMap(clip);
  const total = Math.max(0.1, map.duration);
  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / total) * 100))}%`;

  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - box.left) / box.width) * total);
  };

  // Ticks every 5s, or every 10s on a long clip, so the ruler stays readable.
  const step = total > 90 ? 15 : total > 40 ? 10 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += step) ticks.push(t);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0" />
        <div
          role="slider"
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={currentSec}
          tabIndex={0}
          onClick={seekFromEvent}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") onSeek(Math.max(0, currentSec - 1));
            if (e.key === "ArrowRight") onSeek(Math.min(total, currentSec + 1));
          }}
          className="relative h-8 flex-1 cursor-pointer rounded-lg bg-white/[0.04] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute top-0 bottom-0 flex flex-col justify-between border-l border-white/10 pl-1 font-mono text-[10px] text-muted-foreground"
              style={{ left: pct(t) }}
            >
              <span>{fmt(t)}</span>
            </span>
          ))}
          <div
            className="absolute inset-y-0 z-10 w-0.5 bg-primary shadow-[0_0_8px_0_var(--primary)]"
            style={{ left: pct(currentSec) }}
          >
            <span className="absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-primary" />
          </div>
        </div>
      </div>

      {LANES.map((lane) => {
        const blocks = clip.edits
          .map((e, index) => ({ e, index }))
          .filter(({ e }) => e.type === lane.type);
        if (!blocks.length) return null;

        return (
          <div key={lane.type} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{lane.label}</span>
            <div className="relative h-7 flex-1 rounded-lg bg-white/[0.04]">
              {blocks.map(({ e, index }) => {
                const start = srcToOut(map, e.t);
                const end = srcToOut(map, e.t + ("d" in e ? e.d : 0.5));
                const isSelected = selected === index;
                const label =
                  e.type === "text" ? e.text : e.type === "emphasis" ? e.words.join(" ") : "";
                return (
                  <button
                    key={index}
                    type="button"
                    aria-label={`${lane.label} at ${fmt(start)}`}
                    aria-pressed={isSelected}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSelect(isSelected ? null : index);
                      onSeek(start);
                    }}
                    style={{ left: pct(start), width: pct(Math.max(0.6, end - start)) }}
                    className={`absolute inset-y-1 min-w-[10px] overflow-hidden rounded-md px-1.5 text-left text-[10px] font-medium whitespace-nowrap outline-none transition-[filter,box-shadow] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring ${lane.className} ${
                      isSelected ? "ring-2 ring-white/90" : ""
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
