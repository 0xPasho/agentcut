"use client";

import { useMemo } from "react";
import { Player } from "@remotion/player";
import { ClipComposition } from "@/../remotion/ClipComposition";
import { SequenceComposition } from "@/../remotion/SequenceComposition";
import { sourceUrl } from "@/common/api/client";
import { sequenceFrames } from "@/modules/editor/lib/sequences";
import { buildTimeMap, clipFrames } from "@/modules/editor/lib/timeline";
import type { Edl } from "@/modules/editor/types";
import type { ProjectVideo } from "@/modules/project/lib/overview";
import { FRAME } from "../data";
import { frameStyle } from "../lib/video-preview";

/**
 * The selected output, playing, whichever side of `clip.promote` it is on.
 *
 * Both branches run the same compositions the exporter runs, so what plays here is
 * what renders — a preview that only worked before the first edit is worse than none.
 */
export function VideoPreview({
  projectId,
  video,
  edl,
  assetUrls,
  maxHeight,
  autoPlay = false,
}: {
  projectId: string;
  video: ProjectVideo;
  edl: Edl;
  assetUrls: Record<string, string>;
  /** How tall the frame may grow; see `frameStyle`. */
  maxHeight?: number | string;
  autoPlay?: boolean;
}) {
  const assetBase = `/api/projects/${projectId}/asset/`;
  const mediaUrls = useMemo(
    () => Object.fromEntries(edl.media.map((m) => [m.id, `/api/projects/${projectId}/media/${m.id}`])),
    [edl.media, projectId],
  );

  const sequence = video.sequence;
  const sequenceProps = useMemo(
    () => (sequence ? { sequence, media: edl.media, mediaUrls, assetBase, assetUrls } : null),
    [sequence, edl.media, mediaUrls, assetBase, assetUrls],
  );

  const clip = video.clip;
  const clipProps = useMemo(
    () =>
      clip
        ? {
            clip,
            // A project with no primary source has nothing to play behind the edits;
            // the clip still previews on black, framed by the output.
            sourceUrl: edl.source ? sourceUrl(projectId) : "",
            sourceWidth: edl.source?.width ?? edl.output.width,
            sourceHeight: edl.source?.height ?? edl.output.height,
            hideVideo: !edl.source,
            assetBase,
            assetUrls,
          }
        : null,
    [clip, edl.source, edl.output.width, edl.output.height, projectId, assetBase, assetUrls],
  );

  if (sequence && sequenceProps) {
    const output = sequence.output;
    return (
      <Player
        key={`${projectId}:${video.id}`}
        component={SequenceComposition}
        inputProps={sequenceProps}
        durationInFrames={sequenceFrames(sequence).duration}
        fps={output.fps}
        compositionWidth={output.width}
        compositionHeight={output.height}
        controls
        doubleClickToFullscreen
        autoPlay={autoPlay}
        acknowledgeRemotionLicense
        className={FRAME}
        style={frameStyle(output, maxHeight)}
      />
    );
  }

  if (!clip || !clipProps) return null;
  return (
    <Player
      key={`${projectId}:${video.id}`}
      component={ClipComposition}
      inputProps={clipProps}
      durationInFrames={clipFrames(buildTimeMap(clip), edl.output.fps)}
      fps={edl.output.fps}
      compositionWidth={edl.output.width}
      compositionHeight={edl.output.height}
      controls
      doubleClickToFullscreen
      autoPlay={autoPlay}
      acknowledgeRemotionLicense
      className={FRAME}
      style={frameStyle(edl.output, maxHeight)}
    />
  );
}
