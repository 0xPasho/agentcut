"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Clapperboard, Sparkles, Square, Trash2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/common/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/common/ui/dialog";
import { Input } from "@/common/ui/input";
import { Textarea } from "@/common/ui/textarea";
import { Markdown } from "@/modules/agent/components/markdown";
import { IDEA_COLUMNS } from "@agentcut/core/modules/ideas/data";
import { briefMarkdown, chosenRun, isRunning, neighbour } from "@agentcut/core/modules/ideas/lib";
import type { HarnessOption, Idea, IdeasActions, IdeaStatus } from "@agentcut/core/modules/ideas/types";
import { HarnessMark, HarnessToggles } from "./harness-toggles";
import { RunStatusIcon, runStatusLabel } from "./run-status";
import { SavePreview } from "./save-preview";
import { SaveRow } from "./save-row";

export function IdeaDetail({ idea, harnesses, actions, onClose }: {
  idea: Idea | null;
  harnesses: HarnessOption[];
  actions: IdeasActions;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!idea} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-5xl">
        {idea && <Body key={idea.id} idea={idea} harnesses={harnesses} actions={actions} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ idea, harnesses, actions, onClose }: { idea: Idea; harnesses: HarnessOption[]; actions: IdeasActions; onClose: () => void }) {
  const [title, setTitle] = useState(idea.title);
  const [note, setNote] = useState(idea.note);
  const [picked, setPicked] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [starting, setStarting] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewed = idea.saves.find((s) => s.id === previewing) ?? null;
  const running = isRunning(idea);
  const chosen = chosenRun(idea);
  const [shown, setShown] = useState<string | null>(chosen?.id ?? idea.runs.at(-1)?.id ?? null);
  const run = idea.runs.find((r) => r.id === shown) ?? idea.runs.at(-1) ?? null;

  // Harnesses that are ready start ticked, so developing is one click.
  useEffect(() => {
    if (!picked.length) setPicked(harnesses.filter((h) => h.ready).slice(0, 1).map((h) => h.id));
  }, [harnesses, picked.length]);
  // A run that just started is the one worth watching.
  const newest = idea.runs.at(-1)?.id;
  useEffect(() => { if (newest) setShown(newest); }, [newest]);

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section aria-label="Idea" className="flex min-w-0 flex-col gap-4">
        <DialogTitle className="sr-only">{idea.title}</DialogTitle>
        <DialogDescription className="sr-only">The idea, its references and the briefs written for it.</DialogDescription>
        <Input
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() && title !== idea.title) void actions.patch(idea.id, { title: title.trim() }); }}
          className="h-10 text-base font-semibold"
        />
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Your note
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => { if (note !== idea.note) void actions.patch(idea.id, { note }); }}
            rows={5}
            placeholder="What you want to make from this"
            className="text-sm text-foreground"
          />
        </label>

        <div className="flex items-center gap-2">
          <label htmlFor="idea-status" className="text-xs text-muted-foreground">Column</label>
          <select
            id="idea-status"
            value={idea.status}
            onChange={(e) => void actions.move(idea.id, e.target.value as IdeaStatus, 0)}
            className="h-8 rounded-full border border-white/10 bg-white/5 px-3 text-xs"
          >
            {IDEA_COLUMNS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Saves · {idea.saves.length}</h3>
          {!idea.saves.length && (
            <p className="text-xs text-muted-foreground">
              Nothing saved in this idea yet. Pick saves in the <Link href="/saves" className="underline underline-offset-2">library</Link> to add them.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {idea.saves.map((save) => (
              <li key={save.id}>
                <SaveRow save={save} onOpen={() => setPreviewing(save.id)} onRemove={() => void actions.unlinkSave(idea.id, save.id)} removeLabel="Take out of this idea" />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-label="Briefs" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <HarnessToggles options={harnesses} value={picked} onChange={setPicked} />
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="Anything to add for this round (optional)"
            className="text-sm"
          />
          <div className="flex items-center gap-2">
            {running ? (
              <Button variant="secondary" size="sm" onClick={() => void actions.stop(idea.id)}><Square className="size-3" />Stop</Button>
            ) : (
              <Button size="sm" disabled={!picked.length} onClick={() => { void actions.develop(idea.id, { harnesses: picked, instruction }); setInstruction(""); }}>
                <Sparkles />{idea.runs.length ? "Develop again" : "Develop"}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {picked.length > 1 ? "Each harness writes its own brief." : "Writes a brief: hooks, beats, script and shots."}
            </span>
          </div>
        </div>

        {idea.runs.length > 0 && (
          <div role="tablist" aria-label="Briefs" className="flex flex-wrap gap-1.5">
            {idea.runs.map((r) => (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={r.id === run?.id}
                onClick={() => setShown(r.id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors motion-reduce:transition-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  r.id === run?.id ? "border-white/25 bg-white/10" : "border-white/10 text-muted-foreground hover:bg-white/5",
                )}
              >
                <HarnessMark id={r.harness} />
                <RunStatusIcon status={r.status} />
                <span>{runStatusLabel(r.status)}</span>
                {chosen?.id === r.id && <span className="text-primary">· in use</span>}
              </button>
            ))}
          </div>
        )}

        {run && (
          <div role="tabpanel" className="flex min-h-40 flex-col gap-3 rounded-2xl border border-white/10 bg-card p-4">
            {run.status === "running" && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <RunStatusIcon status="running" />
                <span className="truncate">{run.activity || "Reading the references…"}</span>
              </p>
            )}
            {run.error && <p className="text-xs text-destructive">{run.error}</p>}
            {run.brief && <Markdown text={briefMarkdown(run.brief)} className="text-sm" />}
            {!run.brief && run.text && <Markdown text={run.text} className="text-sm" />}
            {run.brief && chosen?.id !== run.id && (
              <Button variant="outline" size="sm" className="self-start" onClick={() => void actions.patch(idea.id, { chosenRunId: run.id })}>Use this brief</Button>
            )}
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
          {idea.projectId ? (
            <Button nativeButton={false} render={<Link href={`/p/${idea.projectId}/edit`} />}><Clapperboard />Open project</Button>
          ) : (
            <Button disabled={starting} onClick={async () => { setStarting(true); await actions.startProject(idea); setStarting(false); }}>
              <Clapperboard />{starting ? "Starting…" : "Start video"}
            </Button>
          )}
          <Button
            variant="ghost"
            className="ml-auto text-destructive"
            onClick={() => { if (confirm("Delete this idea? Its saves stay in the library.")) { void actions.remove(idea.id); onClose(); } }}
          >
            <Trash2 />Delete
          </Button>
        </div>
      </section>

      <Dialog open={!!previewed} onOpenChange={(open) => { if (!open) setPreviewing(null); }}>
        <DialogContent showCloseButton={false} className="h-[min(52rem,calc(100dvh-2rem))] gap-0 p-0 sm:max-w-lg">
          <DialogTitle className="sr-only">{previewed ? "Save preview" : ""}</DialogTitle>
          {previewed && (
            <SavePreview
              save={previewed}
              onClose={() => setPreviewing(null)}
              onPrev={idea.saves.length > 1 ? () => setPreviewing(neighbour(idea.saves, previewed.id, -1)) : undefined}
              onNext={idea.saves.length > 1 ? () => setPreviewing(neighbour(idea.saves, previewed.id, 1)) : undefined}
              onChanged={() => void actions.refresh()}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
