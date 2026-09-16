import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { run, which } from "../bin";
import { Transcript, type Segment, type Word } from "../transcript";

export const MODEL_DIR = path.join(os.homedir(), ".cache", "clipsmith", "models");
const MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export type WhisperModel = "tiny.en" | "base.en" | "small.en" | "medium.en" | "large-v3-turbo";

export async function available() {
  return (await which("whisper-cli")) !== null;
}

export async function ensureModel(model: WhisperModel = "small.en"): Promise<string> {
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
  if (!res.ok) throw new Error(`model download failed: ${res.status} ${url}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
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
  opts: { model?: WhisperModel; outDir?: string; threads?: number } = {},
): Promise<Transcript> {
  const model = await ensureModel(opts.model ?? "small.en");
  const outBase = path.join(opts.outDir || path.dirname(wavPath), "whisper");

  await run("whisper-cli", [
    "-m", model,
    "-f", wavPath,
    "--output-json-full",
    "--output-file", outBase,
    "--max-len", "0",
    "-t", String(opts.threads ?? Math.max(2, os.cpus().length - 2)),
  ], { timeoutMs: 0 });

  const raw = JSON.parse(await fs.readFile(`${outBase}.json`, "utf8")) as WhisperJson;
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
