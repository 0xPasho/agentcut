"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Follow the newest line, but only while the reader is already at the bottom.
 *
 * A run emits a line a second. Pinning the scroll unconditionally means nobody can
 * ever read what happened two minutes ago — they get dragged back down mid-sentence.
 * Scroll up and the panel holds still; `atBottom` is false so the caller can offer a
 * way back to the live end.
 */
export function useStickToBottom<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const following = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    following.current = near;
    setAtBottom(near);
  }, []);

  const toBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    following.current = true;
    setAtBottom(true);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [dep]);

  return { ref, onScroll, atBottom, toBottom };
}
