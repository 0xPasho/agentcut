import { DEFAULT_ITEM_TRANSFORM, type Edl, type SequenceItem } from "../edl";
import { promoteClipToSequence } from "./editable-timeline";
import { applyOperations, type EditorOperation } from "./operations";

const PLACEMENT = ["at", "layer", "transform", "volume", "muted", "hidden"] as const;
/** A trim rebases content, so undoing one has to restore everything it could have moved. */
const TIMED = ["start", "end", "words", "edits", "crop"] as const;

/**
 * Every placement field resolved to the value the reducer would read. An unset field must
 * invert to its default, not to `undefined`: `pick` drops those, and an empty patch is a
 * silent no-op — undo of a first mute, hide, volume or canvas drag would do nothing at all.
 */
const placementOf = (item: SequenceItem) => ({
  at: item.at ?? null,
  layer: item.layer ?? 0,
  transform: { ...DEFAULT_ITEM_TRANSFORM, ...item.transform },
  volume: item.volume ?? 1,
  muted: item.muted ?? false,
  hidden: item.hidden ?? false,
});
const pick = <T extends object>(source: T, keys: readonly (keyof T)[]) =>
  Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));

/**
 * The inverse of one batch, expressed in the same operations both interfaces use. Undo is
 * therefore an ordinary edit: it goes through the shared engine, the same validation, and
 * the same revision protocol, instead of writing a remembered EDL over the project.
 */
export function invertOperations(before: Edl, operations: EditorOperation[]): EditorOperation[] {
  // Inverting op k needs the state as it stood before it, which normally means replaying the
  // batch one operation at a time — each replay clones and revalidates the whole project. A
  // group move or a track swap emits one placement per timeline item, so that is quadratic in
  // the size of the sequence, on the drag-release path. Those batches never read each other:
  // each inverse reads only its own item's stored fields, which no sibling touches.
  if (operations.length > 1 && independent(operations)) return operations.flatMap(op => invertOne(before, op)).reverse();
  const inverse: EditorOperation[] = [];
  let state = before;
  for (const op of operations) {
    inverse.unshift(...invertOne(state, op));
    state = applyOperations(state, [op]);
  }
  return inverse;
}

/** Placements and patches, one per item: nothing here creates, removes or reorders anything. */
function independent(operations: EditorOperation[]): boolean {
  const seen = new Set<string>();
  for (const op of operations) {
    if (op.type !== "item.place" && op.type !== "item.patch") return false;
    const target = `${op.sequenceId}/${op.itemId}`;
    if (seen.has(target)) return false;
    seen.add(target);
  }
  return true;
}

/** Restore a sequence's exact array order; automatic placement follows array order. */
const restoreOrder = (sequenceId: string, items: SequenceItem[]): EditorOperation[] => [
  ...items.map((item): EditorOperation => ({ type: "item.place", sequenceId, itemId: item.id, patch: placementOf(item) })),
  ...items.map((item, index): EditorOperation => ({ type: "item.move", sequenceId, itemId: item.id, index })),
];

function invertOne(edl: Edl, op: EditorOperation): EditorOperation[] {
  switch (op.type) {
    case "clip.promote": {
      const index = edl.clips.findIndex(c => c.id === op.clipId);
      if (index < 0) return [];
      // Promotion also registers the original source as media the first time it happens.
      const created = promoteClipToSequence(edl, op.clipId).media.find(m => !edl.media.some(existing => existing.id === m.id));
      return [
        { type: "sequence.remove", sequenceId: op.clipId },
        // clip.add appends, so later clips are re-appended to restore the original order.
        ...edl.clips.slice(index).flatMap((clip, offset): EditorOperation[] =>
          offset === 0 ? [{ type: "clip.add", clip }] : [{ type: "clip.remove", clipId: clip.id }, { type: "clip.add", clip }]),
        ...(created ? [{ type: "media.remove", mediaId: created.id } as EditorOperation] : []),
      ];
    }
    case "media.add": return [{ type: "media.remove", mediaId: op.media.id }];
    case "media.remove": {
      const media = edl.media.find(m => m.id === op.mediaId);
      return media ? [{ type: "media.add", media }] : [];
    }
    case "sequence.add": return [{ type: "sequence.remove", sequenceId: op.sequence.id }];
    case "sequence.remove": {
      const sequence = edl.sequences.find(s => s.id === op.sequenceId);
      return sequence ? [{ type: "sequence.add", sequence }] : [];
    }
    case "sequence.patch": {
      const sequence = edl.sequences.find(s => s.id === op.sequenceId);
      if (!sequence) return [];
      return [{ type: "sequence.patch", sequenceId: op.sequenceId, ...(op.title !== undefined ? { title: sequence.title } : {}), ...(op.output !== undefined ? { output: sequence.output } : {}) }];
    }
    case "output.patch": return [{ type: "output.patch", patch: pick(edl.output, Object.keys(op.patch) as (keyof typeof edl.output)[]) }];
    case "plan.patch": return [{ type: "plan.patch", patch: pick(edl.plan, Object.keys(op.patch) as (keyof typeof edl.plan)[]) }];
    case "sequence.plan.patch": {
      const sequence = edl.sequences.find(s => s.id === op.sequenceId);
      return sequence ? [{ type: "sequence.plan.patch", sequenceId: op.sequenceId, patch: pick(sequence.plan, Object.keys(op.patch) as (keyof typeof sequence.plan)[]) }] : [];
    }
    case "clip.add": return [{ type: "clip.remove", clipId: op.clip.id }];
    case "clip.remove": {
      const clip = edl.clips.find(c => c.id === op.clipId);
      return clip ? [{ type: "clip.add", clip }] : [];
    }
    case "clip.patch": {
      const clip = edl.clips.find(c => c.id === op.clipId);
      if (!clip) return [];
      const keys = Object.keys(op.patch) as (keyof typeof clip)[];
      const restored = keys.some(key => key === "start" || key === "end") ? [...new Set([...keys, ...TIMED])] : keys;
      return [{ type: "clip.patch", clipId: op.clipId, patch: pick(clip, restored) }];
    }
    case "edit.add": case "edit.replace": case "edit.remove": {
      const clip = edl.clips.find(c => c.id === op.clipId);
      return clip ? [{ type: "clip.patch", clipId: op.clipId, patch: { edits: clip.edits } }] : [];
    }
    default: break;
  }
  const sequence = edl.sequences.find(s => s.id === op.sequenceId);
  if (!sequence) return [];
  if (op.type === "item.add") return [{ type: "item.remove", sequenceId: op.sequenceId, itemId: op.item.id }];
  const index = sequence.items.findIndex(i => i.id === op.itemId);
  const item = sequence.items[index];
  if (!item) return [];
  switch (op.type) {
    case "item.remove": return [
      { type: "item.add", sequenceId: op.sequenceId, item, index },
      ...(sequence.plan.beats.some(b => b.itemIds.includes(op.itemId)) ? [{ type: "sequence.plan.patch" as const, sequenceId: op.sequenceId, patch: { beats: sequence.plan.beats } }] : []),
    ];
    case "item.place": return [{ type: "item.place", sequenceId: op.sequenceId, itemId: op.itemId, patch: pick(placementOf(item), Object.keys(op.patch) as (keyof ReturnType<typeof placementOf>)[]) }];
    // Order and automatic placement are entangled, so both are restored wholesale.
    case "item.reorder": case "item.move": return restoreOrder(op.sequenceId, sequence.items);
    case "item.edit.add": return [{ type: "item.patch", sequenceId: op.sequenceId, itemId: op.itemId, patch: { edits: item.clip.edits } }];
    case "item.patch": {
      const keys = Object.keys(op.patch) as (keyof typeof item.clip)[];
      const restored = keys.some(key => key === "start" || key === "end") ? [...new Set([...keys, ...TIMED])] : keys;
      return [{ type: "item.patch", sequenceId: op.sequenceId, itemId: op.itemId, patch: pick(item.clip, restored) }];
    }
    case "item.split": return [
      { type: "item.remove", sequenceId: op.sequenceId, itemId: op.newItemId },
      { type: "item.patch", sequenceId: op.sequenceId, itemId: op.itemId, patch: pick(item.clip, TIMED) },
      { type: "item.place", sequenceId: op.sequenceId, itemId: op.itemId, patch: pick(placementOf(item), PLACEMENT) },
    ];
    case "item.source": return [
      { type: "item.source", sequenceId: op.sequenceId, itemId: op.itemId, mediaId: item.mediaId, start: item.clip.start, end: item.clip.end, title: item.clip.title },
      { type: "item.patch", sequenceId: op.sequenceId, itemId: op.itemId, patch: pick(item.clip, TIMED) },
    ];
    default: return [];
  }
}
