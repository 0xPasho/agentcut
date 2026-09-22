import type { TimeMap } from "./timeline";

export function timeLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toFixed(rest % 1 > .001 ? 1 : 0).padStart(rest % 1 > .001 ? 4 : 2, "0")}`;
}

export function sourceAt(map: TimeMap, output: number) {
  for (const span of map.spans) {
    if (output <= span.outStart + span.srcEnd - span.srcStart) return span.srcStart + Math.max(0, output - span.outStart);
  }
  return map.spans.at(-1)?.srcEnd ?? 0;
}
