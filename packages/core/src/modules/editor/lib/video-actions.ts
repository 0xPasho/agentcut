import type { Edl } from "../types";
import type { SequenceStatus } from "../../plan/types";
import type { EditorOperation } from "./operations";

/** Compose the same atomic operations accepted by project.edit, for any mix of videos. */
export function videoActions(edl: Edl, ids: string[], action: "delete" | SequenceStatus): EditorOperation[] {
  return [...new Set(ids)].flatMap((id): EditorOperation[] => {
    const sequence = edl.sequences.some(video => video.id === id);
    if (!sequence && !edl.clips.some(video => video.id === id)) throw new Error(`Video ${id} no longer exists.`);
    if (action === "delete") return [sequence
      ? { type: "sequence.remove", sequenceId: id }
      : { type: "clip.remove", clipId: id }];
    return [
      ...(!sequence ? [{ type: "clip.promote" as const, clipId: id }] : []),
      { type: "sequence.plan.patch", sequenceId: id, patch: { status: action } },
    ];
  });
}
