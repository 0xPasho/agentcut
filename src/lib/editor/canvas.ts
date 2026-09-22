import type { Clip, Edit, SequenceItem } from "../edl";
import { snapAxis } from "./snapping";

/** A measured rectangle, in the same pixels as the frame it was measured against. */
export type Box = { left: number; top: number; width: number; height: number };
/** What a drag on the canvas is moving inside a clip: one of its edits, or its caption block. */
export type OverlayTarget = { kind: "edit"; index: number } | { kind: "captions" };

const unit = (value: number) => Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));

/**
 * Where a pointer drag leaves a title, picture or the caption block, written back into the
 * clip in the frame's own 0..1 units so the preview, the export and the agent read the same
 * numbers. `box` is where the overlay was measured before the drag and `frame` is the item it
 * lives in, both in the same pixels; `dx`/`dy` is how far the pointer has travelled. With a
 * positive `snap` the box catches the frame's edges and centre exactly as a whole layer does,
 * and the guides say where a line should be drawn to show what it caught. Captions keep their
 * horizontal centring, so they only move up and down. Pure so pointer, keyboard and tests agree.
 */
export function moveOverlay(clip: Clip, target: OverlayTarget, box: Box, frame: { width: number; height: number }, dx: number, dy: number, snap = 0): { clip: Clip; guide: { x: number | null; y: number | null } } {
  if (!(frame.width > 0) || !(frame.height > 0)) throw new Error("The frame has no size to place anything in");
  const guide: { x: number | null; y: number | null } = { x: null, y: null };
  let left = box.left + dx, top = box.top + dy;
  if (target.kind === "edit") {
    const across = snapAxis(left, box.width, frame.width, snap);
    if (across) { left += across.delta; guide.x = across.guide; }
  }
  const down = snapAxis(top, box.height, frame.height, snap);
  if (down) { top += down.delta; guide.y = down.guide; }
  if (target.kind === "captions") {
    // positionY is the block's top edge, which is why it grows downward from wherever it lands.
    return { clip: { ...clip, captions: { ...clip.captions, positionY: unit(top / frame.height) } }, guide };
  }
  const edit = clip.edits[target.index];
  if (!edit) throw new Error("That edit is no longer on the clip");
  if (edit.type !== "text" && edit.type !== "image") throw new Error(`A ${edit.type} edit has no place on the canvas`);
  const next = { ...edit, x: unit((left + box.width / 2) / frame.width), y: unit((top + box.height / 2) / frame.height) };
  return { clip: { ...clip, edits: clip.edits.map((each, index) => index === target.index ? next : each) }, guide };
}

/** The short name a handle or an announcement uses for what it moves. */
export function overlayLabel(clip: Clip, target: OverlayTarget): string {
  if (target.kind === "captions") return "captions";
  const edit = clip.edits[target.index];
  if (!edit) return "edit";
  if (edit.type === "text") return `title “${edit.text.trim().slice(0, 24) || "untitled"}”`;
  if (edit.type === "image") return edit.caption.trim() ? `image “${edit.caption.trim().slice(0, 24)}”` : "image";
  return edit.type;
}

/** What one edit is called where it stands for a whole shot or a block on the timeline. */
export function effectLabel(edit: Edit): string {
  if (edit.type === "text") return edit.text || "Title";
  if (edit.type === "emphasis") return edit.words.join(" ") || "Emphasis";
  return ({ silence: "Cut", punch: "Punch-in", image: "Image", music: "Music", sfx: "Sound" } as Record<string, string>)[edit.type] ?? edit.type;
}

/** A scene with no footage under it, whose one edit fills it: a title card, a piece of music. */
export const standaloneScene = (item: Pick<SequenceItem, "mediaId" | "clip">) =>
  item.mediaId === null && item.clip.edits.length === 1 && item.clip.edits[0].t === 0
  && Math.abs(item.clip.edits[0].d - (item.clip.end - item.clip.start)) < 0.001;

/**
 * What this shot is called wherever it is named — the block on the timeline, the seam
 * menu between two of them, the Transition section in the properties panel.
 *
 * A source-backed shot is its clip's title. A standalone scene's title is the word
 * "Title", which names the kind and not the thing, so it is called by what it holds.
 * One answer, because a shot called two things in two panels reads as two shots.
 */
export const shotName = (item: Pick<SequenceItem, "mediaId" | "clip">) =>
  standaloneScene(item) ? effectLabel(item.clip.edits[0]) : item.clip.title;
