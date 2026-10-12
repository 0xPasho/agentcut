"use client";
import { cn } from "cn";
import { ClaudeMark, OpenAiMark } from "@/common/components/brand-marks";
import type { HarnessOption } from "@agentcut/core/modules/ideas/types";

const MARKS: Record<string, typeof ClaudeMark> = { claude: ClaudeMark, codex: OpenAiMark };

export function HarnessMark({ id, className }: { id: string; className?: string }) {
  const Mark = MARKS[id];
  return Mark ? <Mark className={className ?? "size-3.5"} /> : null;
}

/** Pick one or several harnesses; each writes its own brief and the board shows them side by side. */
export function HarnessToggles({ options, value, onChange }: { options: HarnessOption[]; value: string[]; onChange: (next: string[]) => void }) {
  if (!options.length) return <p className="text-xs text-muted-foreground">Looking for Claude Code and Codex…</p>;
  return (
    <div role="group" aria-label="Harnesses" className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = value.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            disabled={!option.ready}
            title={option.ready ? undefined : option.reason}
            onClick={() => onChange(on ? value.filter((id) => id !== option.id) : [...value, option.id])}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors motion-reduce:transition-none",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40",
              on ? "border-primary/50 bg-primary/15 text-foreground" : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10",
            )}
          >
            <HarnessMark id={option.id} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
