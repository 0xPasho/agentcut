"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/common/api/client";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Textarea } from "@/common/ui/textarea";
import { MAX_STYLE_CHARS } from "../lib/style";
import type { PackExample, PackStyle } from "../types";

/**
 * A pack's style guide and its reference videos. Every button is a workspace action that
 * runs the same function as the agent's `packs.style.*` and `packs.examples.*` tools.
 */
export function StyleEditor({ packId }: { packId: string }) {
  const id = useId();
  const [style, setStyle] = useState<PackStyle | null>(null);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState({ file: "", title: "", note: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const loaded = await api.workspace<PackStyle>({ action: "packs.style.get", id: packId });
      setStyle(loaded);
      setText(loaded.text);
    } catch (reason) { setError((reason as Error).message); }
  }, [packId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    setError("");
    try {
      const next = await api.workspace<PackStyle>({ id: packId, ...body });
      setStyle(next);
      setText(next.text);
      return true;
    } catch (reason) {
      setError((reason as Error).message);
      return false;
    } finally { setBusy(""); }
  };

  if (!style && !error) return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 motion-safe:animate-spin" />Reading the guide…</p>;

  return (
    <div className="space-y-4 text-sm">
      {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">{error}</p>}
      <div className="space-y-2">
        <Label htmlFor={`${id}-style`}>Style guide</Label>
        <p className="text-xs text-muted-foreground">
          Who these videos are for, what a good one is, how the hooks sound and what they never do. The agents read it before choosing and editing; your own preferences win where the two disagree.
        </p>
        <Textarea id={`${id}-style`} rows={10} value={text} onChange={(event) => setText(event.target.value)} className="font-mono text-xs" />
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs tabular-nums ${text.length > MAX_STYLE_CHARS ? "text-destructive" : "text-muted-foreground"}`}>{text.length} / {MAX_STYLE_CHARS}</span>
          <Button size="sm" variant="outline" disabled={!!busy || text === style?.text} onClick={() => void run("style", { action: "packs.style.set", text })}>
            {busy === "style" ? <Loader2 className="motion-safe:animate-spin" /> : <Check />}Save guide
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Reference videos</h4>
        {!!style?.examples.length && (
          <ul className="grid gap-3">
            {style.examples.map((example) => <ExampleRow key={example.file} packId={packId} example={example} busy={!!busy} onSave={(details) => run(`save:${example.file}`, { action: "packs.examples.update", file: example.file, ...details })} onRemove={() => run(`remove:${example.file}`, { action: "packs.examples.remove", file: example.file })} />)}
          </ul>
        )}
        <form className="grid gap-2 rounded-xl border border-white/8 p-3" onSubmit={(event) => {
          event.preventDefault();
          void run("add", { action: "packs.examples.add", ...adding }).then((ok) => { if (ok) setAdding({ file: "", title: "", note: "" }); });
        }}>
          <Label htmlFor={`${id}-file`}>Add a reference video or picture</Label>
          <Input id={`${id}-file`} placeholder="~/Downloads/reference.mp4" value={adding.file} onChange={(event) => setAdding({ ...adding, file: event.target.value })} />
          <Input aria-label="Title" placeholder="Title" value={adding.title} onChange={(event) => setAdding({ ...adding, title: event.target.value })} />
          <Input aria-label="What to take from it" placeholder="What to take from it" value={adding.note} onChange={(event) => setAdding({ ...adding, note: event.target.value })} />
          <Button size="sm" type="submit" variant="outline" className="justify-self-start" disabled={!!busy || !adding.file.trim()}>
            {busy === "add" ? <Loader2 className="motion-safe:animate-spin" /> : <Plus />}Add reference
          </Button>
        </form>
      </div>
    </div>
  );
}

function ExampleRow({ packId, example, busy, onSave, onRemove }: {
  packId: string;
  example: PackExample & { still: string };
  busy: boolean;
  onSave: (details: { title: string; note: string }) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(example.title);
  const [note, setNote] = useState(example.note);
  const still = example.kind === "video" ? `${example.file}.jpg` : example.file;
  const changed = title !== example.title || note !== example.note;
  return (
    <li className="grid gap-2 rounded-xl border border-white/8 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local file served by the app, not an optimisable remote image */}
      <img src={`/api/packs/${packId}/file?path=${encodeURIComponent(still)}`} alt={`Stills from ${example.title || example.file}`} className="w-full rounded-lg" />
      <Input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
      <Textarea aria-label="What to take from it" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy || !changed} onClick={() => void onSave({ title, note })}><Check />Save</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}><Trash2 />Remove</Button>
      </div>
    </li>
  );
}
