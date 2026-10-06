"use client";

import { useEffect, useMemo, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { ClipComposition } from "@/../remotion/ClipComposition";
import { SequenceComposition } from "@/../remotion/SequenceComposition";
import { sourceUrl } from "@/common/api/client";
import { sequenceFrames } from "@/modules/editor/lib/sequences";
import { buildTimeMap, clipFrames } from "@/modules/editor/lib/timeline";
import type { Edl } from "@/modules/editor/types";
import type { ProjectVideo } from "@/modules/project/lib/overview";
import { AUTOPLAY_FALLBACK_MS, FRAME } from "../data";
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
  const player = useRef<PlayerRef>(null);
  const assetBase = `/api/projects/${projectId}/asset/`;

  // Not the Player's own `autoPlay`: that starts the clock while the footage is still
  // loading, and the clock stays on frame 0 with the button saying "playing". Playing
  // once the first load has settled is what pressing the button does, and that works.
  useEffect(() => {
    if (!autoPlay) return;
    const ref = player.current;
    if (!ref) return;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      ref.play();
    };
    ref.addEventListener("resume", start);
    const fallback = window.setTimeout(start, AUTOPLAY_FALLBACK_MS);
    return () => {
      ref.removeEventListener("resume", start);
      window.clearTimeout(fallback);
    };
  }, [autoPlay, video.id]);
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
        ref={player}
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
      ref={player}
      acknowledgeRemotionLicense
      className={FRAME}
      style={frameStyle(edl.output, maxHeight)}
    />
  );
}
