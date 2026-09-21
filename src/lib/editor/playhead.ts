"use client";

import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from "react";

/**
 * Where the preview is, shared without re-rendering the editor.
 *
 * The player reports a new frame thirty times a second. Held in React state that
 * re-rendered the whole editor on every frame — asset browser, panels, timeline,
 * transcript — which took tens of milliseconds and left the player's own playback
 * loop no time to keep picture and sound together: the preview stuttered and the
 * audio jumped back over words it had already played. So the playhead lives here
 * instead. Handlers read it without subscribing, and only the few small parts that
 * draw it re-render as it moves.
 */
export type PlayheadStore = {
  /** Position in output seconds. Safe to call from an event handler. */
  get: () => number;
  set: (seconds: number) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createPlayheadStore(initial = 0): PlayheadStore {
  let seconds = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => seconds,
    set: next => {
      if (next === seconds) return;
      seconds = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const PlayheadContext = createContext<PlayheadStore | null>(null);
export const PlayheadProvider = PlayheadContext.Provider;

/** The store itself, for handlers: reading it never re-renders anything. */
export function usePlayheadStore(): PlayheadStore {
  const store = useContext(PlayheadContext);
  if (!store) throw new Error("The playhead is only available inside a PlayheadProvider.");
  return store;
}

/**
 * Something derived from the playhead, re-rendering only when that derived value
 * changes. Return a primitive: a new object every frame re-renders every frame,
 * which is the cost this whole store exists to avoid.
 */
export function usePlayheadSelector<T>(select: (seconds: number) => T): T {
  const store = usePlayheadStore();
  const latest = useRef(select);
  latest.current = select;
  const cache = useRef<{ at: number; select: (seconds: number) => T; value: T } | null>(null);
  const snapshot = useCallback(() => {
    const at = store.get();
    const cached = cache.current;
    // A new selector means what it reads has changed — an edited clip, a moved item —
    // so the cached answer for this same moment is no longer the right one.
    if (!cached || cached.at !== at || cached.select !== latest.current) {
      const value = latest.current(at);
      // Keep the previous value's identity when it compares equal, or every frame
      // looks like a change to useSyncExternalStore and re-renders regardless.
      cache.current = { at, select: latest.current, value: cached && Object.is(cached.value, value) ? cached.value : value };
    }
    return cache.current!.value;
  }, [store]);
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

/** The position itself. Only for components small enough to render thirty times a second. */
export function usePlayhead(): number {
  return usePlayheadSelector(seconds => seconds);
}
