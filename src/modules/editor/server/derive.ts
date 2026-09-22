import { randomUUID } from "node:crypto";
import { z } from "zod";
import { centerCrop, type Edl, type SequenceItem } from "../types";
import { editProject, readEditor, RevisionConflict } from "./store";
import { promoteClipToSequence } from "../lib/editable-timeline";
import { resolveTarget } from "../../templates/server/plan";
import type { EditorOperation } from "../lib/operations";

/**
 * One video, another shape. A derived sequence is a full copy the author can edit —
 * the parity rule says what renders must be editable — linked to its original in
 * its plan. Crops are recentred for the new frame; captions and overlays are
 * fractions and carry over; the template's aspect variant applies on the next
 * plan.apply.
 */
export const ASPECTS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export const DeriveRequest = z.object({
  sequenceId: z.string().optional(),
  clipId: z.string().optional(),
  aspect: z.enum(["9:16", "4:5", "1:1", "16:9"]),
  title: z.string().optional(),
});

export function deriveOperations(edl: Edl, target: { sequenceId?: string; clipId?: string }, aspect: keyof typeof ASPECTS, title?: string): { operations: EditorOperation[]; newId: string } {
  const { sequenceId, promotes } = resolveTarget(edl, target);
  const working = promotes ? promoteClipToSequence(edl, sequenceId) : edl;
  const source = working.sequences.find((s) => s.id === sequenceId)!;
  const output = { ...ASPECTS[aspect], fps: source.output.fps };
  const newId = `${sequenceId}-${aspect.replace(":", "x")}-${randomUUID().slice(0, 4)}`;
  const items: SequenceItem[] = source.items.map((item) => {
    const id = `i_${randomUUID().slice(0, 8)}`;
    const media = item.mediaId ? working.media.find((m) => m.id === item.mediaId) : null;
    const crop = media && item.clip.crop.length
      ? item.clip.crop.map((k) => ({ ...centerCrop(media.width, media.height, output.width, output.height), t: k.t }))
      : item.clip.crop;
    return { ...structuredClone(item), id, clip: { ...structuredClone(item.clip), id, crop } };
  });
  const operations: EditorOperation[] = [
    ...(promotes ? [{ type: "clip.promote" as const, clipId: sequenceId }] : []),
    { type: "sequence.add", sequence: {
      id: newId, title: title ?? `${source.title} (${aspect})`, output, items,
      plan: { ...structuredClone(source.plan), status: "pending", generatedAt: source.plan.generatedAt, reasons: { ...source.plan.reasons, derivedFrom: `${sequenceId} as ${aspect}` } },
    } },
  ];
  return { operations, newId };
}

export async function deriveSequence(projectId: string, raw: unknown, expectedRevision: number) {
  const request = DeriveRequest.parse(raw);
  const current = readEditor(projectId);
  if (current.revision !== expectedRevision) throw new RevisionConflict(current);
  const { operations, newId } = deriveOperations(current.edl, request, request.aspect, request.title);
  const saved = editProject(projectId, { expectedRevision, operations });
  return { revision: saved.revision, sequenceId: newId, aspect: request.aspect, output: ASPECTS[request.aspect] };
}
