"use client";
import { useId, useState } from "react";
import { z } from "zod";
import { Clip, Edl } from "@/lib/edl";
import { applyOperations, patchFromClip, type EditorOperation } from "@/lib/editor/operations";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

// Generated from the SAME schema exposed to agents: new supported fields remain editable.
export type Schema = { type?: string; default?: unknown; const?: unknown; enum?: unknown[]; minimum?: number; maximum?: number; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[]; oneOf?: Schema[] };
const clipSchema = z.toJSONSchema(Clip) as Schema;
const outputSchema = (z.toJSONSchema(Edl) as Schema).properties!.output;
const names: Record<string, string> = { t: "Start time (seconds)", d: "Duration (seconds)", x: "Left (pixels)", y: "Top / vertical position", w: "Width (pixels)", h: "Height (pixels)", start: "Source start (seconds)", end: "Source end (seconds)", crop: "Crop keyframes", layout: "Framing", topPct: "Top region (%)", src: "Asset ID or project filename", words: "Transcript words", w_word: "Word", output: "Output", fontSizePct: "Font size (%)", maxWordsPerLine: "Words per line", positionY: "Caption position", gain: "Audio gain", duck: "Lower music during speech", loop: "Loop audio" };
const labelFor = (key: string) => names[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
function seed(s: Schema): unknown {
  if (s.default !== undefined) return structuredClone(s.default);
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  if (s.anyOf || s.oneOf) return seed((s.anyOf ?? s.oneOf)![0]);
  if (s.type === "object") return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k,v]) => [k, seed(v)]));
  if (s.type === "array") return [];
  if (s.type === "number" || s.type === "integer") return s.minimum ?? 0;
  if (s.type === "boolean") return false;
  return "";
}
export function Fields({ schema, value, onChange, label }: { schema: Schema; value: unknown; onChange: (v: unknown) => void; label: string }) {
  const id = useId();
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches) {
    const item = value as Record<string, unknown>;
    const active = Math.max(0, branches.findIndex(b => b.properties?.type?.const === item?.type));
    return <div className="space-y-3"><div className="flex flex-col gap-1"><label htmlFor={id} className="text-xs">{label} type</label>
      <select id={id} className="h-9 rounded-xl border border-border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" value={active} onChange={e => onChange(seed(branches[Number(e.target.value)]))}>
        {branches.map((b,i) => <option key={i} value={i}>{String(b.properties?.type?.const ?? i)}</option>)}
      </select></div><Fields schema={branches[active]} value={value} onChange={onChange} label={label} /></div>;
  }
  if (schema.const !== undefined) return null;
  if (schema.type === "object") return <fieldset className="min-w-0 space-y-3 rounded-xl border border-border p-3"><legend className="px-1 text-sm font-medium">{label}</legend>{Object.entries(schema.properties ?? {}).filter(([k]) => k !== "id").map(([key,s]) => <Fields key={key} schema={s} label={key === "w" && schema.properties?.d ? "Word" : key === "y" && schema.properties?.h ? "Top (pixels)" : labelFor(key)} value={(value as Record<string, unknown>)?.[key]} onChange={v => onChange({ ...(value as object), [key]: v })} />)}</fieldset>;
  if (schema.type === "array") {
    const values = (value ?? []) as unknown[];
    return <fieldset className="min-w-0 space-y-3 rounded-xl border border-border p-3"><legend className="px-1 text-sm font-medium">{label}</legend>
      {values.map((v,i) => <div key={i} className="space-y-2 border-b border-border pb-3"><Fields schema={schema.items!} value={v} label={`${label} ${i+1}`} onChange={next => onChange(values.map((old,n) => n === i ? next : old))} /><Button size="xs" variant="outline" onClick={() => onChange(values.filter((_,n) => n !== i))}>Remove {label.toLowerCase()} {i+1}</Button></div>)}
      <Button size="sm" variant="outline" onClick={() => onChange([...values, seed(schema.items!)])}>Add {label.toLowerCase()}</Button>
    </fieldset>;
  }
  if (schema.enum) return <div className="flex flex-col gap-1"><label htmlFor={id} className="text-xs">{label}</label><select id={id} className="h-9 rounded-xl border border-border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" value={String(value)} onChange={e => onChange(e.target.value)}>{schema.enum.map(v => <option key={String(v)}>{String(v)}</option>)}</select></div>;
  if (schema.type === "boolean") return <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />{label}</label>;
  const numeric = schema.type === "number" || schema.type === "integer";
  return <div className="space-y-1"><label htmlFor={id} className="text-xs">{label}</label><Input id={id} type={numeric ? "number" : "text"} step={schema.type === "integer" ? 1 : "any"} min={schema.minimum} max={schema.maximum} value={value === undefined ? "" : String(value)} onChange={e => onChange(numeric ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} /></div>;
}
export function EditorProperties({ clip, edl, dispatch, onApplied, validationEdl, mapOperations = ops => ops }: { clip: Clip; edl: Edl; dispatch: (ops: EditorOperation[]) => void; onApplied: () => void; validationEdl?: Edl; mapOperations?: (ops: EditorOperation[]) => EditorOperation[] }) {
  const [draft, setDraft] = useState(clip);
  const [output, setOutput] = useState(edl.output);
  const [base] = useState({ clip, output: edl.output });
  const [error, setError] = useState("");
  const stale = JSON.stringify(base.clip) !== JSON.stringify(clip) || JSON.stringify(base.output) !== JSON.stringify(edl.output);
  return <div className="space-y-4">
    <p className="text-xs text-muted-foreground">Every clip property is editable here, including crop keyframes, split framing, caption styling, transcript timing, and all edit types.</p>
    <Fields schema={clipSchema} value={draft} onChange={v => setDraft(v as Clip)} label="Clip" />
    <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm">Output dimensions and frame rate</summary><div className="pt-3"><Fields schema={outputSchema} value={output} onChange={v => setOutput(v as Edl["output"])} label="Output" /></div></details>
    {stale && <p role="alert" className="text-sm text-destructive">The clip changed while these fields were open. Close and reopen Properties to load the latest values. Your unsubmitted fields are still here.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={stale} onClick={() => {
      try {
        const parsed = Clip.parse(draft);
        const operations: EditorOperation[] = [patchFromClip(clip, parsed)];
        if (JSON.stringify(output) !== JSON.stringify(base.output)) operations.push({ type: "output.patch", patch: output });
        // Validate together before handing this batch to the shared session.
        const mapped = mapOperations(operations); applyOperations(validationEdl ?? edl, mapped); dispatch(mapped); setError(""); onApplied();
      } catch(e) { setError((e as Error).message); }
    }}>Apply properties</Button>
  </div>;
}
