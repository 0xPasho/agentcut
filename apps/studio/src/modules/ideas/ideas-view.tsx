"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bookmark, Lightbulb, Plus } from "lucide-react";
import { cn } from "cn";
import { AgentcutIcon } from "@/common/components/agentcut-mark";
import { Button } from "@/common/ui/button";
import { Glass } from "@/common/ui/glass";
import { Input } from "@/common/ui/input";
import { IdeaCard } from "./components/idea-card";
import { IdeaDetail } from "./components/idea-detail";
import { IDEA_COLUMNS } from "@agentcut/core/modules/ideas/data";
import { useHarnessOptions, useIdeas } from "./hooks";
import type { IdeasPageData, IdeaStatus } from "@agentcut/core/modules/ideas/types";

/**
 * The board of ideas: what was captured from the web, what a harness is turning into
 * a brief, what is ready to film, and what is already a project. Cards move by
 * dragging, or from the column picker inside a card for keyboards.
 */
export function IdeasView({ ideas: initial, openId }: IdeasPageData) {
  const { ideas, columns, actions } = useIdeas(initial);
  const harnesses = useHarnessOptions();
  const [open, setOpen] = useState<string | null>(openId);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<IdeaStatus | null>(null);
  const [draft, setDraft] = useState("");

  const drop = (status: IdeaStatus, e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/plain") || dragging;
    if (!id) return;
    // Index from the pointer: before the first card whose middle is below it.
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-idea-card]")].filter((el) => el.dataset.ideaCard !== id);
    const index = cards.findIndex((el) => { const box = el.getBoundingClientRect(); return e.clientY < box.top + box.height / 2; });
    void actions.move(id, status, index === -1 ? cards.length : index);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    const idea = await actions.create(draft.trim());
    setDraft("");
    setOpen(idea.id);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-6 px-4 pt-4 pb-12 sm:px-8">
      <Glass shape="capsule" className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Button variant="ghost" size="icon" aria-label="Back to projects" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <AgentcutIcon className="size-6" />
        <span className="text-sm font-medium">Ideas</span>
        <span className="hidden border-l border-white/10 pl-3 text-xs text-muted-foreground sm:inline">
          Built from your saves, drafted by your harness
        </span>
        <Button variant="ghost" className="ml-auto" nativeButton={false} render={<Link href="/saves" />}><Bookmark className="size-4" />Saves</Button>
        <form onSubmit={add} className="flex min-w-64 flex-1 items-center gap-2 sm:max-w-md">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Jot down an idea" aria-label="New idea" className="h-9" />
          <Button type="submit" size="sm" disabled={!draft.trim()}><Plus />Add</Button>
        </form>
      </Glass>

      {!ideas.length && (
        <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-16 text-center">
          <Lightbulb aria-hidden className="size-6 text-muted-foreground" />
          <h2 className="text-base font-medium">No ideas yet</h2>
          <p className="text-sm text-pretty text-muted-foreground">
            Save posts and videos with the AgentCut toolbar while you browse, then pick a few in <Link href="/saves" className="underline underline-offset-2">Saves</Link> and build an idea.
          </p>
        </div>
      )}

      <div className="grid flex-1 grid-flow-col auto-cols-[minmax(260px,1fr)] gap-4 overflow-x-auto pb-2">
        {IDEA_COLUMNS.map((column) => (
          <section
            key={column.status}
            aria-label={column.label}
            onDragOver={(e) => { e.preventDefault(); setOver(column.status); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
            onDrop={(e) => drop(column.status, e)}
            className={cn(
              "flex min-h-64 flex-col gap-3 rounded-3xl border border-white/5 bg-white/[0.02] p-3 transition-colors motion-reduce:transition-none",
              over === column.status && "border-primary/40 bg-primary/5",
            )}
          >
            <header className="flex items-baseline gap-2 px-1">
              <h2 className="text-sm font-medium">{column.label}</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{columns[column.status].length}</span>
              <span className="ml-auto truncate text-[11px] text-muted-foreground/70">{column.hint}</span>
            </header>
            {columns[column.status].map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                dragging={dragging === idea.id}
                onDragStart={() => setDragging(idea.id)}
                onDragEnd={() => setDragging(null)}
                onOpen={() => setOpen(idea.id)}
              />
            ))}
          </section>
        ))}
      </div>

      <IdeaDetail idea={ideas.find((i) => i.id === open) ?? null} harnesses={harnesses} actions={actions} onClose={() => setOpen(null)} />
    </main>
  );
}
