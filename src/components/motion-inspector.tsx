"use client";
import { useEffect, useState } from "react";
import { Diamond, Trash2, Volume2, ZoomIn } from "lucide-react";
import { Ease, type SequenceItem, type TransformKeyframe, type VideoSequence } from "@/lib/edl";
import type { EditorOperation } from "@/lib/editor/operations";
import { sequenceFrames } from "@/lib/sequences";
import { itemSeconds } from "@/lib/keyframes";
import { kenBurns, keyframeSummary, pinPlacement, pinVolume, removeKeyframe, retimeKeyframe } from "@/lib/editor/motion";
import { describeAuthor, isAgentAuthor } from "@/lib/editor/authorship";
import { usePlayheadSelector, usePlayheadStore } from "@/lib/editor/playhead";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** What each ease is called where a person chooses one. */
const EASE_LABELS: Record<string, string> = {
  linear: "Steady", ease: "Eased at both ends", in: "Slow to start", out: "Slow to finish", hold: "Hold, then jump",
};
const seconds = (value: number) => `${value.toFixed(2)}s`;

/**
 * A layer's motion, as the list of moments it is pinned at.
 *
 * The same `item.keyframes` operation an agent calls, with the same validation: every
 * button here builds an ordinary list and hands it to the shared engine, so an agent's
 * move opens in this panel as its own and a person's move reads the same way to the
 * agent. Nothing about animating lives only in here.
 */
export function MotionInspector({ sequence, item, dispatch, onSeek }: {
  sequence: VideoSequence; item: SequenceItem; dispatch: (ops: EditorOperation[]) => void; onSeek: (seconds: number) => void;
}) {
  const fps = sequence.output.fps;
  const entry = sequenceFrames(sequence).items.find(i => i.item.id === item.id)!;
  const offset = entry.from / fps, span = itemSeconds(item, fps);
  const keyframes = item.keyframes ?? [];
  const playhead = usePlayheadStore();
  /** Where the playhead is inside this shot, on a frame, or `null` when it is elsewhere. */
  const localAt = (at: number) => {
    const local = Math.round((at - offset) * fps) / fps;
    return local >= 0 && local <= span + 1e-6 ? local : null;
  };
  // Two primitives, not the position itself: the panel has a form in it and must not
  // re-render thirty times a second while the preview plays. `inside` changes only as the
  // playhead crosses this shot's edges, which is exactly when the Pin buttons change.
  const lit = usePlayheadSelector(at => {
    const local = localAt(at);
    return local === null ? -1 : keyframes.findIndex(key => Math.abs(key.t - local) < 0.5 / fps);
  });
  const inside = usePlayheadSelector(at => localAt(at) !== null);
  const here = () => localAt(playhead.get());
  const commit = (next: TransformKeyframe[] | null) =>
    dispatch([{ type: "item.keyframes", sequenceId: sequence.id, itemId: item.id, keyframes: next?.length ? next : null, before: item.keyframes ?? null }]);
  const outside = "Move the playhead into this shot to pin a moment on it.";

  // No heading of its own: the section this opens out of is already called Motion, and a
  // second one under it would be a label for nothing.
  return <div className="flex flex-col gap-3">
    <p className="text-xs leading-relaxed text-muted-foreground">
      Where this layer sits, how big it is and how loud it is, over its own {seconds(span)}. Times are counted from this shot’s first frame, so moving it along the timeline leaves the motion alone.
    </p>
    {keyframes.length === 0 ? <>
      <p className="text-xs text-muted-foreground">This layer holds still for the whole shot. Add a slow push, or pin where it is now and move it somewhere else later in the shot.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => commit(kenBurns(item, span))}><ZoomIn />Add a slow push</Button>
        <Button size="sm" variant="outline" disabled={!inside} title={inside ? undefined : outside}
          onClick={() => { const at = here(); if (at !== null) commit(pinPlacement(item, at)); }}><Diamond />Pin it here</Button>
      </div>
    </> : <>
      <ul className="flex flex-col gap-2">
        {keyframes.map((key, index) => <li key={index}
          className={`rounded-2xl border p-2.5 transition-colors duration-150 ease-out motion-reduce:transition-none ${lit === index ? "border-primary bg-primary/10" : "border-white/10 bg-white/5"}`}>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="ghost" className="tabular-nums" aria-current={lit === index ? "true" : undefined}
              onClick={() => onSeek(offset + key.t)}>{seconds(key.t)}</Button>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={`${keyframeSummary(key)} · ${describeAuthor(key.by)}`}>
              {keyframeSummary(key)}{isAgentAuthor(key.by) ? " · from the agent" : ""}
            </span>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove the keyframe at ${seconds(key.t)}`}
              onClick={() => commit(removeKeyframe(keyframes, index))}><Trash2 /></Button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <TimeField label="Moment (seconds)" value={key.t} max={span}
              onCommit={t => { if (t !== key.t) commit(retimeKeyframe(keyframes, index, t, span)); }} />
            <label className="flex flex-col gap-1 text-xs">Travel to the next
              <select className="h-8 rounded-xl border border-border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                value={key.ease} disabled={index === keyframes.length - 1}
                onChange={event => commit(keyframes.map((each, n) => n === index ? { ...each, ease: Ease.parse(event.target.value) } : each))}>
                {Ease.options.map(option => <option key={option} value={option}>{EASE_LABELS[option]}</option>)}
              </select>
            </label>
          </div>
        </li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="outline" disabled={!inside} title={inside ? undefined : outside}
          onClick={() => { const at = here(); if (at !== null) commit(pinPlacement(item, at)); }}><Diamond />Pin the placement here</Button>
        <Button size="xs" variant="outline" disabled={!inside} title={inside ? undefined : outside}
          onClick={() => { const at = here(); if (at !== null) commit(pinVolume(item, at)); }}><Volume2 />Pin the volume here</Button>
        <Button size="xs" variant="ghost" onClick={() => commit(null)}>Clear the motion</Button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Drag or resize the layer on the frame to change the moment the playhead is on.</p>
    </>}
  </div>;
}

/**
 * A number a person types, committed when they leave it or press Enter.
 *
 * Committing on every keystroke would make “1.25” three separate edits — and three
 * separate things to undo — with the half-typed ones landing on the timeline.
 */
function TimeField({ label, value, max, onCommit }: { label: string; value: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onCommit(Math.max(0, Math.min(max, Math.round(parsed * 1000) / 1000)));
    else setDraft(String(value));
  };
  return <label className="flex flex-col gap-1 text-xs">{label}
    <Input className="h-8" type="number" min={0} max={max} step="any" value={draft}
      onChange={event => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />
  </label>;
}
