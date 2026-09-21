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
 * An item with no keyframes never subscribes to the frame at all: `Placed` renders the
 * same static markup the composition has always produced, so an unanimated project is
 * byte-identical to what it rendered before this existed.
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

const Animated: React.FC<{ item: SequenceItem; sequence: VideoSequence; children: React.ReactNode }> = ({ item, sequence, children }) => (
  <Placed item={item} sequence={sequence} state={animatedAt(item, useCurrentFrame() / sequence.output.fps)}>{children}</Placed>
);

export const Layer: React.FC<{ item: SequenceItem; sequence: VideoSequence; children: React.ReactNode }> = ({ item, sequence, children }) =>
  item.keyframes?.length
    ? <Animated item={item} sequence={sequence}>{children}</Animated>
    : <Placed item={item} sequence={sequence} state={staticState(item)}>{children}</Placed>;
