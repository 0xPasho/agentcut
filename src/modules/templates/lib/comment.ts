import type { EditorOperation } from "../../editor/lib/operations";
import { Clip, type VideoSequence } from "../../editor/types";
import { sequenceFrames } from "../../editor/lib/sequences";
import { buildTimeMap, outToSrc, srcToOut } from "../../editor/lib/timeline";
import type { CommentReading, TemplateComment } from "../types";

/**
 * The `pop` comment: the video opens on the footage and the hook, and a beat later the
 * viewer's message bursts in over a blurred frame with a pop, held while the streamer
 * reads it out, gone on the frame they finish. The hook never leaves and the captions
 * never stop. The template and the hand placement both build it here, so a comment a
 * person chose lands exactly where the template would have put it.
 */

/** Held at least this long, so a two-word question is still a card somebody can read. */
const MIN_HOLD_SEC = 0.8;
/** It stays up this much after the last word of it is said. */
const AFTER_READING_SEC = 0.3;

/** Where on the programme the streamer reads the comment out, if they do. */
export function readingOnProgramme(sequence: VideoSequence, reading: CommentReading | null | undefined): { start: number; end: number } | null {
  if (!reading) return null;
  const entry = sequenceFrames(sequence).items.find((candidate) => candidate.item.id === reading.itemId);
  if (!entry) return null;
  const map = buildTimeMap(entry.item.clip);
  const base = entry.from / sequence.output.fps;
  return { start: base + srcToOut(map, reading.t), end: base + srcToOut(map, reading.t + reading.d) };
}

/**
 * The seconds of the programme the card is on screen. It lands no earlier than
 * `delaySec` into the video — the first half-second is the clip and its hook — and on
 * the streamer's first word of it when that comes later; it leaves just after their last,
 * and never before `seconds` have passed.
 */
export function popWindow(
  sequence: VideoSequence,
  look: Pick<TemplateComment, "delaySec" | "seconds" | "followReading">,
  body: { start: number; end: number },
  reading: CommentReading | null | undefined,
): { at: number; end: number } {
  const read = look.followReading ? readingOnProgramme(sequence, reading) : null;
  const earliest = body.start + look.delaySec;
  // Read out before the delay is up: the card still waits for it, unless that would miss
  // the whole reading — then it lands with the first word.
  const at = read && read.end - AFTER_READING_SEC < earliest ? Math.max(body.start, read.start) : Math.max(read?.start ?? earliest, earliest);
  const end = Math.min(body.end - 0.2, Math.max(read ? read.end + AFTER_READING_SEC : 0, at + look.seconds));
  return { at: Math.min(at, Math.max(body.start, end - MIN_HOLD_SEC)), end };
}

/** The card as a layer: no animation at all — it is on the frame it lands, off the frame it goes. */
export function popCommentItem(
  sequenceId: string, id: string, src: string, window: { at: number; end: number }, layer: number,
  look: Pick<TemplateComment, "y" | "widthPct">, sound: { src: string; gain: number; durationSec: number } | null, title: string, by: string,
): Extract<EditorOperation, { type: "item.add" }> {
  const seconds = Math.max(MIN_HOLD_SEC / 2, window.end - window.at);
  return {
    type: "item.add",
    sequenceId,
    item: {
      id, mediaId: null, at: window.at, layer,
      clip: Clip.parse({
        id, title, start: 0, end: seconds, captions: { preset: "none" },
        edits: [
          { type: "image", t: 0, d: seconds, src, query: "", credit: "", x: 0.5, y: look.y, widthPct: look.widthPct, heightPct: 60, style: "plain", caption: "", by },
          ...(sound ? [{ type: "sfx" as const, t: 0, d: sound.durationSec, src: sound.src, gain: sound.gain, by }] : []),
        ],
      }),
    },
  };
}

/**
 * Blur everything under the card for as long as it is up: each layer below it gets a
 * `blur` edit over the part of it the window covers, written in that layer's own source
 * seconds so the cuts under it carry it along. Captions are drawn sharp over a blur.
 */
export function blurUnder(sequence: VideoSequence, window: { at: number; end: number }, amount: number, belowLayer: number, by: string): EditorOperation[] {
  if (amount <= 0) return [];
  const fps = sequence.output.fps;
  const operations: EditorOperation[] = [];
  for (const entry of sequenceFrames(sequence).items) {
    if ((entry.item.layer ?? 0) >= belowLayer) continue;
    const from = entry.from / fps;
    const start = Math.max(window.at, from);
    const end = Math.min(window.end, from + entry.duration / fps);
    if (end - start < 1 / fps) continue;
    const map = buildTimeMap(entry.item.clip);
    const t = outToSrc(map, start - from);
    const d = outToSrc(map, end - from) - t;
    if (d <= 0) continue;
    operations.push({ type: "item.edit.add", sequenceId: sequence.id, itemId: entry.item.id, edit: { type: "blur", t, d, amount, by } });
  }
  return operations;
}
