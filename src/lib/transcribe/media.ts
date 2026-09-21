import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "../config";
import { q } from "../db";
import { wordsForClip } from "../transcript";
import { editProject, readEditor } from "../editor/store";
import type { EditorOperation } from "../editor/operations";
import { ensureTranscript, type TranscribeRunOptions } from "./index";

/**
 * Imported media get their own transcript, one per file, under
 * `<project>/transcripts/<mediaId>/`. The words go onto every timeline item cut
 * from that media through ordinary item.patch operations, so captions on a raw
 * upload work the same as on a clipped source.
 */
export type MediaTranscribeOptions = Pick<TranscribeRunOptions, "brief" | "provider" | "model" | "onLog" | "onEvent" | "force"> & {
  mediaIds?: string[];
};

export const mediaTranscriptDir = (projectId: string, mediaId: string) => path.join(projectDir(projectId), "transcripts", mediaId);

export async function transcribeProjectMedia(projectId: string, o: MediaTranscribeOptions = {}) {
  if (!q.getProject(projectId)) throw new Error("Project not found");
  const { edl } = readEditor(projectId);
  const wanted = edl.media.filter((m) => !o.mediaIds || o.mediaIds.includes(m.id));
  if (o.mediaIds?.some((id) => !edl.media.some((m) => m.id === id))) throw new Error("Media not found");
  const results: Array<{ mediaId: string; words: number; items: number; error?: string }> = [];
  for (const media of wanted) {
    try {
      const dir = mediaTranscriptDir(projectId, media.id);
      await fs.mkdir(dir, { recursive: true });
      const { transcript } = await ensureTranscript({ dir, sourcePath: media.file, projectId, brief: o.brief, provider: o.provider, model: o.model, force: o.force, onLog: o.onLog, onEvent: o.onEvent });
      const current = readEditor(projectId);
      const operations: EditorOperation[] = [];
      for (const sequence of current.edl.sequences) for (const item of sequence.items) {
        if (item.mediaId !== media.id) continue;
        operations.push({ type: "item.patch", sequenceId: sequence.id, itemId: item.id, patch: { words: wordsForClip(transcript, item.clip.start, item.clip.end) } });
      }
      if (operations.length) editProject(projectId, { expectedRevision: current.revision, operations });
      results.push({ mediaId: media.id, words: transcript.words.length, items: operations.length });
    } catch (error) {
      results.push({ mediaId: media.id, words: 0, items: 0, error: (error as Error).message });
      o.onLog?.(`${media.name}: transcription failed — ${(error as Error).message}`);
    }
  }
  return { revision: readEditor(projectId).revision, results };
}
