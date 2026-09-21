import fs from "node:fs/promises";
import path from "node:path";
import { extractAudio } from "../media";
import { Transcript } from "../transcript";
import type { AgentEvent } from "../agent";
import { available as whisperAvailable, engineId, transcribe } from "./whispercpp";
import { polishTranscript } from "./polish";
import { readGlossary, glossaryWhisperPrompt, glossaryBrief, applyGlossary } from "../glossary";

export type TranscribeRunOptions = {
  dir: string;
  sourcePath: string;
  /** Adds the project's glossary to the workspace's. Without it only the workspace glossary applies. */
  projectId?: string;
  /**
   * What the video is about. It reaches the proofreader, which uses it for names
   * and jargon — never the recogniser, whose prompt has to be in the spoken
   * language and would otherwise turn a foreign-language brief into a translation.
   */
  brief?: string;
  provider?: string;
  model?: string;
  /** Re-run even when the cached transcript is current. */
  force?: boolean;
  onLog?: (text: string) => void;
  onEvent?: (e: AgentEvent) => void;
};

/**
 * The project's transcript: cached, recognised, proofread.
 *
 * Analysis and a later re-transcribe go through here, so a project's captions come
 * from one recogniser configuration rather than from whenever it was first opened.
 * A transcript produced by older, weaker settings is redone rather than reused.
 */
export async function ensureTranscript(o: TranscribeRunOptions): Promise<{ transcript: Transcript; fresh: boolean }> {
  const transcriptPath = path.join(o.dir, "transcript.json");
  if (!o.force) {
    const cached = await fs.readFile(transcriptPath, "utf8").catch(() => null);
    const parsed = cached ? Transcript.safeParse(JSON.parse(cached)) : null;
    if (parsed?.success) {
      if (parsed.data.engine === engineId()) {
        o.onLog?.(`reusing transcript (${parsed.data.words.length} words)`);
        return { transcript: parsed.data, fresh: false };
      }
      o.onLog?.("cached transcript came from an older recogniser — re-running");
    }
  }

  if (!(await whisperAvailable())) throw new Error("whisper-cli not found — run: brew install whisper-cpp");
  const wav = await extractAudio(o.sourcePath, path.join(o.dir, "audio.wav"));
  // The glossary reaches all three stages: the recogniser hears the names, the
  // proofreader is told how to spell them, and a last deterministic pass fixes what
  // both still got wrong. AGENTCUT_WHISPER_PROMPT stays the deliberate override.
  const glossary = await readGlossary(o.projectId);
  const vocabulary = process.env.AGENTCUT_WHISPER_PROMPT ? undefined : glossaryWhisperPrompt(glossary) || undefined;
  let transcript = await transcribe(wav, { outDir: o.dir, onLog: o.onLog, prompt: vocabulary });

  const polished = await polishTranscript(transcript, {
    dir: o.dir,
    provider: o.provider,
    model: o.model,
    brief: [o.brief ?? "", glossaryBrief(glossary)].filter(Boolean).join("\n"),
    onEvent: o.onEvent,
  }).catch((err: Error) => {
    // Proofreading is a bonus pass; a failing agent must not lose the transcript.
    o.onLog?.(`transcript proofread skipped: ${err.message}`);
    return { transcript, changed: 0 };
  });
  transcript = polished.transcript;
  if (polished.changed) o.onLog?.(`proofread corrected ${polished.changed} segments`);
  const spelled = applyGlossary(transcript, glossary);
  transcript = spelled.transcript;
  if (spelled.changed) o.onLog?.(`glossary corrected ${spelled.changed} words`);

  await fs.writeFile(transcriptPath, JSON.stringify(transcript));
  return { transcript, fresh: true };
}
