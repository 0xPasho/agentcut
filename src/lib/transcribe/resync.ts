import { q } from "../db";
import { projectDir } from "../config";
import { wordsForClip, type Transcript } from "../transcript";
import { isUrl } from "../ingest";
import { editProject, readEditor } from "../editor/store";
import type { EditorOperation } from "../editor/operations";
import { ensureTranscript, type TranscribeRunOptions } from ".";

export type ResyncOptions = Pick<TranscribeRunOptions, "brief" | "provider" | "model" | "onLog" | "onEvent"> & {
  expectedRevision?: number;
  /** Reuse a current transcript instead of recognising the audio again. */
  reuse?: boolean;
};

/**
 * Re-recognise the source and put the new words back into everything already cut
 * from it — generated clips and promoted timeline items alike.
 *
 * Only the words change. Boundaries, edits, framing and captions style are left
 * exactly as they are, and the update goes through the same operations and
 * validation as any other edit, so nothing here is a second way to write a project.
 */
export async function resyncTranscript(projectId: string, o: ResyncOptions = {}) {
  const project = q.getProject(projectId);
  if (!project) throw new Error("Project not found");
  if (!project.source_path || isUrl(project.source_path)) {
    throw new Error("This project has no downloaded source to transcribe");
  }

  const { transcript } = await ensureTranscript({
    dir: projectDir(projectId),
    sourcePath: project.source_path,
    projectId,
    force: !o.reuse,
    brief: o.brief,
    provider: o.provider,
    model: o.model,
    onLog: o.onLog,
    onEvent: o.onEvent,
  });

  const { revision, edl } = readEditor(projectId);
  const operations = wordOperations(edl, transcript, project.source_path);
  if (!operations.length) {
    o.onLog?.("transcript updated; nothing on the timeline is cut from this source");
    return { transcript, patched: 0, revision };
  }

  const saved = editProject(projectId, {
    expectedRevision: o.expectedRevision ?? revision,
    operations,
  });
  o.onLog?.(`re-synced captions on ${operations.length} clip${operations.length === 1 ? "" : "s"}`);
  return { transcript, patched: operations.length, revision: saved.revision };
}

/** Everything on the timeline that is cut from the transcribed source. */
function wordOperations(
  edl: ReturnType<typeof readEditor>["edl"],
  transcript: Transcript,
  sourceFile: string,
): EditorOperation[] {
  const operations: EditorOperation[] = [];
  for (const clip of edl.clips) {
    operations.push({
      type: "clip.patch",
      clipId: clip.id,
      patch: { words: wordsForClip(transcript, clip.start, clip.end) },
    });
  }
  for (const sequence of edl.sequences) {
    for (const item of sequence.items) {
      // Imported media and canvas scenes have no words from this transcript.
      const media = item.mediaId ? edl.media.find((m) => m.id === item.mediaId) : null;
      if (!media || media.file !== sourceFile) continue;
      operations.push({
        type: "item.patch",
        sequenceId: sequence.id,
        itemId: item.id,
        patch: { words: wordsForClip(transcript, item.clip.start, item.clip.end) },
      });
    }
  }
  return operations;
}
