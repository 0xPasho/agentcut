"use client";

import { useMemo } from "react";
import { Player } from "@remotion/player";
import { ClipComposition } from "@/../remotion/ClipComposition";
import { SequenceComposition } from "@/../remotion/SequenceComposition";
import { sourceUrl } from "@/lib/client";
import { sequenceFrames } from "@/lib/sequences";
import { buildTimeMap, clipFrames } from "@/lib/timeline";
import type { Edl } from "@/lib/edl";
import type { ProjectVideo } from "@/lib/overview";

const FRAME = "mx-auto w-full overflow-hidden rounded-3xl bg-black ring-1 ring-foreground/10";

/**
 * A 9:16 preview filling a 340px rail is 600px tall — taller than the panel beside
 * it and taller than most windows. Cap the tall ones by height and centre them.
 */
const MAX_HEIGHT = 460;
function frameStyle(output: { width: number; height: number }): React.CSSProperties {
  return {
    width: "100%",
    aspectRatio: `${output.width} / ${output.height}`,
    maxWidth: output.height > output.width ? `${Math.round((MAX_HEIGHT * output.width) / output.height)}px` : undefined,
  };
}

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
}: {
  projectId: string;
  video: ProjectVideo;
  edl: Edl;
  assetUrls: Record<string, string>;
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
        component={SequenceComposition}
        inputProps={sequenceProps}
        durationInFrames={sequenceFrames(sequence).duration}
        fps={output.fps}
        compositionWidth={output.width}
        compositionHeight={output.height}
        controls
        doubleClickToFullscreen
        acknowledgeRemotionLicense
        className={FRAME}
        style={frameStyle(output)}
      />
    );
  }

  if (!clip || !clipProps) return null;
  return (
    <Player
      component={ClipComposition}
      inputProps={clipProps}
      durationInFrames={clipFrames(buildTimeMap(clip), edl.output.fps)}
      fps={edl.output.fps}
      compositionWidth={edl.output.width}
      compositionHeight={edl.output.height}
      controls
      doubleClickToFullscreen
      acknowledgeRemotionLicense
      className={FRAME}
      style={frameStyle(edl.output)}
    />
  );
}
