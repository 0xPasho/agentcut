import fs from "node:fs/promises";
import path from "node:path";
import { extractAudio } from "../../media/server/ffmpeg";
import { Transcript } from "../lib/transcript";
import { isProvided } from "../lib/import";
import type { AgentEvent } from "../../agent/server/providers";
import { available as whisperAvailable, engineId, transcribe } from "./whispercpp";
import { polishTranscript } from "./polish";
import { readGlossary, glossaryWhisperPrompt, glossaryBrief, applyGlossary } from "../../rules/server/glossary";

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
  /**
   * The recogniser itself. Defaults to whisper.cpp; a caller supplies one the way a
   * batch supplies a `runner`, so everything around recognition — the glossary in
   * the prompt, the cache, the words landing on shots — can be exercised without a
   * model on the machine.
   */
  recognise?: Recogniser;
  onLog?: (text: string) => void;
  onEvent?: (e: AgentEvent) => void;
};

export type Recogniser = (wav: string, options: { outDir: string; onLog?: (text: string) => void; prompt?: string }) => Promise<Transcript>;

declare global {
  var __agentcutRecogniser: Recogniser | undefined;
}
/**
 * Test seam. Automatic transcription starts from an import, deep inside a background
 * job, so there is no argument to pass a fake down — and a test suite must never
 * pull a model onto somebody's machine. Production never sets this; whisper.cpp
 * stays the default, and an explicit `recognise` option still wins over it.
 */
export function setDefaultRecogniser(recogniser: Recogniser | undefined) {
  globalThis.__agentcutRecogniser = recogniser;
}

/**
 * The project's transcript: the one the person provided, or cached, recognised, proofread.
 *
 * Analysis and a later re-transcribe go through here, so a project's captions come
 * from one recogniser configuration rather than from whenever it was first opened.
 * A transcript produced by older, weaker settings is redone rather than reused.
 */
export async function ensureTranscript(o: TranscribeRunOptions): Promise<{ transcript: Transcript; fresh: boolean }> {
  const transcriptPath = path.join(o.dir, "transcript.json");
  const cached = await readCached(transcriptPath);
  // A transcript the person handed over is what was said. Neither a stale engine nor
  // `force` replaces it with the recogniser's guess; only discarding it does.
  if (cached?.success && isProvided(cached.data.engine)) {
    o.onLog?.(`using the transcript you provided (${cached.data.words.length} words)`);
    return { transcript: cached.data, fresh: false };
  }
  if (!o.force && cached?.success) {
    if (cached.data.engine === engineId()) {
      o.onLog?.(`reusing transcript (${cached.data.words.length} words)`);
      return { transcript: cached.data, fresh: false };
    }
    o.onLog?.("cached transcript came from an older recogniser — re-running");
  }

  const recognise: Recogniser = o.recognise ?? globalThis.__agentcutRecogniser ?? transcribe;
  if (recognise === transcribe && !(await whisperAvailable())) throw new Error("whisper-cli not found — run: brew install whisper-cpp");
  const wav = await extractAudio(o.sourcePath, path.join(o.dir, "audio.wav"));
  // The glossary reaches all three stages: the recogniser hears the names, the
  // proofreader is told how to spell them, and a last deterministic pass fixes what
  // both still got wrong. AGENTCUT_WHISPER_PROMPT stays the deliberate override.
  const glossary = await readGlossary(o.projectId);
  const vocabulary = process.env.AGENTCUT_WHISPER_PROMPT ? undefined : glossaryWhisperPrompt(glossary) || undefined;
  let transcript = await recognise(wav, { outDir: o.dir, onLog: o.onLog, prompt: vocabulary });

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

  // A run on a five-hour source takes long enough for the person to hand over their
  // own transcript meanwhile. Theirs was written while this one listened; it stays.
  const meanwhile = await readCached(transcriptPath);
  if (meanwhile?.success && isProvided(meanwhile.data.engine)) {
    o.onLog?.("a transcript was provided while this one was being recognised — keeping yours");
    return { transcript: meanwhile.data, fresh: false };
  }
  await writeTranscript(transcriptPath, transcript);
  return { transcript, fresh: true };
}

/**
 * A process killed mid-write used to leave a truncated `transcript.json`, and the
 * next run threw on `JSON.parse` instead of simply recognising the audio again.
 * Unreadable is the same answer as absent: there is no transcript here.
 */
async function readCached(file: string) {
  const text = await fs.readFile(file, "utf8").catch(() => null);
  if (!text) return null;
  try { return Transcript.safeParse(JSON.parse(text)); } catch { return null; }
}

/**
 * Write through a temporary file in the same directory and rename. A rename is
 * atomic on every filesystem this app runs on, so an interrupted transcription
 * leaves either the previous transcript or none — never half of one that a later
 * read would have to guess about.
 */
export async function writeTranscript(file: string, transcript: Transcript) {
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(transcript));
  try { await fs.rename(temp, file); }
  catch (error) { await fs.rm(temp, { force: true }); throw error; }
}
