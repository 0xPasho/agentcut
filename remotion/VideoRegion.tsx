import React from "react";
import { OffthreadVideo, Sequence, useVideoConfig } from "remotion";
import type { Region } from "../src/lib/edl";
import type { TimeMap } from "../src/lib/timeline";

type Props = {
  sourceUrl: string;
  /** Rectangle of the source to show, in source pixels. */
  region: Region;
  sourceWidth: number;
  sourceHeight: number;
  /** Output box this region fills. */
  boxWidth: number;
  boxHeight: number;
  /** Clip start in source seconds, and the kept spans after silence cuts. */
  clipStart: number;
  map: TimeMap;
  zoom?: number;
  /** A number, or the shot's gain at a frame of its own — that is how a crossfade arrives. */
  volume?: number | ((itemFrame: number) => number);
  muted?: boolean;
};

/**
 * Renders `region` of the source so it covers `boxWidth x boxHeight`.
 *
 * transform-origin is the top-left corner, so the transform reads as
 * `p -> p * scale + translate` and the region's centre lands on the box's centre.
 */
export const VideoRegion: React.FC<Props> = ({
  sourceUrl,
  region,
  sourceWidth,
  sourceHeight,
  boxWidth,
  boxHeight,
  clipStart,
  map,
  zoom = 1,
  volume = 1,
  muted = false,
}) => {
  const { fps } = useVideoConfig();

  const w = Math.max(1, region.w);
  const h = Math.max(1, region.h);
  const scale = Math.max(boxWidth / w, boxHeight / h) * zoom;
  const tx = boxWidth / 2 - (region.x + w / 2) * scale;
  const ty = boxHeight / 2 - (region.y + h / 2) * scale;

  // Remotion Studio opens a composition with its defaultProps, where there is no
  // source yet. Render an empty box instead of letting OffthreadVideo throw.
  if (!sourceUrl) {
    return (
      <div
        className="flex items-center justify-center bg-neutral-900 text-xs text-neutral-500"
        style={{ width: boxWidth, height: boxHeight }}
      >
        no source
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden bg-black" style={{ width: boxWidth, height: boxHeight }}>
      <div
        className="absolute top-0 left-0"
        style={{
          width: sourceWidth,
          height: sourceHeight,
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        {map.spans.map((span) => {
          const from = Math.round(span.outStart * fps);
          return (
          <Sequence
            key={span.srcStart}
            from={from}
            durationInFrames={Math.max(1, Math.round((span.srcEnd - span.srcStart) * fps))}
            layout="none"
          >
            <OffthreadVideo
              src={sourceUrl}
              // A span starts partway into the shot, so its own frame has to be put back
              // into the shot's timebase before the ramp can be read off it.
              volume={typeof volume === "function" ? (f: number) => volume(from + f) : volume}
              muted={muted}
              trimBefore={Math.round((clipStart + span.srcStart) * fps)}
              trimAfter={Math.round((clipStart + span.srcEnd) * fps)}
              style={{ width: sourceWidth, height: sourceHeight, position: "absolute", top: 0, left: 0 }}
            />
          </Sequence>
          );
        })}
      </div>
    </div>
  );
};
