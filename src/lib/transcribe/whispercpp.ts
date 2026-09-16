import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream, existsSync } from "node:fs";
import { run, which } from "../bin";
import { Transcript, type Segment, type Word } from "../transcript";

const LEGACY_MODEL_DIR = path.join(os.homedir(), ".cache", "clipsmith", "models");
/** Models are hundreds of megabytes; reuse an existing cache instead of re-downloading after the rename. */
export const MODEL_DIR = existsSync(LEGACY_MODEL_DIR)
  ? LEGACY_MODEL_DIR
  : path.join(os.homedir(), ".cache", "agentcut", "models");
const MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export type WhisperModel =
  | "tiny.en" | "base.en" | "small.en" | "medium.en"
  | "tiny" | "base" | "small" | "medium"
  | "large-v3" | "large-v3-turbo";

/**
 * Multilingual by default. The `.en` models silently produce garbage on non-English
 * audio rather than failing, which is the worst possible failure mode here — the
 * agent then picks clips from a nonsense transcript.
 *
 * `small` rather than a large model: verified working with whisper.cpp 1.9.4, and
 * fast enough for multi-hour sources. `large-v3-turbo` from the ggerganov HF repo
 * fails to load on 1.9.4 with "unknown tensor" despite a byte-exact download.
 * Override with AGENTCUT_WHISPER_MODEL.
 */
export const DEFAULT_MODEL = (process.env.AGENTCUT_WHISPER_MODEL as WhisperModel) ?? "small";

export async function available() {
  return (await which("whisper-cli")) !== null;
}

export async function ensureModel(model: WhisperModel = DEFAULT_MODEL): Promise<string> {
  await fs.mkdir(MODEL_DIR, { recursive: true });
  const file = path.join(MODEL_DIR, `ggml-${model}.bin`);
  try {
    const st = await fs.stat(file);
    if (st.size > 1_000_000) return file;
  } catch {
    // not downloaded yet
  }
  const url = `${MODEL_BASE_URL}/ggml-${model}.bin`;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model download failed: ${res.status} ${url}`);

  // Unique temp name per download: a shared `.part` means two concurrent fetches
  // race, the first rename wins and the second fails with ENOENT.
  const tmp = `${file}.${process.pid}.${Date.now()}.part`;
  try {
    // Models run to gigabytes — stream rather than buffering the whole body.
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
    // Another process may have finished the same download while this one ran.
    const done = await fs.stat(file).catch(() => null);
    if (done && done.size > 1_000_000) {
      await fs.rm(tmp, { force: true });
      return file;
    }
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return file;
}

type WhisperJson = {
  transcription?: Array<{
    offsets?: { from: number; to: number };
    text?: string;
    tokens?: Array<{ text: string; offsets?: { from: number; to: number } }>;
  }>;
  result?: { language?: string };
};

/** `wavPath` must be 16kHz mono — see media.extractAudio. */
export async function transcribe(
  wavPath: string,
  opts: { model?: WhisperModel; outDir?: string; threads?: number; language?: string } = {},
): Promise<Transcript> {
  const model = await ensureModel(opts.model ?? DEFAULT_MODEL);
  const outBase = path.join(opts.outDir || path.dirname(wavPath), "whisper");

  await run("whisper-cli", [
    "-m", model,
    "-f", wavPath,
    "--output-json-full",
    "--output-file", outBase,
    "--max-len", "0",
    // "auto" makes whisper detect the language instead of assuming English.
    "-l", opts.language ?? "auto",
    "-t", String(opts.threads ?? Math.max(2, os.cpus().length - 2)),
  ], { timeoutMs: 0 });

  const raw = await fs
    .readFile(`${outBase}.json`, "utf8")
    .then((t) => JSON.parse(t) as WhisperJson)
    .catch(() => {
      throw new Error(
        `whisper produced no output for model "${model}". If the log says "unknown tensor", ` +
          `that model file is incompatible with your whisper.cpp build — try AGENTCUT_WHISPER_MODEL=small.`,
      );
    });
  const segments: Segment[] = [];
  const words: Word[] = [];

  for (const seg of raw.transcription ?? []) {
    const start = (seg.offsets?.from ?? 0) / 1000;
    const end = (seg.offsets?.to ?? 0) / 1000;
    segments.push({ start, end, text: (seg.text ?? "").trim(), speaker: null });
    for (const tok of seg.tokens ?? []) {
      const text = tok.text ?? "";
      // whisper emits special tokens like [_BEG_] and timestamps — skip them
      if (!text.trim() || text.trim().startsWith("[_")) continue;
      const t = (tok.offsets?.from ?? 0) / 1000;
      const d = Math.max(0.01, (tok.offsets?.to ?? 0) / 1000 - t);
      words.push({ t, d, w: text });
    }
  }

  return Transcript.parse({
    language: raw.result?.language ?? "en",
    segments,
    words: mergeSubwords(words),
  });
}

/** whisper tokens are sub-word pieces; stitch continuations onto the previous word. */
function mergeSubwords(tokens: Word[]): Word[] {
  const out: Word[] = [];
  for (const tok of tokens) {
    const startsWord = /^\s/.test(tok.w) || out.length === 0;
    if (startsWord) {
      out.push({ t: tok.t, d: tok.d, w: tok.w.trim() });
    } else {
      const prev = out[out.length - 1];
      prev.w += tok.w;
      prev.d = Math.max(prev.d, tok.t + tok.d - prev.t);
    }
  }
  return out.filter((w) => w.w.length > 0);
}
