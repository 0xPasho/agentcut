import { Transition, TransitionKind } from "../types";

/** What each kind is called wherever a person reads it — the timeline, the inspector, a toast. */
export const TRANSITION_LABELS: Record<TransitionKind, string> = {
  dissolve: "Cross dissolve",
  dip: "Dip to colour",
  wipe: "Wipe",
  slide: "Slide",
};
export const TRANSITION_KINDS = TransitionKind.options;
/** Half a second: long enough to read as a blend, short enough not to eat a short shot. */
export const DEFAULT_TRANSITION_SEC = 0.5;
/** The lengths worth one click. Anything else is a number, and numbers live in the properties. */
export const TRANSITION_DURATIONS = [0.25, 0.5, 1] as const;

const seconds = (value: number) => `${Number(value.toFixed(2))}s`;
/** One line naming what a transition does. */
export const describeTransition = (transition: Transition) => `${TRANSITION_LABELS[transition.kind]} · ${seconds(transition.durationSec)}`;
