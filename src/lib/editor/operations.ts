import { z } from "zod";
import { CaptionStyle, Clip, Edl, Edit, type CropKeyframe, MediaSource, VideoSequence, SequenceItem, ItemPlacement, ItemTransform, Transition, DEFAULT_ITEM_TRANSFORM } from "../edl";
import { promoteClipToSequence } from "./editable-timeline";
import { sequenceFrames, transitionJoint } from "../sequences";
import { buildTimeMap } from "../timeline";
import { ProjectPlan, SequencePlan } from "../plan/schema";

/** Zod .partial() still applies nested defaults. Patch schemas MUST leave omitted fields absent. */
function patchSchema<T extends z.ZodRawShape>(shape: T) {
  const fields = Object.fromEntries(Object.entries(shape).map(([key, value]) => {
    let field = value as z.ZodType;
    while (field instanceof z.ZodDefault || field instanceof z.ZodPrefault) field = field.unwrap() as z.ZodType;
    return [key, field.optional()];
  })) as { [K in keyof T]: z.ZodOptional<z.ZodType<z.output<T[K]>>> };
  return z.object(fields).strict();
}
export const ClipPatch = patchSchema({ ...Clip.omit({ id: true, captions: true }).shape, captions: patchSchema(CaptionStyle.shape) });
export const OutputPatch = patchSchema(Edl.shape.output.unwrap().shape);
export const ItemPlacementPatch = patchSchema({ ...ItemPlacement.shape, transform: patchSchema(ItemTransform.shape) });
/** Plan patches are shallow: a nested section (brief, series) or an array (beats, rules) is replaced whole. */
export const ProjectPlanPatch = patchSchema(ProjectPlan.shape);
export const SequencePlanPatch = patchSchema(SequencePlan.shape);
export const EditorOperation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("clip.promote"), clipId: z.string() }).strict(),
  z.object({ type: z.literal("item.place"), sequenceId: z.string(), itemId: z.string(), patch: ItemPlacementPatch, before: ItemPlacementPatch.optional() }).strict(),
  z.object({ type: z.literal("media.add"), media: MediaSource }).strict(),
  z.object({ type: z.literal("media.remove"), mediaId: z.string() }).strict(),
  z.object({ type: z.literal("sequence.add"), sequence: VideoSequence }).strict(),
  z.object({ type: z.literal("sequence.remove"), sequenceId: z.string() }).strict(),
  z.object({ type: z.literal("sequence.patch"), sequenceId: z.string(), title: z.string().min(1).optional(), output: VideoSequence.shape.output.optional() }).strict(),
  z.object({ type: z.literal("item.edit.add"), sequenceId: z.string(), itemId: z.string(), edit: Edit }).strict(),
  z.object({ type: z.literal("item.add"), sequenceId: z.string(), item: SequenceItem, index: z.number().int().nonnegative().optional() }).strict(),
  z.object({ type: z.literal("item.remove"), sequenceId: z.string(), itemId: z.string() }).strict(),
  z.object({ type: z.literal("item.reorder"), sequenceId: z.string(), itemId: z.string(), layer: z.number().int().nonnegative(), index: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("item.move"), sequenceId: z.string(), itemId: z.string(), index: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("item.patch"), sequenceId: z.string(), itemId: z.string(), patch: ClipPatch, before: ClipPatch.optional() }).strict(),
  // The joint between this shot and the one before it on its track. `null` is a hard cut.
  // `before` is the same stale-form protection the staged panels use; `null` asserts there is none.
  z.object({ type: z.literal("item.transition"), sequenceId: z.string(), itemId: z.string(), transition: Transition.nullable(), before: Transition.nullable().optional() }).strict(),
  z.object({ type: z.literal("item.split"), sequenceId: z.string(), itemId: z.string(), at: z.number().positive(), newItemId: z.string().regex(/^[a-zA-Z0-9_-]+$/) }).strict(),
  z.object({ type: z.literal("item.detachAudio"), sequenceId: z.string(), itemId: z.string(), newItemId: z.string().regex(/^[a-zA-Z0-9_-]+$/), layer: z.number().int().nonnegative().optional() }).strict(),
  z.object({ type: z.literal("item.source"), sequenceId: z.string(), itemId: z.string(), mediaId: z.string().nullable(), start: z.number().nonnegative().optional(), end: z.number().positive().optional(), title: z.string().min(1).optional(), before: z.object({ mediaId: z.string().nullable() }).strict().optional() }).strict(),
  z.object({ type: z.literal("clip.add"), clip: Clip }).strict(),
  z.object({ type: z.literal("clip.remove"), clipId: z.string() }).strict(),
  z.object({ type: z.literal("clip.patch"), clipId: z.string(), patch: ClipPatch, before: ClipPatch.optional() }).strict(),
  z.object({ type: z.literal("edit.add"), clipId: z.string(), edit: Edit }).strict(),
  z.object({ type: z.literal("edit.replace"), clipId: z.string(), index: z.number().int().nonnegative(), edit: Edit }).strict(),
  z.object({ type: z.literal("edit.remove"), clipId: z.string(), index: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("output.patch"), patch: OutputPatch }).strict(),
  z.object({ type: z.literal("plan.patch"), patch: ProjectPlanPatch }).strict(),
  z.object({ type: z.literal("sequence.plan.patch"), sequenceId: z.string(), patch: SequencePlanPatch }).strict(),
]);
export type EditorOperation = z.infer<typeof EditorOperation>;
export const EditRequest = z.object({
  expectedRevision: z.number().int().nonnegative(),
  operations: z.array(EditorOperation).min(1).max(500),
}).strict();
export type EditorSnapshot = { revision: number; edl: Edl };

const positive = (n: number, name: string) => { if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be positive`); };

/**
 * What a clip's timings and geometry are measured against. A source-backed clip is
 * bounded by its footage; a canvas segment has no footage, so it is bounded only by
 * the frame it is composed into and may last as long as the author wants.
 */
type ClipBounds = { width: number; height: number; durationSec: number | null };

function validateClip(clip: Clip, bounds: ClipBounds) {
  if (!/^[a-zA-Z0-9_-]+$/.test(clip.id)) throw new Error("Clip IDs must be unique and contain only letters, digits, underscores or hyphens");
  if (clip.start < 0 || clip.end <= clip.start) throw new Error("Clip boundaries must be nonnegative and end after the start");
  if (bounds.durationSec !== null && clip.end > bounds.durationSec + 0.001) throw new Error("Clip boundaries must be within the source and end after the start");
  for (const edit of clip.edits) {
    if (edit.t < 0) throw new Error("Edit start must be nonnegative");
    positive(edit.d, "Edit duration");
  }
  for (const word of clip.words) { if (word.t < 0 || word.d <= 0) throw new Error("Word timing must be nonnegative with positive duration"); }
  const regions = [...clip.crop, ...(clip.layout.type === "split" ? [clip.layout.top, clip.layout.bottom] : [])];
  for (const r of regions) {
    positive(r.w, "Crop width"); positive(r.h, "Crop height");
    if (r.x < 0 || r.y < 0 || r.x + r.w > bounds.width + 1 || r.y + r.h > bounds.height + 1)
      throw new Error(bounds.durationSec === null ? "Framing rectangles must fit inside the output frame" : "Crop rectangles must fit inside the source");
  }
  if (clip.crop.some((k, i) => k.t < 0 || (i > 0 && k.t <= clip.crop[i - 1].t))) throw new Error("Crop keyframes must have increasing, nonnegative times");
}

function validateOutput(output: { width: number; height: number; fps: number }) {
  positive(output.width, "Output width"); positive(output.height, "Output height"); positive(output.fps, "Output frame rate");
  if (!Number.isInteger(output.width) || !Number.isInteger(output.height)) throw new Error("Output dimensions must be integers");
}

/** Shared domain validation: browser preview, agent tools and persistence all use this. */
export function validateEdl(input: unknown): Edl {
  const edl = Edl.parse(input);
  validateOutput(edl.output);
  if (edl.source) {
    positive(edl.source.width, "Source width"); positive(edl.source.height, "Source height");
    positive(edl.source.durationSec, "Source duration"); positive(edl.source.fps, "Source frame rate");
  } else if (edl.clips.length) {
    // Generated clips are cut out of the primary source. A source-free project can hold
    // sequences of imported media and canvas segments, but never these.
    throw new Error("Clips are cut from the project's source video, which this project does not have");
  }
  const ids = new Set<string>();
  for (const clip of edl.clips) {
    if (ids.has(clip.id)) throw new Error("Clip IDs must be unique and contain only letters, digits, underscores or hyphens");
    ids.add(clip.id);
    validateClip(clip, { width: edl.source!.width, height: edl.source!.height, durationSec: edl.source!.durationSec });
  }
  const mediaIds = new Set<string>();
  for (const media of edl.media) {
    if (mediaIds.has(media.id)) throw new Error("Media IDs must be unique");
    mediaIds.add(media.id);
  }
  for (const sequence of edl.sequences) {
    if (ids.has(sequence.id)) throw new Error("Sequence and clip IDs must be unique");
    ids.add(sequence.id);
    validateOutput(sequence.output);
    const itemIds = new Set<string>();
    for (const item of sequence.items) {
      if (itemIds.has(item.id)) throw new Error("Timeline item IDs must be unique within a sequence");
      itemIds.add(item.id);
      const source = item.mediaId === null ? null : edl.media.find(m => m.id === item.mediaId);
      if (item.mediaId !== null && !source) throw new Error("Timeline item references missing media");
      validateClip(item.clip, source
        ? { width: source.width, height: source.height, durationSec: source.durationSec }
        : { width: sequence.output.width, height: sequence.output.height, durationSec: null });
    }
  }
  return edl;
}

/** Keep existing content anchored to source time when trimming. */
function trim(clip: Clip, start: number, end: number): Clip {
  const shift = start - clip.start;
  const duration = end - start;
  const timed = <T extends { t: number; d: number }>(items: T[]): T[] => items.flatMap(item => {
    const t = item.t - shift, stop = Math.min(duration, t + item.d);
    return stop > Math.max(0, t) ? [{ ...item, t: Math.max(0, t), d: stop - Math.max(0, t) }] : [];
  });
  const keys = clip.crop;
  let crop: CropKeyframe[] = keys.map(k => ({ ...k, t: k.t - shift })).filter(k => k.t >= 0);
  if (keys.length && !crop.some(k => k.t === 0)) {
    const left = [...keys].reverse().find(k => k.t <= shift) ?? keys[0];
    const right = keys.find(k => k.t > shift) ?? left;
    const ratio = left === right ? 0 : Math.max(0, Math.min(1, (shift - left.t) / (right.t - left.t)));
    const first = { t: 0, x: left.x + (right.x-left.x)*ratio, y: left.y + (right.y-left.y)*ratio, w: left.w + (right.w-left.w)*ratio, h: left.h + (right.h-left.h)*ratio };
    crop = [first, ...crop];
  }
  return { ...clip, start, end, words: timed(clip.words), edits: timed(clip.edits), crop };
}

/**
 * Clamp word timings that a project may have been saved with before clip cutting
 * clamped them — a word starting a fraction before its clip's in-point.
 *
 * Validation runs over the whole EDL, so one such word froze every clip in the
 * project: no edit anywhere could be saved. Reading repairs it in place instead,
 * which is the only sound reading — a word cannot begin before its clip does.
 * Newly produced words are still rejected by validateClip, so this heals old data
 * without hiding a regression.
 */
export function repairWordTimes(edl: Edl): Edl {
  const words = (list: Clip["words"]) =>
    list.flatMap((word) => {
      if (word.t >= 0 && word.d > 0) return [word];
      const stop = word.t + word.d;
      const t = Math.max(0, word.t);
      // A word entirely before the clip's start has nothing left to show.
      return stop - t >= 0.01 ? [{ ...word, t, d: stop - t }] : [];
    });
  const clip = (c: Clip): Clip => (c.words.some((w) => w.t < 0 || w.d <= 0) ? { ...c, words: words(c.words) } : c);
  return {
    ...edl,
    clips: edl.clips.map(clip),
    sequences: edl.sequences.map((sequence) => ({
      ...sequence,
      items: sequence.items.map((item) => ({ ...item, clip: clip(item.clip) })),
    })),
  };
}

/** Pure, immutable operation engine. No UI- or provider-specific rules belong here. */
export function applyOperations(input: Edl, raw: unknown): Edl {
  const operations = z.array(EditorOperation).parse(raw);
  let next = Edl.parse(structuredClone(input));
  for (const op of operations) {
    if (op.type === "clip.promote") { next = promoteClipToSequence(next, op.clipId); continue; }
    if (op.type === "media.add") { next.media.push(op.media); continue; }
    if (op.type === "media.remove") {
      if (next.sequences.some(s => s.items.some(i => i.mediaId === op.mediaId))) throw new Error("Remove this media from sequences before removing it from the project");
      next.media = next.media.filter(m => m.id !== op.mediaId); continue;
    }
    if (op.type === "sequence.add") { next.sequences.push(op.sequence); continue; }
    if (op.type === "plan.patch") {
      next.plan = ProjectPlan.parse({ ...next.plan, ...op.patch });
      // A series can only order videos that exist.
      next.plan.series.order = next.plan.series.order.filter(id => next.sequences.some(s => s.id === id) || next.clips.some(c => c.id === id));
      continue;
    }
    if (op.type === "sequence.plan.patch") {
      const sequence = next.sequences.find(s => s.id === op.sequenceId);
      if (!sequence) throw new Error("Sequence not found");
      sequence.plan = SequencePlan.parse({ ...sequence.plan, ...op.patch });
      // A beat can only point at shots on this timeline.
      const ids = new Set(sequence.items.map(i => i.id));
      sequence.plan.beats = sequence.plan.beats.map(b => ({ ...b, itemIds: b.itemIds.filter(id => ids.has(id)) }));
      continue;
    }
    if (op.type === "sequence.remove" || op.type === "sequence.patch" || op.type.startsWith("item.")) {
      if (!("sequenceId" in op)) throw new Error("Missing sequence ID");
      const sequence = next.sequences.find(s => s.id === op.sequenceId);
      if (!sequence) throw new Error("Sequence not found");
      if (op.type === "sequence.remove") { next.sequences = next.sequences.filter(s => s.id !== op.sequenceId); continue; }
      if (op.type === "sequence.patch") {
        if (op.title !== undefined) sequence.title = op.title;
        if (op.output !== undefined) sequence.output = op.output;
        continue;
      }
      if (op.type === "item.add") {
        const index = op.index ?? sequence.items.length;
        if (index > sequence.items.length) throw new Error("Insertion position is outside the timeline");
        sequence.items.splice(index, 0, op.item); continue;
      }
      if (!("itemId" in op)) throw new Error("Missing item ID");
      const index = sequence.items.findIndex(i => i.id === op.itemId);
      if (index < 0) throw new Error("Timeline item not found");
      const item = sequence.items[index];
      if (op.type === "item.place") {
        const current = { at: item.at ?? null, layer: item.layer ?? 0, volume: item.volume ?? 1, muted: item.muted ?? false, hidden: item.hidden ?? false, transform: { ...DEFAULT_ITEM_TRANSFORM, ...item.transform } };
        if (op.before) for (const key of Object.keys(op.before) as (keyof typeof op.before)[]) {
          if (key === "transform") {
            for (const field of Object.keys(op.before.transform ?? {}) as (keyof typeof current.transform)[]) {
              if (current.transform[field] !== op.before.transform![field]) throw new Error("The item's transform changed. Review the latest values before applying this edit.");
            }
          } else if (current[key] !== op.before[key]) throw new Error(`The item's ${key} changed. Review the latest values before applying this edit.`);
        }
        const { transform, ...placement } = op.patch;
        Object.assign(item, placement);
        if (transform) item.transform = { ...current.transform, ...transform };
      }
      if (op.type === "item.transition") {
        if (op.before !== undefined && JSON.stringify(item.transition ?? null) !== JSON.stringify(op.before))
          throw new Error("The shot's transition changed. Review the latest values before applying this edit.");
        if (op.transition === null) { delete item.transition; continue; }
        const joint = transitionJoint(sequence, op.itemId);
        if (!joint) throw new Error(`“${item.clip.title}” is the first shot on its track, so there is nothing before it to transition from.`);
        const fps = sequence.output.fps, wanted = Math.round(op.transition.durationSec * fps);
        if (wanted < 1) throw new Error(`A transition has to last at least one frame — ${(1 / fps).toFixed(3)}s at ${fps} frames per second.`);
        if (wanted > joint.maxFrames) throw new Error(joint.maxFrames < 1
          ? `“${joint.previous.clip.title}” and “${item.clip.title}” are too short to hold a transition between them.`
          : `A ${op.transition.durationSec}s transition does not fit between “${joint.previous.clip.title}” and “${item.clip.title}”. The longest this joint can take is ${(joint.maxFrames / fps).toFixed(2)}s.`);
        // A shot pinned to a fixed time cannot be pulled back into its neighbour, so it can
        // only blend over the overlap it already has.
        if (joint.overlapFrames !== null && joint.overlapFrames < wanted)
          throw new Error(`“${item.clip.title}” starts at a time set by hand and overlaps “${joint.previous.clip.title}” by ${(joint.overlapFrames / fps).toFixed(2)}s. Let it follow the shot before it, or move it back, before asking for a ${op.transition.durationSec}s transition.`);
        item.transition = op.transition;
        continue;
      }
      if (op.type === "item.edit.add") item.clip.edits.push(op.edit);
      if (op.type === "item.remove") {
        sequence.items.splice(index, 1);
        // A beat that spanned only this shot has nothing left to point at.
        sequence.plan.beats = sequence.plan.beats
          .map(b => ({ ...b, itemIds: b.itemIds.filter(id => id !== op.itemId) }))
          .filter(b => b.itemIds.length > 0 || !sequence.plan.beats.find(o => o.id === b.id)?.itemIds.length);
      }
      if (op.type === "item.reorder") {
        const resolved = sequenceFrames(sequence).items;
        const chronological = [...resolved].sort((a, b) => a.from - b.from);
        const destination = chronological.filter(entry => entry.item.id !== item.id && (entry.item.layer ?? 0) === op.layer).map(entry => entry.item);
        if (op.index > destination.length) throw new Error("Insertion position is outside the destination track");
        const oldLayer = item.layer ?? 0;
        destination.splice(op.index, 0, item);
        const rippleOriginal = oldLayer === 0 && op.layer !== 0;
        const original = rippleOriginal ? chronological.filter(entry => entry.item.id !== item.id && (entry.item.layer ?? 0) === 0).map(entry => entry.item) : [];
        const packed = new Set([...destination, ...original].map(entry => entry.id));
        // Array order drives automatic placement. Freeze every untouched track before
        // reordering so an overlay never moves as a side effect of a main-track edit.
        const untouched = resolved.filter(entry => !packed.has(entry.item.id)).map(entry => ({ ...entry.item, at: entry.from / sequence.output.fps }));
        for (const entry of destination) { entry.at = null; entry.layer = op.layer; }
        for (const entry of original) entry.at = null;
        sequence.items = [...untouched, ...original, ...destination];
      }
      if (op.type === "item.move") {
        if (op.index >= sequence.items.length) throw new Error("Position is outside the timeline");
        sequence.items.splice(index, 1); sequence.items.splice(op.index, 0, item);
      }
      if (op.type === "item.patch") {
        if (op.before) for (const key of Object.keys(op.before) as (keyof typeof op.before)[]) {
          if (JSON.stringify(item.clip[key]) !== JSON.stringify(op.before[key])) throw new Error(`The shot's ${key} changed. Review the latest values before applying this edit.`);
        }
        let clip = item.clip;
        if (op.patch.start !== undefined || op.patch.end !== undefined) clip = trim(clip, op.patch.start ?? clip.start, op.patch.end ?? clip.end);
        item.clip = { ...clip, ...op.patch, captions: { ...clip.captions, ...op.patch.captions } };
      }
      if (op.type === "item.source") {
        if (op.before && (item.mediaId ?? null) !== op.before.mediaId) throw new Error("The item's source changed. Review the latest values before applying this edit.");
        const source = op.mediaId === null ? null : next.media.find(m => m.id === op.mediaId);
        if (op.mediaId !== null && !source) throw new Error("Timeline item references missing media");
        const start = op.start ?? 0;
        // Replacing footage keeps the slot the item already occupies, clamped to the new source.
        const wanted = op.end ?? start + (item.clip.end - item.clip.start);
        const end = Math.max(start + 1 / sequence.output.fps, Math.min(wanted, source?.durationSec ?? wanted));
        const duration = end - start;
        // The transcript and crop rectangles describe the footage that is being replaced.
        const edits = item.clip.edits.flatMap(edit => {
          const stop = Math.min(duration, edit.t + edit.d);
          return edit.t < duration && stop > edit.t ? [{ ...edit, d: stop - edit.t }] : [];
        });
        item.mediaId = op.mediaId;
        item.clip = { ...item.clip, start, end, edits, words: [], crop: [], title: op.title ?? item.clip.title };
        continue;
      }
      if (op.type === "item.detachAudio") {
        // A canvas scene's sound is already its own edits; there is no footage track under it.
        if (item.mediaId === null) throw new Error("This scene has no footage audio to separate");
        if (item.muted) throw new Error("This shot is muted, so it has no audio to separate");
        const from = sequenceFrames(sequence).items[index].from;
        const layer = op.layer ?? Math.max(0, ...sequence.items.map(i => i.layer ?? 0)) + 1;
        // Silence cuts are what shape the time map, so the separated track keeps exactly
        // the length of the shot it came from. Captions, titles and pictures stay with
        // the picture; copying them would render everything twice.
        const audio = SequenceItem.parse({
          id: op.newItemId, mediaId: item.mediaId, at: from / sequence.output.fps, layer,
          hidden: true, muted: false, volume: item.volume ?? 1,
          clip: Clip.parse({
            id: op.newItemId, title: `${item.clip.title} (audio)`,
            start: item.clip.start, end: item.clip.end,
            captions: { preset: "none" },
            edits: item.clip.edits.filter(e => e.type === "silence"),
          }),
        });
        item.muted = true;
        sequence.items.splice(index + 1, 0, audio);
        continue;
      }
      if (op.type === "item.split") {
        const split = item.clip.start + op.at;
        if (split >= item.clip.end) throw new Error("Split must be inside the item, in seconds from its source start");
        const first = trim(item.clip, item.clip.start, split);
        const from = sequenceFrames(sequence).items[index].from;
        const firstFrames = Math.max(1, Math.round(buildTimeMap(first).duration * sequence.output.fps));
        // The opening blend belongs to the joint before the shot, which only the first
        // half still has. The second half meets the first on a hard cut.
        const { transition: _opening, ...halved } = item; void _opening;
        sequence.items.splice(index, 1,
          { ...item, clip: first },
          { ...halved, ...(item.at == null ? {} : { at: (from + firstFrames) / sequence.output.fps }), id: op.newItemId, clip: { ...trim(item.clip, split, item.clip.end), id: op.newItemId } });
      }
      continue;
    }

    if (op.type === "output.patch") { next.output = { ...next.output, ...op.patch }; continue; }
    if (op.type === "clip.add") { next.clips.push(op.clip); continue; }
    if (!("clipId" in op)) throw new Error("Unsupported operation");
    const index = next.clips.findIndex(c => c.id === op.clipId);
    if (index < 0) throw new Error(`Clip not found: ${op.clipId}`);
    if (op.type === "clip.remove") { next.clips.splice(index, 1); continue; }
    let clip = next.clips[index];
    if (op.type === "clip.patch") {
      if (op.before) for (const key of Object.keys(op.before) as (keyof typeof op.before)[]) {
        if (JSON.stringify(clip[key]) !== JSON.stringify(op.before[key])) throw new Error(`The clip's ${key} changed before this action completed. Review it and try again.`);
      }
      if (op.patch.start !== undefined || op.patch.end !== undefined) clip = trim(clip, op.patch.start ?? clip.start, op.patch.end ?? clip.end);
      next.clips[index] = { ...clip, ...op.patch, captions: { ...clip.captions, ...op.patch.captions } };
    } else {
      if (op.type === "edit.add") clip.edits.push(op.edit);
      else {
        if (op.index >= clip.edits.length) throw new Error("Edit index no longer exists");
        if (op.type === "edit.remove") clip.edits.splice(op.index, 1);
        else clip.edits[op.index] = op.edit;
      }
    }
  }
  return validateEdl(next);
}

/** Adapt a visual control's changed fields to the same operation used by agents. */
export function patchFromClip(before: Clip, after: Clip): EditorOperation {
  const patch: Record<string, unknown> = {};
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof Clip)[]) {
    if (key !== "id" && JSON.stringify(before[key]) !== JSON.stringify(after[key])) { patch[key] = after[key]; previous[key] = before[key]; }
  }
  return EditorOperation.parse({ type: "clip.patch", clipId: before.id, patch, before: previous });
}
