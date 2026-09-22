import type { SequenceStatus, BeatKind } from "./types";

/**
 * The plan is what the agent decided and why. This panel shows both levels and
 * lets a person change a decision; every change is a plan.patch or
 * sequence.plan.patch through the same dispatch as any timeline edit, so it is
 * saved, revisioned and undoable. Generating and applying call the same tools an
 * agent calls.
 */

export const STATUS_LABELS: Record<SequenceStatus, string> = { pending: "Pending", edited: "Edited", approved: "Approved", rendered: "Rendered" };

export const KIND_LABELS: Record<BeatKind, string> = { hook: "Hook", point: "Point", payoff: "Payoff", outro: "Outro", other: "Other" };

export const NUMBERING: Record<string, string> = { none: "No numbering", "n-of-total": "Part n of N", n: "Part n" };
