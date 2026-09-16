"use client";

import { useMemo } from "react";
import { Player } from "@remotion/player";
import { ClipComposition } from "@/../remotion/ClipComposition";
import { buildTimeMap } from "@/lib/timeline";
import type { Clip, Edl } from "@/lib/edl";

export function ClipPreview({
  clip,
  edl,
  sourceUrl,
  assetBase,
}: {
  clip: Clip;
  edl: Edl;
  sourceUrl: string;
  assetBase: string;
}) {
  const durationInFrames = useMemo(
    () => Math.max(1, Math.round(buildTimeMap(clip).duration * edl.output.fps)),
    [clip, edl.output.fps],
  );

  const inputProps = useMemo(
    () => ({
      clip,
      sourceUrl,
      sourceWidth: edl.source.width,
      sourceHeight: edl.source.height,
      assetBase,
    }),
    [clip, sourceUrl, assetBase, edl.source.width, edl.source.height],
  );

  return (
    <Player
      component={ClipComposition}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      fps={edl.output.fps}
      compositionWidth={edl.output.width}
      compositionHeight={edl.output.height}
      controls
      doubleClickToFullscreen
      className="aspect-[9/16] w-full overflow-hidden rounded-2xl border border-border bg-black"
      style={{ width: "100%" }}
    />
  );
}
