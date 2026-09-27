import type { Clip, CaptionCue } from "../types";
import { buildTimeMap, mapWords, toLines } from "./timeline";

/** Use the renderer's cuts and line grouping, retaining source word addresses for edits. */
export function captionCues(clip: Clip): CaptionCue[] {
  const map = buildTimeMap(clip);
  const entries = clip.words.flatMap((word, index) => mapWords(map, [word]).map(mapped => ({ word: mapped, index })));
  return toLines(entries.map(entry => entry.word), clip.captions.maxWordsPerLine).map(line => ({
    start: Math.max(0, line.start + clip.captions.syncOffsetMs / 1000),
    end: Math.min(map.duration, line.end + clip.captions.syncOffsetMs / 1000),
    indices: line.words.map(word => entries.find(entry => entry.word === word)!.index),
    text: line.words.map(word => word.w).join(" "),
  }));
}

/** Corrections retain word timing; a changed word count is spread over the selected phrase. */
export function replaceCaptionText(clip: Clip, indices: number[], text: string): Clip["words"] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const selected = indices.map(index => clip.words[index]);
  if (!selected.length) return clip.words;
  const duration = selected.reduce((total, word) => total + word.d, 0);
  const replacements = tokens.map((w, index) => {
    if (tokens.length === selected.length) return { ...selected[index], w };
    // Place new words only within the original spoken spans. A silence cut between
    // words must not swallow a new word placed halfway through that removed time.
    let offset = duration * index / tokens.length;
    for (const word of selected) {
      if (offset < word.d) return { w, t: word.t + offset, d: Math.min(word.d - offset, duration / tokens.length) };
      offset -= word.d;
    }
    return { ...selected.at(-1)!, w };
  });
  return clip.words.flatMap((word, index) => {
    if (index === indices[0]) return replacements;
    return indices.includes(index) ? [] : [word];
  }).sort((a, b) => a.t - b.t);
}
