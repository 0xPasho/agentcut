"use client";

import { useRef, useState } from "react";
import { SWIPE } from "../data";
import { swipeVerdict } from "../lib/review";
import type { Verdict } from "../types";

/**
 * A card you can throw left or right.
 *
 * A press only becomes a drag once it has moved, and moved sideways, so a click on the
 * player still plays it and a vertical scroll on a phone still scrolls. A press that
 * starts on the player's own controls is left to the player: its scrubber is a
 * horizontal drag too, and seeking must never decide a video.
 */
export function useSwipe(onVerdict: (verdict: Verdict) => void, { disabled = false }: { disabled?: boolean } = {}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<Verdict | null>(null);
  const start = useRef<{ x: number; y: number; t: number; id: number; width: number } | null>(null);
  const last = useRef({ x: 0, t: 0, v: 0 });
  const moved = useRef(false);

  /** Send the card off screen, then report the verdict once it has gone. */
  const fling = (verdict: Verdict) => {
    if (leaving || disabled) return;
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setDragging(false);
    setLeaving(verdict);
    window.setTimeout(() => {
      onVerdict(verdict);
      setLeaving(null);
      setDx(0);
    }, reduced ? 0 : SWIPE.flyMs);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (disabled || leaving || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-swipe-ignore]")) return;
    const player = (event.target as HTMLElement).closest("[data-swipe-player]");
    // Remotion draws its controls along the bottom of the frame.
    if (player && event.clientY > player.getBoundingClientRect().bottom - 64) return;
    start.current = { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId, width: event.currentTarget.offsetWidth };
    last.current = { x: event.clientX, t: event.timeStamp, v: 0 };
    moved.current = false;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const origin = start.current;
    if (!origin || origin.id !== event.pointerId) return;
    const x = event.clientX - origin.x;
    const y = event.clientY - origin.y;
    if (!dragging) {
      if (Math.abs(x) < SWIPE.slop) return;
      if (Math.abs(y) > Math.abs(x)) { start.current = null; return; }
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      moved.current = true;
    }
    const dt = Math.max(1, event.timeStamp - last.current.t);
    last.current = { x: event.clientX, t: event.timeStamp, v: (event.clientX - last.current.x) / dt };
    setDx(x);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const origin = start.current;
    start.current = null;
    if (!origin || origin.id !== event.pointerId || !dragging) return;
    const verdict = swipeVerdict(event.clientX - origin.x, last.current.v, origin.width);
    if (verdict) { fling(verdict); return; }
    setDragging(false);
    setDx(0);
  };

  /** The click that ends a drag is not a click on what was under it. */
  const onClickCapture = (event: React.MouseEvent) => {
    if (!moved.current) return;
    moved.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    dx,
    dragging,
    leaving,
    fling,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture },
  };
}
