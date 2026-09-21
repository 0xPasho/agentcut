"use client";
import { useId, useState } from "react";
import { z } from "zod";
import { Clip, Edl, Transition, TransformKeyframe } from "@/lib/edl";
import { applyOperations, patchFromClip, type EditorOperation } from "@/lib/editor/operations";
import { DEFAULT_TRANSITION_SEC } from "@/lib/editor/transitions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

// Generated from the SAME schema exposed to agents: new supported fields remain editable.
export type Schema = { type?: string; default?: unknown; const?: unknown; enum?: unknown[]; minimum?: number; maximum?: number; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[]; oneOf?: Schema[] };
const clipSchema = z.toJSONSchema(Clip) as Schema;
const outputSchema = (z.toJSONSchema(Edl) as Schema).properties!.output;
// The joint between this shot and the one before it, from the same schema the agent reads.
const transitionSchema = z.toJSONSchema(Transition) as Schema;
// And the layer's motion, from the same one again. A new keyframe is seeded with what the
// layer is doing right now, so adding one here never starts from a width of zero.
const keyframeSchema = z.toJSONSchema(TransformKeyframe) as Schema;
const motionSchema = (seed: Record<string, number>): Schema => ({
  type: "array",
  items: { ...keyframeSchema, properties: Object.fromEntries(Object.entries(keyframeSchema.properties ?? {})
    .map(([key, field]) => [key, key in seed ? { ...field, default: seed[key] } : field])) },
});
const names: Record<string, string> = { ease: "Travel to the next keyframe", by: "Placed by", t: "Start time (seconds)", d: "Duration (seconds)", x: "Left (pixels)", y: "Top / vertical position", w: "Width (pixels)", h: "Height (pixels)", start: "Source start (seconds)", end: "Source end (seconds)", crop: "Crop keyframes", layout: "Framing", topPct: "Top region (%)", src: "Asset ID or project filename", words: "Transcript words", w_word: "Word", p: "Recogniser confidence (0–1)", syncOffsetMs: "Caption sync (ms, + is later)", output: "Output", fontSizePct: "Font size (%)", maxWordsPerLine: "Words per line", positionY: "Caption position", gain: "Audio gain", duck: "Lower music during speech", loop: "Loop audio", durationSec: "Overlap (seconds)", kind: "Kind", direction: "Arrives from", color: "Colour" };
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
/** Where a transition can go, and what is there now. `null` when this shot opens its track. */
export type PropertyJoint = { sequenceId: string; itemId: string; previousTitle: string; maxSeconds: number; current: Transition | null };
/** The layer's motion: the keyframes on it now, and what a new one should start as. */
export type PropertyMotion = { sequenceId: string; itemId: string; seconds: number; current: TransformKeyframe[] | null; seed: Record<string, number> };

export function EditorProperties({ clip, edl, dispatch, onApplied, validationEdl, joint = null, motion = null, mapOperations = ops => ops }: { clip: Clip; edl: Edl; dispatch: (ops: EditorOperation[]) => void; onApplied: () => void; validationEdl?: Edl; joint?: PropertyJoint | null; motion?: PropertyMotion | null; mapOperations?: (ops: EditorOperation[]) => EditorOperation[] }) {
  const [draft, setDraft] = useState(clip);
  const [output, setOutput] = useState(edl.output);
  const [transition, setTransition] = useState<Transition | null>(joint?.current ?? null);
  const [keyframes, setKeyframes] = useState<TransformKeyframe[]>(motion?.current ?? []);
  const [base] = useState({ clip, output: edl.output, transition: joint?.current ?? null, keyframes: motion?.current ?? [] });
  const [error, setError] = useState("");
  const stale = JSON.stringify(base.clip) !== JSON.stringify(clip) || JSON.stringify(base.output) !== JSON.stringify(edl.output)
    || JSON.stringify(base.transition) !== JSON.stringify(joint?.current ?? null)
    || JSON.stringify(base.keyframes) !== JSON.stringify(motion?.current ?? []);
  return <div className="space-y-4">
    <p className="text-xs text-muted-foreground">Every clip property is editable here, including crop keyframes, split framing, caption styling, transcript timing, and all edit types.</p>
    <Fields schema={clipSchema} value={draft} onChange={v => setDraft(v as Clip)} label="Clip" />
    <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm">Output dimensions and frame rate</summary><div className="pt-3"><Fields schema={outputSchema} value={output} onChange={v => setOutput(v as Edl["output"])} label="Output" /></div></details>
    {joint && <details className="rounded-xl border border-border p-3" open={!!transition}><summary className="cursor-pointer text-sm">Transition from “{joint.previousTitle}”</summary><div className="space-y-3 pt-3">
      <p className="text-xs text-muted-foreground">How this shot arrives over the one before it on its track. The two play at once for the overlap, which comes out of the video's length rather than out of either shot's footage. This joint has room for {joint.maxSeconds.toFixed(2)}s.</p>
      <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={!!transition} onChange={e => setTransition(e.target.checked ? Transition.parse({ durationSec: Math.min(DEFAULT_TRANSITION_SEC, Math.max(0.04, joint.maxSeconds)) }) : null)} />Blend into this shot</label>
      {transition && <Fields schema={transitionSchema} value={transition} onChange={v => setTransition(v as Transition)} label="Transition" />}
    </div></details>}
    {motion && <details className="rounded-xl border border-border p-3" open={keyframes.length > 0}><summary className="cursor-pointer text-sm">Motion keyframes</summary><div className="space-y-3 pt-3">
      <p className="text-xs text-muted-foreground">Every moment this layer is pinned at, exactly as an agent reads and writes them. Times run from this shot’s own first frame and may not pass {motion.seconds.toFixed(2)}s, each one later than the last. A field no keyframe names is not animated and keeps the fixed placement above.</p>
      <Fields schema={motionSchema(motion.seed)} value={keyframes} onChange={v => setKeyframes(v as TransformKeyframe[])} label="Keyframe" />
    </div></details>}
    {stale && <p role="alert" className="text-sm text-destructive">The clip changed while these fields were open. Close and reopen Properties to load the latest values. Your unsubmitted fields are still here.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={stale} onClick={() => {
      try {
        const parsed = Clip.parse(draft);
        const operations: EditorOperation[] = [patchFromClip(clip, parsed)];
        if (JSON.stringify(output) !== JSON.stringify(base.output)) operations.push({ type: "output.patch", patch: output });
        // The joint is an item operation already, so it rides the same atomic batch untouched.
        const joined = joint && JSON.stringify(transition) !== JSON.stringify(joint.current)
          ? [{ type: "item.transition" as const, sequenceId: joint.sequenceId, itemId: joint.itemId, transition: transition ? Transition.parse(transition) : null, before: joint.current }]
          : [];
        // The motion is an item operation already, so it rides the same atomic batch too.
        const moved = motion && JSON.stringify(keyframes) !== JSON.stringify(motion.current ?? [])
          ? [{ type: "item.keyframes" as const, sequenceId: motion.sequenceId, itemId: motion.itemId, keyframes: keyframes.length ? z.array(TransformKeyframe).parse(keyframes) : null, before: motion.current }]
          : [];
        // Validate together before handing this batch to the shared session.
        const mapped = [...mapOperations(operations), ...joined, ...moved]; applyOperations(validationEdl ?? edl, mapped); dispatch(mapped); setError(""); onApplied();
      } catch(e) { setError((e as Error).message); }
    }}>Apply properties</Button>
  </div>;
}
