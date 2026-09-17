import type { VideoSequence } from "./edl";
import { buildTimeMap } from "./timeline";
/** One shared frame allocation for preview, timeline and exports. */
export function sequenceFrames(sequence: VideoSequence) {
  const cursors = new Map<number, number>();
  let end = 0;
  const items = sequence.items.map(item => {
    const layer = item.layer ?? 0;
    const duration = Math.max(1, Math.round(buildTimeMap(item.clip).duration * sequence.output.fps));
    const from = item.at == null ? (cursors.get(layer) ?? 0) : Math.round(item.at * sequence.output.fps);
    cursors.set(layer, from + duration);
    end = Math.max(end, from + duration);
    return { item, from, duration };
  });
  return { items, duration: Math.max(1, end) };
}
