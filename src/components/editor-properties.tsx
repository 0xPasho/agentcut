"use client";
import { useId, useState } from "react";
import { z } from "zod";
import { Clip, Edl, Transition, TransformKeyframe } from "@/lib/edl";
import { applyOperations, patchFromClip, type EditorOperation } from "@/lib/editor/operations";
import { DEFAULT_TRANSITION_SEC, TRANSITION_LABELS } from "@/lib/editor/transitions";
import { EASE_LABELS } from "@/lib/editor/motion";
import { describeAuthor } from "@/lib/editor/authorship";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Disclosure } from "./ui/disclosure";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

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
const names: Record<string, string> = { ease: "Travel to the next keyframe", t: "Start time (seconds)", d: "Duration (seconds)", x: "Left (pixels)", y: "Top / vertical position", w: "Width (pixels)", h: "Height (pixels)", start: "Source start (seconds)", end: "Source end (seconds)", crop: "Crop keyframes", layout: "Framing", topPct: "Top region (%)", camera: "Which half holds the person", src: "Asset ID or project filename", words: "Transcript words", w_word: "Word", p: "Recogniser confidence (0–1)", syncOffsetMs: "Caption sync (ms, + is later)", output: "Output", fontSizePct: "Font size (%)", maxWordsPerLine: "Words per line", positionY: "Caption position", gain: "Audio gain", duck: "Lower music during speech", loop: "Loop audio", durationSec: "Overlap (seconds)", kind: "Kind", direction: "Arrives from", color: "Colour" };
const labelFor = (key: string) => names[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
/**
 * A motion keyframe's geometry is a percentage of the OUTPUT frame; `crop`'s is source
 * pixels. The two share field names, so a keyframe says which one it means.
 */
const MOTION_NAMES: Record<string, string> = { t: "Moment (seconds)", x: "Left (% of frame)", y: "Top (% of frame)", width: "Width (%)", height: "Height (%)", rotation: "Rotation (degrees)", opacity: "Opacity (0–1)", volume: "Volume (0–2)" };
/**
 * What each choice in an enumerated field is called. The schema's own values are what
 * the agent writes; these are what a person reads, and they are the same words the
 * Motion panel and the timeline's seam menu use rather than a second vocabulary.
 */
const OPTION_LABELS: Record<string, string> = { ...EASE_LABELS, ...TRANSITION_LABELS, left: "The left", right: "The right", up: "Above", down: "Below" };
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
export function Fields({ schema, value, onChange, label, field }: { schema: Schema; value: unknown; onChange: (v: unknown) => void; label: string; field?: string }) {
  const id = useId();
  /**
   * Who put this here, read out rather than typed in.
   *
   * `by` is the mark the system writes — a template id, a rule, the turn of the
   * conversation that asked for it — and it is what "why is this here" answers on the
   * timeline and in the inspector. A text box invites somebody to overwrite the answer.
   * The value is untouched and still travels with the edit, so an agent sets it exactly
   * as before; only this panel stops pretending it is a field.
   */
  if (field === "by") return <p className="text-xs text-muted-foreground" title={String(value ?? "") || undefined}>{describeAuthor(String(value ?? ""))}</p>;
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches) {
    const item = value as Record<string, unknown>;
    const active = Math.max(0, branches.findIndex(b => b.properties?.type?.const === item?.type));
    return <div className="space-y-3"><div className="flex flex-col gap-1"><label id={id} className="text-xs">{label} type</label>
      <Select value={String(active)} onValueChange={v => onChange(seed(branches[Number(v)]))}>
        <SelectTrigger aria-labelledby={id} size="sm" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{branches.map((b,i) => <SelectItem key={i} value={String(i)}>{OPTION_LABELS[String(b.properties?.type?.const ?? "")] ?? String(b.properties?.type?.const ?? i)}</SelectItem>)}</SelectContent>
      </Select></div><Fields schema={branches[active]} value={value} onChange={onChange} label={label} /></div>;
  }
  if (schema.const !== undefined) return null;
  if (schema.type === "object") return <fieldset className="min-w-0 space-y-3"><legend className="pb-2 text-xs font-medium text-foreground/80">{label}</legend><div className="min-w-0 space-y-3 border-s border-foreground/10 ps-3">{Object.entries(schema.properties ?? {}).filter(([k]) => k !== "id").map(([key,s]) => <Fields key={key} field={key} schema={s} label={schema.properties?.ease ? MOTION_NAMES[key] ?? labelFor(key) : key === "w" && schema.properties?.d ? "Word" : key === "y" && schema.properties?.h ? "Top (pixels)" : labelFor(key)} value={(value as Record<string, unknown>)?.[key]} onChange={v => onChange({ ...(value as object), [key]: v })} />)}</div></fieldset>;
  if (schema.type === "array") {
    const values = (value ?? []) as unknown[];
    return <fieldset className="min-w-0 space-y-3"><legend className="pb-2 text-xs font-medium text-foreground/80">{label}</legend>
      <div className="min-w-0 space-y-5 border-s border-foreground/10 ps-3">
        {values.map((v,i) => <div key={i} className="space-y-2"><Fields schema={schema.items!} value={v} label={`${label} ${i+1}`} onChange={next => onChange(values.map((old,n) => n === i ? next : old))} /><Button size="xs" variant="outline" onClick={() => onChange(values.filter((_,n) => n !== i))}>Remove {label.toLowerCase()} {i+1}</Button></div>)}
        <Button size="sm" variant="outline" onClick={() => onChange([...values, seed(schema.items!)])}>Add {label.toLowerCase()}</Button>
      </div>
    </fieldset>;
  }
  if (schema.enum) return <div className="flex flex-col gap-1"><label id={id} className="text-xs">{label}</label>
    <Select value={String(value)} onValueChange={onChange}>
      <SelectTrigger aria-labelledby={id} size="sm" className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{schema.enum.map(v => <SelectItem key={String(v)} value={String(v)}>{OPTION_LABELS[String(v)] ?? String(v)}</SelectItem>)}</SelectContent>
    </Select></div>;
  if (schema.type === "boolean") return <Checkbox checked={!!value} onCheckedChange={onChange}>{label}</Checkbox>;
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
    <Disclosure summary="Output dimensions and frame rate"><Fields schema={outputSchema} value={output} onChange={v => setOutput(v as Edl["output"])} label="Output" /></Disclosure>
    {joint && <Disclosure open={!!transition} summary={`Transition from “${joint.previousTitle}”`} contentClassName="space-y-3 px-3 pt-1 pb-3">
      <p className="text-xs text-muted-foreground">How this shot arrives over the one before it on its track. The two play at once for the overlap, which comes out of the video's length rather than out of either shot's footage. This joint has room for {joint.maxSeconds.toFixed(2)}s.</p>
      <Checkbox checked={!!transition} onCheckedChange={on => setTransition(on ? Transition.parse({ durationSec: Math.min(DEFAULT_TRANSITION_SEC, Math.max(0.04, joint.maxSeconds)) }) : null)}>Blend into this shot</Checkbox>
      {transition && <Fields schema={transitionSchema} value={transition} onChange={v => setTransition(v as Transition)} label="Transition" />}
    </Disclosure>}
    {motion && <Disclosure open={keyframes.length > 0} summary="Motion keyframes" contentClassName="space-y-3 px-3 pt-1 pb-3">
      <p className="text-xs text-muted-foreground">Every moment this layer is pinned at, exactly as an agent reads and writes them. Times run from this shot’s own first frame and may not pass {motion.seconds.toFixed(2)}s, each one later than the last. A field no keyframe names is not animated and keeps the fixed placement above — a keyframe added here pins all of them, where <strong className="font-medium text-foreground">Motion</strong> pins only what you change.</p>
      {/* A new one lands after the last, holding what the layer is doing now, rather than on
          top of the keyframe at zero that almost every animated layer already has. */}
      <Fields schema={motionSchema({ ...motion.seed, t: keyframes.length ? Math.min(motion.seconds, Math.round((Math.max(...keyframes.map(key => key.t)) + 0.5) * 1000) / 1000) : 0 })}
        value={keyframes} onChange={v => setKeyframes(v as TransformKeyframe[])} label="Keyframe" />
    </Disclosure>}
    {/* Not an alert: nothing is wrong yet, and nothing has been lost. The same notice in
        the same words as Position & audio's, which is the other staged form in this panel. */}
    {stale && <p role="status" className="text-sm text-destructive">The clip changed while these fields were open. Your unsaved fields are kept — close and reopen Properties to load the latest values.</p>}
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
