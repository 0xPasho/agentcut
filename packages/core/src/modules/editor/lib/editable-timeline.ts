import { Edl } from "../types";
import { emptySequencePlan } from "../../plan/types";

/** Project a generated clip into the same editable timeline without changing its identity. */
export function promoteClipToSequence(input: Edl, clipId: string): Edl {
  const edl = Edl.parse(structuredClone(input));
  if (edl.sequences.some(sequence => sequence.id === clipId)) return edl;
  const clip = edl.clips.find(candidate => candidate.id === clipId);
  if (!clip) throw new Error(`Clip not found: ${clipId}`);
  if (!edl.source) throw new Error("A generated clip requires its original source");
  let media = edl.media.find(candidate => candidate.file === edl.source!.file);
  if (!media) {
    let id = "original-source";
    for (let suffix = 2; edl.media.some(candidate => candidate.id === id); suffix++) id = `original-source-${suffix}`;
    media = { ...edl.source, id, name: "Original source" };
    edl.media.push(media);
  }
  edl.clips = edl.clips.filter(candidate => candidate.id !== clipId);
  edl.sequences.push({ id: clipId, title: clip.title, output: { ...edl.output }, items: [{ id: clip.id, mediaId: media.id, clip }], plan: { ...emptySequencePlan(), tags: clip.tags, score: clip.score } });
  return edl;
}
