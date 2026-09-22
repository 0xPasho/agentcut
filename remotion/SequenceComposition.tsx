import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import type { MediaSource, VideoSequence } from "../src/lib/edl";
import { sequenceFrames } from "../src/lib/sequences";
import { animatedFields, fieldAt } from "../src/lib/keyframes";
import { ClipComposition } from "./ClipComposition";
import { Layer } from "./Layer";
import { Transition } from "./Transition";
import { premountFrames } from "./premount";
export type SequenceProps = { sequence: VideoSequence; media: MediaSource[]; mediaUrls: Record<string, string>; assetBase?: string; assetUrls?: Record<string, string> };
export const SequenceComposition: React.FC<SequenceProps> = ({ sequence, media, mediaUrls, assetBase, assetUrls }) => <AbsoluteFill style={{ backgroundColor: "black" }}>
  {sequenceFrames(sequence).items.toSorted((a, b) => (a.item.layer ?? 0) - (b.item.layer ?? 0)).map(({ item, from, duration, transition, outFrames }) => {
    const source = item.mediaId === null ? null : media.find(m => m.id === item.mediaId);
    // A canvas segment is deliberately source-free. A shot whose media has gone missing
    // is a broken project, and silently exporting it as a black canvas would hide that.
    if (item.mediaId !== null && !source) throw new Error(`Shot “${item.clip.title}” references missing media ${item.mediaId}`);
    // A shot at either end of a joint ramps its own sound. Without a joint there is no
    // fade at all, so a timeline of hard cuts renders exactly the audio it always did.
    const fade = transition || outFrames ? { inFrames: transition?.frames ?? 0, outFrames, durationFrames: duration } : undefined;
    // A keyframed gain arrives as a function of the item's own frame, which is the timebase
    // a crossfade already uses. Without volume keyframes the number is passed through
    // untouched, so nothing that was not animated starts being computed per frame.
    const keys = item.keyframes;
    const volume = keys?.length && animatedFields(keys).has("volume")
      ? (frame: number) => fieldAt(keys, "volume", frame / sequence.output.fps, item.volume ?? 1)
      : item.volume;
    // A shot loads before it is due, invisible and frozen on its first frame, so the cut
    // into it lands on a picture rather than on a video element that is still seeking.
    // Remotion drops this while rendering; it is the Player that has a seek to hide.
    return <Sequence key={item.id} from={from} durationInFrames={duration} premountFor={premountFrames(sequence.output.fps)}>
      <Transition resolved={transition}>
      <Layer item={item} sequence={sequence}>
        <ClipComposition clip={item.clip} hideVideo={!source} transparent hideVisuals={item.hidden}
          volume={volume} muted={item.muted} fade={fade}
          sourceUrl={source ? mediaUrls[source.id] ?? "" : ""}
          sourceWidth={source?.width ?? sequence.output.width} sourceHeight={source?.height ?? sequence.output.height}
          assetBase={assetBase} assetUrls={assetUrls} />
      </Layer>
      </Transition>
    </Sequence>;
  })}
</AbsoluteFill>;
