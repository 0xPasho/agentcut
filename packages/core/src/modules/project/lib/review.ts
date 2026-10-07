import type { SequenceStatus } from "../../plan/types";
import { SWIPE } from "../data";
import type { ProjectVideo } from "./overview";
import type { ReviewStep, Verdict } from "../types";

const UNDECIDED: SequenceStatus[] = ["pending", "edited"];

/**
 * What a review session walks through, in the order on screen: the videos nobody has
 * ruled on yet. When every visible video already has a verdict, it walks all of them
 * again, because opening a review over a decided list means "look at these again".
 */
export function reviewQueue(videos: ProjectVideo[]): string[] {
  const open = videos.filter((video) => UNDECIDED.includes(video.status));
  return (open.length ? open : videos).map((video) => video.id);
}

/** What letting go of a card at `dx` pixels, moving at `velocity` px/ms, decides. */
export function swipeVerdict(dx: number, velocity: number, width: number): Verdict | null {
  const far = Math.abs(dx) >= Math.max(SWIPE.minDistance, width * SWIPE.distance);
  const flung = Math.abs(velocity) >= SWIPE.velocity && Math.sign(velocity) === Math.sign(dx);
  if (!far && !flung) return null;
  return dx > 0 ? "approved" : "rejected";
}

/** How many of each verdict a session has given, counting only what was not undone. */
export function reviewTally(steps: ReviewStep[]): Record<Verdict, number> {
  const tally = { approved: 0, rejected: 0 };
  for (const step of steps) if (step.verdict) tally[step.verdict] += 1;
  return tally;
}
