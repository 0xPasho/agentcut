import type { EditorOperation } from "./operations";
import { SELECTION_AUTHOR } from "../edl";

/**
 * Every edit carries `by`: who put it there. Templates write `template:<id>`, rules
 * add `/rule:<ids>`, plans `/plan`, an editing agent `agent:<messageId>` — the turn of
 * the conversation that asked for it — and the clip selection `select`, for the draft
 * it makes while cutting a clip out of a recording. An empty `by` is a person's own work.
 * This is what "why is this here" reads, and what the observation bank uses to tell
 * a correction from a creation.
 */
export const isAgentAuthor = (by: string) => by.startsWith("agent:");
export const isGeneratedAuthor = (by: string) => by.length > 0;

export function describeAuthor(by: string): string {
  if (!by) return "Placed by hand";
  if (by === SELECTION_AUTHOR) return "Written when this clip was cut out of the recording";
  if (by.startsWith("agent:")) return `Placed by the agent (message ${by.slice(6)})`;
  const template = by.match(/^template:([^/]+)/)?.[1];
  if (template) {
    const rules = by.match(/\/rule:([^/]+)/)?.[1];
    const plan = by.includes("/plan");
    return `Template ${template}${plan ? ", from the plan" : ""}${rules ? `, because of rule${rules.includes(",") ? "s" : ""} ${rules.split(",").join(", ")}` : ""}`;
  }
  return `Placed by ${by}`;
}

type WithBy = { by?: string };
const stampEdits = <T extends WithBy>(edits: T[] | undefined, author: string) => edits?.map((e) => (e.by ? e : { ...e, by: author }));
/** A shot arriving with a transition or a move already on it carries the same mark as its edits. */
const stampItem = <T extends { clip: { edits?: WithBy[] }; transition?: WithBy | null; keyframes?: WithBy[] }>(item: T, author: string) => ({
  ...item,
  ...(item.transition && !item.transition.by ? { transition: { ...item.transition, by: author } } : {}),
  ...(item.keyframes ? { keyframes: stampEdits(item.keyframes, author) } : {}),
  clip: { ...item.clip, edits: stampEdits(item.clip.edits, author) ?? [] },
});

/** An agent's project.edit request, with its authorship on every edit it creates. Existing marks are kept. */
export function stampAuthor(request: unknown, author: string): unknown {
  if (!request || typeof request !== "object") return request;
  // Words are not an `Edit` and carry no `by` of their own, so a transcription's
  // mark lives on the record this run writes onto the source. The host sets it, so
  // a run cannot claim the work was somebody else's.
  if ((request as { tool?: string }).tool === "media.transcribe") return { ...request, by: author };
  if ((request as { tool?: string }).tool !== "project.edit") return request;
  const { operations, ...rest } = request as { operations?: EditorOperation[] };
  if (!Array.isArray(operations)) return request;
  return {
    ...rest,
    operations: operations.map((op) => {
      const o = op as unknown as Record<string, unknown>;
      switch (op.type) {
        case "edit.add": case "edit.replace": case "item.edit.add":
          return { ...o, edit: (o.edit as WithBy).by ? o.edit : { ...(o.edit as object), by: author } };
        // A transition is placed, so it is authored: "why is this here" reads the same mark.
        case "item.transition":
          return o.transition && !(o.transition as WithBy).by ? { ...o, transition: { ...(o.transition as object), by: author } } : op;
        // So is a keyframe. It carries `by` per keyframe rather than per list, so a person
        // who moves one moment of an agent's move keeps the mark on the ones they left.
        case "item.keyframes":
          return o.keyframes ? { ...o, keyframes: stampEdits(o.keyframes as WithBy[], author) } : op;
        case "clip.patch": case "item.patch": {
          const patch = o.patch as { edits?: WithBy[] };
          return patch?.edits ? { ...o, patch: { ...patch, edits: stampEdits(patch.edits, author) } } : op;
        }
        case "clip.add": { const clip = o.clip as { edits?: WithBy[] }; return { ...o, clip: { ...clip, edits: stampEdits(clip.edits, author) ?? [] } }; }
        case "item.add": { const item = o.item as { clip: { edits?: WithBy[] }; transition?: WithBy | null; keyframes?: WithBy[] }; return { ...o, item: stampItem(item, author) }; }
        case "sequence.add": {
          const sequence = o.sequence as { items?: Array<{ clip: { edits?: WithBy[] }; transition?: WithBy | null; keyframes?: WithBy[] }> };
          return { ...o, sequence: { ...sequence, items: sequence.items?.map((item) => stampItem(item, author)) } };
        }
        default: return op;
      }
    }),
  };
}
