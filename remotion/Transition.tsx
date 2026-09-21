import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { ResolvedTransition } from "../src/lib/sequences";

/**
 * How a shot arrives over the one it overlaps.
 *
 * The overlap itself is allocated by `sequenceFrames`, so the timeline, the Player
 * and the export already agree on which frames these are; all that is left here is
 * what happens inside them. Everything is driven by the frame, never by a CSS
 * transition or an animation — a renderer takes frames one at a time and out of
 * order, and anything the browser times itself would land differently on export.
 *
 * The incoming shot is the later sibling in its track, so it already paints over the
 * outgoing one. That is what makes a plain opacity ramp a cross-dissolve, and it is
 * why the dip's colour plate lives in here: inside this shot it covers the one below
 * without reaching the tracks stacked above, where a title or a watermark should hold
 * straight through the joint.
 */
export const Transition: React.FC<{ resolved: ResolvedTransition | null; children: React.ReactNode }> = ({ resolved, children }) => {
  const frame = useCurrentFrame();
  if (!resolved) return <>{children}</>;
  const { transition, frames } = resolved;
  const progress = interpolate(frame, [0, frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const away = (1 - progress) * 100;

  if (transition.kind === "dissolve") return <AbsoluteFill style={{ opacity: progress }}>{children}</AbsoluteFill>;

  if (transition.kind === "dip") {
    // The colour is already solid before the swap underneath it and still solid after,
    // so the cut it hides is never a visible frame of its own.
    const cover = interpolate(progress, [0, 0.45, 0.55, 1], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return <AbsoluteFill>
      <AbsoluteFill style={{ opacity: progress < 0.5 ? 0 : 1 }}>{children}</AbsoluteFill>
      <AbsoluteFill data-transition-dip="" style={{ backgroundColor: transition.color, opacity: cover }} />
    </AbsoluteFill>;
  }

  if (transition.kind === "wipe") {
    const inset = transition.direction === "left" ? `0 ${away}% 0 0`
      : transition.direction === "right" ? `0 0 0 ${away}%`
      : transition.direction === "up" ? `0 0 ${away}% 0`
      : `${away}% 0 0 0`;
    return <AbsoluteFill style={{ clipPath: `inset(${inset})` }}>{children}</AbsoluteFill>;
  }

  const shift = transition.direction === "left" ? `translateX(${-away}%)`
    : transition.direction === "right" ? `translateX(${away}%)`
    : transition.direction === "up" ? `translateY(${-away}%)`
    : `translateY(${away}%)`;
  return <AbsoluteFill style={{ transform: shift }}>{children}</AbsoluteFill>;
};
