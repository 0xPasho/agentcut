import { q } from "../../../common/server/db";
import { projectDir } from "../../../common/server/config";
import { wordsForClip, type Transcript, type Word } from "../lib/transcript";
import { applyGlossary, readGlossary, type Glossary } from "../../rules/server/glossary";
import { isUrl } from "../../project/server/ingest";
import { editProject, readEditor } from "../../editor/server/store";
import type { EditorOperation } from "../../editor/lib/operations";
import { ensureTranscript, type TranscribeRunOptions } from "./transcribe";
import { timeProvidedWords } from "./provided";
import type { Clip } from "../../editor/types";

export type ResyncOptions = Pick<TranscribeRunOptions, "brief" | "provider" | "model" | "onLog" | "onEvent"> & {
  expectedRevision?: number;
  /** Reuse a current transcript instead of recognising the audio again. */
  reuse?: boolean;
  /**
   * The transcript the timeline's words came from before this one. A shot whose words
   * no longer match it was corrected by hand, and keeps its words — see `freshWords`.
   */
  previous?: Transcript | null;
};

const sameWords = (a: Word[], b: Word[]) =>
  a.length === b.length && a.every((w, i) => w.w === b[i].w && Math.abs(w.t - b[i].t) < 1e-3 && Math.abs(w.d - b[i].d) < 1e-3);

/**
 * The words a shot should carry after its transcript changed, or null to leave them.
 *
 * A shot still carrying exactly what the previous transcript gave it takes the new
 * transcript's words. A shot whose words differ was corrected by hand — a name fixed, a
 * word re-timed, a phrase merged — and re-importing used to throw that work away on
 * every clip at once. It keeps its words and only takes the glossary, so a name added to
 * the glossary still reaches it.
 */
export function freshWords(
  current: Word[], start: number, end: number,
  transcript: Transcript, previous: Transcript | null | undefined, glossary: Glossary | null,
): Word[] | null {
  const edited = !!previous && current.length > 0 && !sameWords(current, wordsForClip(previous, start, end));
  if (!edited) return wordsForClip(transcript, start, end);
  if (!glossary) return null;
  const spelled = applyGlossary({ language: transcript.language, engine: transcript.engine, segments: [], words: current }, glossary);
  return spelled.changed ? spelled.transcript.words : null;
}

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

  const { transcript: recognised } = await ensureTranscript({
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
  // A transcript timed per line has its words heard where the timeline uses them, so the
  // captions they become are lit when the words are said rather than where a line put them.
  const transcript = await timeProvidedWords({
    dir: projectDir(projectId), file: project.source_path, transcript: recognised, projectId, onLog: o.onLog,
    spans: cutFrom(readEditor(projectId).edl, project.source_path).map(({ clip }) => ({ start: clip.start, end: clip.end })),
  });

  const { revision, edl } = readEditor(projectId);
  const glossary = o.previous ? await readGlossary(projectId) : null;
  const operations = wordOperations(edl, transcript, project.source_path, o.previous, glossary);
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

/** Everything on the timeline that is cut from this source, with the operation that gives it words. */
function cutFrom(edl: ReturnType<typeof readEditor>["edl"], sourceFile: string) {
  const cut: Array<{ clip: Clip; words: (words: Word[]) => EditorOperation }> = edl.clips.map((clip) => ({
    clip, words: (words) => ({ type: "clip.patch", clipId: clip.id, patch: { words } }),
  }));
  for (const sequence of edl.sequences) {
    for (const item of sequence.items) {
      // Imported media and canvas scenes have no words from this transcript.
      const media = item.mediaId ? edl.media.find((m) => m.id === item.mediaId) : null;
      if (!media || media.file !== sourceFile) continue;
      cut.push({ clip: item.clip, words: (words) => ({ type: "item.patch", sequenceId: sequence.id, itemId: item.id, patch: { words } }) });
    }
  }
  return cut;
}

function wordOperations(
  edl: ReturnType<typeof readEditor>["edl"],
  transcript: Transcript,
  sourceFile: string,
  previous: Transcript | null | undefined = null,
  glossary: Glossary | null = null,
): EditorOperation[] {
  return cutFrom(edl, sourceFile).flatMap(({ clip, words: give }) => {
    const words = freshWords(clip.words, clip.start, clip.end, transcript, previous, glossary);
    return words ? [give(words)] : [];
  });
}
