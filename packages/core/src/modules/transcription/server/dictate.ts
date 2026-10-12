import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FFMPEG, run } from "../../../common/server/bin";
import { cleanDictation } from "../lib/dictation";
import { available, DEFAULT_MODEL, transcribe, type WhisperModel } from "./whispercpp";

/** A short note wants the same ear as a recording: large-v3-turbo, unless told otherwise. */
const DICTATION_MODEL = (process.env.AGENTCUT_DICTATION_MODEL as WhisperModel | undefined) ?? DEFAULT_MODEL;

export const DICTATION_LANGUAGES = ["auto", "es", "en"] as const;
export type DictationLanguage = (typeof DICTATION_LANGUAGES)[number];

/**
 * Words spoken into the browser extension, recognised on this computer by the same
 * whisper.cpp that transcribes footage. No account and no key: the audio never leaves
 * the machine.
 */
export async function dictate(audio: Buffer, language: DictationLanguage = "auto"): Promise<{ text: string; ms: number }> {
  if (audio.length < 2_000) return { text: "", ms: 0 };
  const dir = path.join(os.tmpdir(), `agentcut-dictation-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    const input = path.join(dir, "input.webm");
    await fs.writeFile(input, audio);
    // No VAD: a note is a few seconds of talking, and cutting it shaves word edges off.
    return await transcribeFile(input, language, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * What is said in any audio or video file, as plain text: a dictated note, or a short
 * saved from the web. A saved video runs with VAD first, because silence is where
 * whisper invents words; when VAD hears nothing — singing, or a voice over music, which
 * Silero takes for music — it runs again on the whole audio.
 */
export async function transcribeFile(file: string, language: DictationLanguage = "auto", vad = true): Promise<{ text: string; ms: number }> {
  if (!(await available())) throw new Error("Local recognition needs whisper.cpp: brew install whisper-cpp");
  const started = Date.now();
  const dir = path.join(os.tmpdir(), `agentcut-listen-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    const wav = path.join(dir, "audio.wav");
    await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeoutMs: 5 * 60_000 });
    const hear = async (withVad: boolean) =>
      cleanDictation((await transcribe(wav, { model: DICTATION_MODEL, language, vad: withVad, outDir: dir, prompt: "" })).segments.map((s) => s.text));
    const text = (await hear(vad)) || (vad ? await hear(false) : "");
    return { text, ms: Date.now() - started };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
