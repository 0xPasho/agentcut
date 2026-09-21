import React from "react";
import { useCurrentFrame } from "remotion";
import type { SequenceItem, VideoSequence } from "../src/lib/edl";
import { animatedAt, staticState, type AnimatedState } from "../src/lib/keyframes";

/**
 * Where a layer sits in the output frame, for one frame of the output.
 *
 * Everything is driven by the frame number, never by a CSS transition or animation, for
 * the same reason `Transition` is: a renderer takes frames one at a time and out of order,
 * and anything the browser times itself would land differently on an export than it does
 * in the Player.
 *
 * Inside the item's `Sequence` the frame is already the item's own — zero is its first
 * frame on the programme — which is exactly the time base `TransformKeyframe.t` is
 * measured in. Nothing has to be converted, and a shot that moves on the timeline or
 * changes layer keeps its animation untouched.
 *
 * An item with no keyframes resolves to its static placement without looking at the frame
 * at all, and `Placed` emits exactly the markup this composition has always produced, so
 * an unanimated project renders byte-identically to what it did before this existed.
 */
const Placed: React.FC<{ item: SequenceItem; sequence: VideoSequence; state: AnimatedState; children: React.ReactNode }> =
  ({ item, sequence, state, children }) => (
    <div data-canvas-item={item.id} style={{
      position: "absolute", left: `${state.x}%`, top: `${state.y}%`,
      width: `${state.width}%`, height: `${state.height}%`,
      transform: state.rotation ? `rotate(${state.rotation}deg)` : undefined, opacity: state.opacity,
    }}>
      <div style={{
        position: "relative", width: sequence.output.width, height: sequence.output.height, transformOrigin: "0 0",
        transform: state.width === 100 && state.height === 100 ? undefined : `scale(${state.width / 100}, ${state.height / 100})`,
      }}>{children}</div>
    </div>
  );

/**
 * One component whichever it is, rather than one per case. Switching element type as a
 * layer gains its first keyframe would unmount the whole shot underneath it, and the
 * Player would reload the video and flash on the frame somebody just pinned. `animatedAt`
 * returns the static placement immediately when there are no keyframes, and `children`
 * is the same element object on every frame, so React re-renders nothing below this.
 */
export const Layer: React.FC<{ item: SequenceItem; sequence: VideoSequence; children: React.ReactNode }> = ({ item, sequence, children }) => {
  const frame = useCurrentFrame();
  return <Placed item={item} sequence={sequence}
    state={item.keyframes?.length ? animatedAt(item, frame / sequence.output.fps) : staticState(item)}>{children}</Placed>;
};
