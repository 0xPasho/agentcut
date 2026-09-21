import type { EditorOperation } from "./operations";

/**
 * Every edit carries `by`: who put it there. Templates write `template:<id>`, rules
 * add `/rule:<ids>`, plans `/plan`, and an editing agent `agent:<messageId>` — the
 * turn of the conversation that asked for it. An empty `by` is a person's own work.
 * This is what "why is this here" reads, and what the observation bank uses to tell
 * a correction from a creation.
 */
export const isAgentAuthor = (by: string) => by.startsWith("agent:");
export const isGeneratedAuthor = (by: string) => by.length > 0;

export function describeAuthor(by: string): string {
  if (!by) return "Placed by hand";
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

/** An agent's project.edit request, with its authorship on every edit it creates. Existing marks are kept. */
export function stampAuthor(request: unknown, author: string): unknown {
  if (!request || typeof request !== "object" || (request as { tool?: string }).tool !== "project.edit") return request;
  const { operations, ...rest } = request as { operations?: EditorOperation[] };
  if (!Array.isArray(operations)) return request;
  return {
    ...rest,
    operations: operations.map((op) => {
      const o = op as unknown as Record<string, unknown>;
      switch (op.type) {
        case "edit.add": case "edit.replace": case "item.edit.add":
          return { ...o, edit: (o.edit as WithBy).by ? o.edit : { ...(o.edit as object), by: author } };
        case "clip.patch": case "item.patch": {
          const patch = o.patch as { edits?: WithBy[] };
          return patch?.edits ? { ...o, patch: { ...patch, edits: stampEdits(patch.edits, author) } } : op;
        }
        case "clip.add": { const clip = o.clip as { edits?: WithBy[] }; return { ...o, clip: { ...clip, edits: stampEdits(clip.edits, author) ?? [] } }; }
        case "item.add": { const item = o.item as { clip: { edits?: WithBy[] } }; return { ...o, item: { ...item, clip: { ...item.clip, edits: stampEdits(item.clip.edits, author) ?? [] } } }; }
        case "sequence.add": {
          const sequence = o.sequence as { items?: Array<{ clip: { edits?: WithBy[] } }> };
          return { ...o, sequence: { ...sequence, items: sequence.items?.map((item) => ({ ...item, clip: { ...item.clip, edits: stampEdits(item.clip.edits, author) ?? [] } })) } };
        }
        default: return op;
      }
    }),
  };
}
