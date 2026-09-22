"use client";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { VideoSequence } from "@/modules/editor/types";
import type { EditorOperation } from "@/modules/editor/lib/operations";
import { Card } from "../../../common/ui/card";
import { Button } from "../../../common/ui/button";
import { Input } from "../../../common/ui/input";
export function SequenceSettings({ sequence, dispatch }: { sequence: VideoSequence; dispatch: (ops: EditorOperation[]) => void }) {
  const [draft, setDraft] = useState(sequence);
  const [base, setBase] = useState(sequence);
  const stale = sequence.title !== base.title || JSON.stringify(sequence.output) !== JSON.stringify(base.output);
  useEffect(() => {
    if (stale && draft.title === base.title && JSON.stringify(draft.output) === JSON.stringify(base.output)) { setDraft(sequence); setBase(sequence); }
  }, [stale, draft, base, sequence]);
  // The heading belongs to whatever opens this — today the editor’s Video menu, which names it.
  return <Card className="gap-3 p-4"><form className="space-y-3" onSubmit={e => { e.preventDefault(); dispatch([{ type: "sequence.patch", sequenceId: sequence.id, title: draft.title, output: draft.output }]); setBase(draft); }}>
    <label className="space-y-2 text-xs">Video name<Input required value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
    <div className="grid grid-cols-2 gap-3">{(["width", "height", "fps"] as const).map(key => <label key={key} className="space-y-2 text-xs">{key === "fps" ? "Frame rate" : key === "width" ? "Width" : "Height"}<Input type="number" min={1} step={key === "fps" ? "any" : 1} required value={draft.output[key]} onChange={e => setDraft({ ...draft, output: { ...draft.output, [key]: Number(e.target.value) } })} /></label>)}</div>
    {stale && <p role="status" className="text-xs text-muted-foreground">Settings changed elsewhere. Load the latest settings before editing.</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" variant="outline" disabled={stale}>Apply settings</Button>{stale && <Button size="sm" type="button" variant="ghost" onClick={() => { setDraft(sequence); setBase(sequence); }}>Load latest</Button>}</div>
  </form><Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete video “${sequence.title}” and its timeline? Source media will remain.`)) dispatch([{ type: "sequence.remove", sequenceId: sequence.id }]); }}><Trash2 />Delete video</Button></Card>;
}
