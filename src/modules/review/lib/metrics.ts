import type { Edl, VideoSequence } from "../../editor/types";
import { sequenceFrames } from "../../editor/lib/sequences";
import { buildTimeMap, mapWords } from "../../editor/lib/timeline";
import type { MetricBag } from "../types";

/**
 * Everything about a video that can be read off the project itself, before anything is
 * rendered. Pure, because this is the half of a review that must run on every export and
 * inside the editor without waiting for ffmpeg.
 *
 * A metric that cannot be read on this video — no captions, no hook, no split — is left
 * out of the bag rather than given a zero. A check against it is skipped and says why,
 * which is a different sentence from a check that failed.
 */

/** The share of the frame the caption band occupies, as `style.audit` reads it back. */
export const CAPTION_BAND = 0.07;

const minutes = (seconds: number) => Math.max(seconds, 0.001) / 60;

export function projectMetrics(edl: Edl, sequence: VideoSequence): MetricBag {
  const fps = sequence.output.fps;
  const resolved = sequenceFrames(sequence);
  const durationSec = resolved.duration / fps;
  const bag: MetricBag = { "video.durationSec": round(durationSec) };

  const main = sequence.items.filter((i) => (i.layer ?? 0) === 0);
  const footage = main.filter((i) => i.mediaId);
  const body = footage.find((i) => i.clip.title !== "Outro" && i.clip.title !== "Intro") ?? footage[0];
  bag["video.shots"] = main.length;
  bag["layers.max"] = sequence.items.reduce((most, i) => Math.max(most, i.layer ?? 0), 0);
  bag["transitions.count"] = resolved.items.filter((r) => r.transition).length;
  bag["endCard.present"] = sequence.items.some((i) => i.clip.title === "Outro");

  // A cut is a joint: between two shots, and between two kept spans of one shot after the
  // silence pass. Runs are counted rather than silence edits, because two cuts that touch
  // are one jump on screen.
  let runs = 0;
  let longestRun = 0;
  let longestGap = 0;
  let words = 0;
  for (const item of main) {
    const map = buildTimeMap(item.clip);
    runs += map.spans.length;
    for (const span of map.spans) longestRun = Math.max(longestRun, span.srcEnd - span.srcStart);
    const mapped = mapWords(map, item.clip.words);
    words += mapped.length;
    for (let i = 1; i < mapped.length; i++) longestGap = Math.max(longestGap, mapped[i].t - (mapped[i - 1].t + mapped[i - 1].d));
  }
  bag["video.cutsPerMin"] = round(Math.max(0, runs - 1) / minutes(durationSec));
  if (longestRun > 0) bag["video.longestShotSec"] = round(longestRun);
  if (words > 0) bag["silence.longestGapSec"] = round(Math.max(0, longestGap));

  const captioned = main.filter((i) => i.clip.captions.preset !== "none" && i.clip.words.length);
  bag["captions.on"] = captioned.length > 0;
  if (captioned.length) {
    bag["captions.wordsPerSec"] = round(words / Math.max(durationSec, 0.001));
    const style = (body && captioned.includes(body) ? body : captioned[0]).clip.captions;
    bag["captions.positionY"] = round(style.positionY);
    const layout = body?.clip.layout;
    if (layout?.type === "split") {
      const seam = layout.topPct / 100;
      const top = style.positionY;
      const bottom = top + CAPTION_BAND;
      bag["captions.crossesSeam"] = top < seam && bottom > seam;
      const middle = top + CAPTION_BAND / 2;
      bag["captions.overPerson"] = layout.camera === "top" ? middle < seam : middle >= seam;
    }
  }
  if (body) bag["layout.isSplit"] = body.clip.layout.type === "split";

  const hook = hookText(edl, sequence);
  bag["hook.present"] = hook.length > 0;
  if (hook) bag["hook.words"] = hook.split(/\s+/).filter(Boolean).length;

  const images = sequence.items.reduce((total, i) => total + i.clip.edits.filter((e) => e.type === "image").length, 0);
  bag["images.perMin"] = round(images / minutes(durationSec));
  return bag;
}

/** The line a card holds: the hook shot's title, the clip's own hook, else nothing. */
function hookText(edl: Edl, sequence: VideoSequence): string {
  const card = sequence.items.find((i) => i.clip.title === "Hook");
  const drawn = card?.clip.edits.find((e) => e.type === "text");
  if (drawn && "text" in drawn && drawn.text.trim()) return drawn.text.trim();
  const clip = edl.clips.find((c) => c.id === sequence.id);
  if (clip?.hook.trim()) return clip.hook.trim();
  return sequence.items.find((i) => i.clip.hook.trim())?.clip.hook.trim() ?? "";
}

const round = (n: number) => Math.round(n * 1000) / 1000;
