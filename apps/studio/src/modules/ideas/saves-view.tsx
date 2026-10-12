"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bookmark, Lightbulb, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "cn";
import { AgentcutIcon } from "@/common/components/agentcut-mark";
import { Button } from "@/common/ui/button";
import { Glass } from "@/common/ui/glass";
import { BuildIdea } from "./components/build-idea";
import { SaveCard } from "./components/save-card";
import { SavePreview } from "./components/save-preview";
import { PLATFORMS } from "@agentcut/core/modules/ideas/data";
import { useHarnessOptions, useSaves } from "./hooks";
import { neighbour, platformOf, savesByDay } from "@agentcut/core/modules/ideas/lib";
import type { SavesPageData } from "@agentcut/core/modules/ideas/types";

/**
 * Everything kept with the toolbar while browsing, newest first, by day. A click opens a
 * save beside the list — its video, the post, the note — and ← → walk through them.
 * Pick a few and build an idea from them: the notes said at the moment of saving go
 * with them.
 */
export function SavesView({ saves: initial }: SavesPageData) {
  const { saves, actions } = useSaves(initial);
  const harnesses = useHarnessOptions();
  const [platform, setPlatform] = useState<string>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [buildFor, setBuildFor] = useState<string[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(() => (platform === "all" ? saves : saves.filter((s) => platformOf(s) === platform)), [saves, platform]);
  const days = useMemo(() => savesByDay(shown), [shown]);
  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const ordered = useMemo(() => days.flatMap((d) => d.saves), [days]);
  const current = saves.find((s) => s.id === open) ?? null;
  const step = (by: 1 | -1) => { if (open) setOpen(neighbour(ordered, open, by)); };

  // ← → walk the list and Esc closes, unless the keys are being typed into something.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") { e.preventDefault(); setOpen(neighbour(ordered, open, 1)); }
      if (e.key === "ArrowLeft") { e.preventDefault(); setOpen(neighbour(ordered, open, -1)); }
      if (e.key === "Escape") setOpen(null);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, ordered]);
  // A save deleted from the preview takes the preview with it.
  useEffect(() => { if (open && !saves.some((s) => s.id === open)) setOpen(null); }, [open, saves]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-6 px-4 pt-4 pb-28 sm:px-8">
      <Glass shape="capsule" className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Button variant="ghost" size="icon" aria-label="Back to projects" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <AgentcutIcon className="size-6" />
        <span className="text-sm font-medium">Saves</span>
        <span className="hidden border-l border-white/10 pl-3 text-xs text-muted-foreground sm:inline">Kept with the toolbar while browsing</span>
        <Button variant="ghost" className="ml-auto" nativeButton={false} render={<Link href="/ideas" />}><Lightbulb className="size-4" />Ideas</Button>
      </Glass>

      <div role="group" aria-label="Platform" className="flex flex-wrap gap-1.5">
        {[{ id: "all", label: "All" }, ...PLATFORMS].map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={platform === p.id}
            onClick={() => setPlatform(p.id)}
            className={cn(
              "h-8 rounded-full border px-3 text-xs transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              platform === p.id ? "border-white/25 bg-white/10" : "border-white/10 text-muted-foreground hover:bg-white/5",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {!shown.length && (
        <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-16 text-center">
          <Bookmark aria-hidden className="size-6 text-muted-foreground" />
          <h2 className="text-base font-medium">Nothing saved yet</h2>
          <p className="text-sm text-pretty text-muted-foreground">Browse X, Instagram, TikTok or YouTube with the AgentCut toolbar and press Save on what you like.</p>
        </div>
      )}

      <div className="flex items-start gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {days.map(({ day, saves: list }) => (
            <section key={day} aria-label={day} className="flex flex-col gap-3">
              <h2 className="text-sm font-medium capitalize text-muted-foreground">{day} · {list.length}</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {list.map((save) => (
                  <SaveCard
                    key={save.id}
                    save={save}
                    selected={selected.includes(save.id)}
                    selecting={selected.length > 0}
                    previewing={open === save.id}
                    onOpen={() => setOpen(save.id)}
                    onToggle={() => toggle(save.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        {current && (
          <aside
            aria-label="Save preview"
            className={cn(
              "fixed inset-y-2 right-2 z-40 w-[min(28rem,calc(100vw-1rem))] overflow-hidden rounded-3xl border border-border bg-card shadow-(--glass-shadow-raised)",
              "lg:sticky lg:top-4 lg:inset-auto lg:z-auto lg:h-[calc(100dvh-2rem)] lg:w-[26rem] lg:shrink-0 lg:shadow-none",
            )}
          >
            <SavePreview
              save={current}
              onClose={() => setOpen(null)}
              onPrev={ordered.length > 1 ? () => step(-1) : undefined}
              onNext={ordered.length > 1 ? () => step(1) : undefined}
              onChanged={() => void actions.refresh()}
              onBuildIdea={() => setBuildFor([current.id])}
            />
          </aside>
        )}
      </div>

      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
          <Glass shape="capsule" thickness="thick" className="flex items-center gap-2 px-3 py-2">
            <span className="px-2 text-sm tabular-nums">{selected.length} selected</span>
            <Button size="sm" onClick={() => setBuildFor(selected)}><Sparkles />Build idea</Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => { if (confirm(`Delete ${selected.length === 1 ? "this save" : `${selected.length} saves`}?`)) { void actions.remove(selected); setSelected([]); } }}
            >
              <Trash2 />Delete
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Clear selection" onClick={() => setSelected([])}><X /></Button>
          </Glass>
        </div>
      )}

      <BuildIdea
        open={!!buildFor}
        count={buildFor?.length ?? 0}
        harnesses={harnesses}
        onClose={() => setBuildFor(null)}
        onBuild={(request) => actions.buildIdea({ ...request, saveIds: buildFor ?? [] })}
      />
    </main>
  );
}
