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
  assetUrls,
}: {
  clip: Clip;
  edl: Edl;
  sourceUrl: string;
  assetBase: string;
  assetUrls: Record<string, string>;
}) {
  const durationInFrames = useMemo(
    () => Math.max(1, Math.round(buildTimeMap(clip).duration * edl.output.fps)),
    [clip, edl.output.fps],
  );

  // A project without a primary source has nothing to play behind the edits; the clip
  // still previews on black, framed by the output rather than by absent footage.
  const source = edl.source;
  const inputProps = useMemo(
    () => ({
      clip,
      sourceUrl: source ? sourceUrl : "",
      sourceWidth: source?.width ?? edl.output.width,
      sourceHeight: source?.height ?? edl.output.height,
      hideVideo: !source,
      assetBase,
      assetUrls,
    }),
    [clip, sourceUrl, assetBase, assetUrls, source, edl.output.width, edl.output.height],
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
