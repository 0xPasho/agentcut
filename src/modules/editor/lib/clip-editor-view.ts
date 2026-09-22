import type { Clip } from "../types";
import { buildTimeMap } from "./timeline";

export const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0,8)}`;

/** Clip-relative output seconds back to the clip's own source seconds, across its silence cuts. */
export function sourceSecondsAt(clip: Clip, outputSec: number) {
  const map = buildTimeMap(clip);
  for (const span of map.spans) if (outputSec <= span.outStart + span.srcEnd - span.srcStart) return span.srcStart + Math.max(0, outputSec - span.outStart);
  return map.spans.at(-1)?.srcEnd ?? 0;
}
