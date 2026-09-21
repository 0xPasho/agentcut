import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream, existsSync } from "node:fs";
import { run, which } from "../bin";
import { Transcript, type Segment, type Word } from "../transcript";
import { rebaseOntoSource, refineWordTimes, speechRunsFromWav } from "./align";

const LEGACY_MODEL_DIR = path.join(os.homedir(), ".cache", "clipsmith", "models");
/** Models are hundreds of megabytes; reuse an existing cache instead of re-downloading after the rename. */
export const MODEL_DIR = existsSync(LEGACY_MODEL_DIR)
  ? LEGACY_MODEL_DIR
  : path.join(os.homedir(), ".cache", "agentcut", "models");
const MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const VAD_MODEL = "ggml-silero-v5.1.2.bin";
const VAD_MODEL_URL = `https://huggingface.co/ggml-org/whisper-vad/resolve/main/${VAD_MODEL}`;

export type WhisperModel =
  | "tiny.en" | "base.en" | "small.en" | "medium.en"
  | "tiny" | "base" | "small" | "medium"
  | "large-v3" | "large-v3-turbo";

/**
 * Multilingual by default. The `.en` models silently produce garbage on non-English
 * audio rather than failing, which is the worst possible failure mode here — the
 * agent then picks clips from a nonsense transcript.
 *
 * `large-v3-turbo` catches words the smaller models drop or invent (noticeably so
 * outside English) and still runs at roughly 10x realtime on an Apple GPU. If the
 * installed whisper.cpp cannot load it — older builds fail with "unknown tensor" —
 * transcribe() falls back to `small` rather than failing the job.
 * Override with AGENTCUT_WHISPER_MODEL.
 */
export const DEFAULT_MODEL = (process.env.AGENTCUT_WHISPER_MODEL as WhisperModel) ?? "large-v3-turbo";
const FALLBACK_MODEL: WhisperModel = "small";

/**
 * whisper.cpp aligns tokens to audio with DTW over the cross-attention of a fixed
 * set of heads, which differs per model — hence a preset per model rather than a
 * flag. Models without a preset simply keep whisper's probability-derived times.
 */
const DTW_PRESET: Partial<Record<WhisperModel, string>> = {
  "tiny": "tiny", "tiny.en": "tiny.en",
  "base": "base", "base.en": "base.en",
  "small": "small", "small.en": "small.en",
  "medium": "medium", "medium.en": "medium.en",
  "large-v3": "large.v3",
  "large-v3-turbo": "large.v3.turbo",
};

/** Bumping this invalidates cached transcripts produced by weaker settings. */
export const ENGINE_VERSION = "whispercpp-3";
export const engineId = (model: WhisperModel = DEFAULT_MODEL) => `${ENGINE_VERSION}:${model}`;

export async function available() {
  return (await which("whisper-cli")) !== null;
}

async function download(url: string, file: string, minBytes: number): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    const st = await fs.stat(file);
    if (st.size > minBytes) return file;
  } catch {
    // not downloaded yet
  }
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
    if (done && done.size > minBytes) {
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

export async function ensureModel(model: WhisperModel = DEFAULT_MODEL): Promise<string> {
  return download(`${MODEL_BASE_URL}/ggml-${model}.bin`, path.join(MODEL_DIR, `ggml-${model}.bin`), 1_000_000);
}

/**
 * Silero voice activity detection. Whisper transcribes a 30s window at a time and
 * will happily invent speech for the silent parts of it; feeding it only the speech
 * removes those hallucinations and keeps segments on sentence boundaries.
 * Best effort — VAD is an improvement, not a requirement.
 */
async function ensureVadModel(): Promise<string | null> {
  return download(VAD_MODEL_URL, path.join(MODEL_DIR, VAD_MODEL), 100_000).catch(() => null);
}

type WhisperToken = {
  text?: string;
  offsets?: { from: number; to: number };
  /** Token probability, 0..1. */
  p?: number;
  /** DTW-aligned start in centiseconds, or -1 when DTW is off. */
  t_dtw?: number;
};

type WhisperJson = {
  transcription?: Array<{
    offsets?: { from: number; to: number };
    text?: string;
    tokens?: WhisperToken[];
  }>;
  result?: { language?: string };
};

export type TranscribeOptions = {
  model?: WhisperModel;
  outDir?: string;
  threads?: number;
  language?: string;
  /**
   * Vocabulary hint passed to the decoder — names, jargon and spellings it would
   * otherwise guess at. Truncated: a long prompt crowds out the audio context.
   *
   * It MUST be written in the language being spoken. Whisper takes the prompt as
   * the start of the transcript, so an English hint over Spanish audio makes it
   * translate rather than transcribe. Nothing passes a user's own words here for
   * that reason — AGENTCUT_WHISPER_PROMPT is the deliberate override.
   */
  prompt?: string;
  onLog?: (text: string) => void;
};

/** `wavPath` must be 16kHz mono — see media.extractAudio. */
export async function transcribe(wavPath: string, opts: TranscribeOptions = {}): Promise<Transcript> {
  const wanted = opts.model ?? DEFAULT_MODEL;
  try {
    return await runModel(wavPath, wanted, opts);
  } catch (err) {
    if (wanted === FALLBACK_MODEL) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    opts.onLog?.(`${wanted} failed (${reason.split("\n")[0]}) — retrying with ${FALLBACK_MODEL}`);
    return runModel(wavPath, FALLBACK_MODEL, opts);
  }
}

async function runModel(wavPath: string, model: WhisperModel, opts: TranscribeOptions): Promise<Transcript> {
  const modelPath = await ensureModel(model);
  const outBase = path.join(opts.outDir || path.dirname(wavPath), "whisper");
  await fs.rm(`${outBase}.json`, { force: true });

  const dtw = DTW_PRESET[model];
  const vad = await ensureVadModel();

  const args = [
    "-m", modelPath,
    "-f", wavPath,
    "--output-json-full",
    "--output-file", outBase,
    "--max-len", "0",
    // "auto" makes whisper detect the language instead of assuming English.
    "-l", opts.language ?? "auto",
    "-t", String(opts.threads ?? Math.max(2, os.cpus().length - 2)),
  ];
  if (vad) {
    args.push(
      "--vad", "-vm", vad,
      // Keep a little audio either side of detected speech so word onsets and the
      // tails of sentences are not clipped off before the decoder sees them.
      "-vp", "60",
      // Without a ceiling, VAD hands over minutes-long blocks and the token times
      // inside them drift.
      "-vmsd", "20",
    );
  }
  if (dtw) {
    // DTW reads the cross-attention matrix, which the flash-attention kernel never
    // materialises — asking for both silently yields t_dtw = -1 on every token.
    args.push("-dtw", dtw, "-nfa");
  }
  const prompt = opts.prompt ?? process.env.AGENTCUT_WHISPER_PROMPT;
  if (prompt?.trim()) args.push("--prompt", prompt.trim().slice(0, 800));

  await run("whisper-cli", args, { timeoutMs: 0 });

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
  // Per segment, so a segment's boundaries can be taken from its own words rather
  // than from whisper's estimate — anything that looks a segment up by time (clip
  // snapping, the proofreader) then finds exactly the words it is made of.
  const perSegment: Word[][] = [];

  for (const seg of raw.transcription ?? []) {
    const tokens: Word[] = [];
    for (const tok of seg.tokens ?? []) {
      const text = tok.text ?? "";
      // whisper emits special tokens like [_BEG_] and timestamps — skip them
      if (!text.trim() || text.trim().startsWith("[_")) continue;
      const from = (tok.offsets?.from ?? 0) / 1000;
      const to = (tok.offsets?.to ?? 0) / 1000;
      // t_dtw is where the audio actually says this token; the offsets are whisper's
      // own estimate and only stand in when DTW was unavailable.
      const t = typeof tok.t_dtw === "number" && tok.t_dtw >= 0 ? tok.t_dtw / 100 : from;
      tokens.push({ t, d: Math.max(0.01, to - from), w: text, p: tok.p ?? 1 });
    }
    segments.push({
      start: (seg.offsets?.from ?? 0) / 1000,
      end: (seg.offsets?.to ?? 0) / 1000,
      text: (seg.text ?? "").trim(),
      speaker: null,
    });
    perSegment.push(mergeSubwords(tokens));
  }

  const runs = await speechRunsFromWav(wavPath).catch(() => []);
  // Token times come off the audio whisper actually decoded, which with VAD is the
  // speech stitched together without the silence. Only the segment timestamps are
  // mapped back to the source, so each segment's words are put back with them.
  // Without VAD both are already the source's own clock and must not be touched.
  const onSource = vad ? perSegment.map((segWords, i) => rebaseOntoSource(segWords, segments[i], runs)) : perSegment;
  const words = onSource.flat();
  const aligned = runs.length ? refineWordTimes(words, runs) : words;

  let cursor = 0;
  for (const [i, segWords] of onSource.entries()) {
    const own = aligned.slice(cursor, cursor + segWords.length);
    cursor += segWords.length;
    if (!own.length) continue;
    const last = own[own.length - 1];
    segments[i] = { ...segments[i], start: own[0].t, end: Math.max(last.t + last.d, own[0].t) };
  }

  opts.onLog?.(
    `${model}${vad ? " +vad" : ""}${dtw ? " +dtw" : ""} — ${segments.length} segments, ${aligned.length} words` +
      (runs.length ? `, snapped to ${runs.length} speech runs` : ""),
  );

  return Transcript.parse({
    language: raw.result?.language ?? "en",
    engine: engineId(model),
    segments,
    words: aligned,
  });
}

/** whisper tokens are sub-word pieces; stitch continuations onto the previous word. */
function mergeSubwords(tokens: Word[]): Word[] {
  const out: Word[] = [];
  for (const tok of tokens) {
    const startsWord = /^\s/.test(tok.w) || out.length === 0;
    if (startsWord) {
      out.push({ t: tok.t, d: tok.d, w: tok.w.trim(), p: tok.p });
    } else {
      const prev = out[out.length - 1];
      prev.w += tok.w;
      prev.d = Math.max(prev.d, tok.t + tok.d - prev.t);
      // A word is only as trustworthy as its least certain piece.
      prev.p = Math.min(prev.p ?? 1, tok.p ?? 1);
    }
  }
  return out.filter((w) => w.w.length > 0);
}
