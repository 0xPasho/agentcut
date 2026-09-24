import fs from "node:fs/promises";
import { existsSync, openSync, readSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
import { q } from "../../../common/server/db";
import { projectDir } from "../../../common/server/config";
import { extractAudio, probe } from "../../media/server/ffmpeg";
import { isUrl } from "../../../common/lib/urls";
import { readEditor } from "../../editor/server/store";
import { Transcript, fmt, type Segment, type Word } from "../lib/transcript";
import { parseTranscript, providedEngine, wordsAcross } from "../lib/import";
import { PROVIDED_RECORD } from "../data";
import type { ProvidedTranscript, SourceTranscriptState } from "../types";
import { speechRunsFromWav, spreadOverSpeech, type SpeechRun } from "./align";
import { writeTranscript } from "./transcribe";

/**
 * A transcript the person already has, made the project's words.
 *
 * It is written where the recogniser's would be — `transcript.json` in the project, or
 * under `transcripts/<mediaId>/` for imported media — with a `provided:<format>`
 * engine, so everything that reads words (clip selection, captions, silence cuts, the
 * editing agent) reads it without knowing where it came from, and `ensureTranscript`
 * returns it instead of running whisper. The file as it was handed over is kept next
 * to it, with a record of its name and how finely it was timed.
 */

export type ImportTranscriptOptions = {
  text: string;
  /** The file's name as it was handed over; its extension settles an ambiguous format. */
  name?: string;
  /** Imported media to attach it to. Omitted, or the project's own source, means the source. */
  mediaId?: string;
  by?: string;
  onLog?: (text: string) => void;
};

type Target = { dir: string; file: string | null; mediaId: string | null; label: string };

/** Jobs that read or write the transcript while they run. An editing turn does neither. */
const READERS = new Set(["analyze", "transcribe", "batch"]);

async function mediaDir(projectId: string, mediaId: string) {
  const { mediaTranscriptDir } = await import("./media");
  return mediaTranscriptDir(projectId, mediaId);
}

async function target(projectId: string, mediaId?: string): Promise<Target> {
  const project = q.getProject(projectId);
  if (!project) throw new Error("Project not found");
  const source = { dir: projectDir(projectId), file: isUrl(project.source_path) ? null : project.source_path, mediaId: null, label: "the source" };
  if (!mediaId || mediaId === "primary_source") return source;
  const media = readEditor(projectId).edl.media.find((m) => m.id === mediaId);
  if (!media) throw new Error("Media not found");
  return { dir: await mediaDir(projectId, media.id), file: media.file, mediaId: media.id, label: media.name };
}

/**
 * Words for a file that is timed only per line: each line's words are laid over the
 * speech the sound shows inside it, by the same placement whisper's words get. With no
 * sound to read — a link not downloaded yet, a file ffmpeg cannot decode — they are
 * spread across the line, which is still inside the right second.
 */
async function fitWords(segments: Segment[], file: string | null, dir: string, onLog?: (text: string) => void): Promise<Word[]> {
  let runs: SpeechRun[] = [];
  if (file) {
    try {
      runs = await speechRunsFromWav(await extractAudio(file, path.join(dir, "audio.wav")));
    } catch (error) {
      onLog?.(`could not read the sound (${(error as Error).message}); words are spread across each line`);
    }
  }
  const words: Word[] = [];
  let from = 0;
  for (const seg of segments) {
    // Lines are in order, so a run that ended before this one starts is behind all the rest.
    while (from < runs.length && runs[from].end <= seg.start) from++;
    let to = from;
    while (to < runs.length && runs[to].start < seg.end) to++;
    words.push(...spreadOverSpeech(wordsAcross(seg.text, seg.end - seg.start), seg, runs.slice(from, to)));
  }
  return words;
}

/**
 * Parse, time and write a provided transcript into `dir`. No project needed: the
 * command line calls this for a video it clips without one.
 */
export async function writeProvidedTranscript(o: { text: string; name?: string; file: string | null; dir: string; by?: string; onLog?: (text: string) => void }) {
  const durationSec = o.file ? await probe(o.file).then((meta) => meta.durationSec).catch(() => undefined) : undefined;
  const parsed = parseTranscript(o.text, { name: o.name, durationSec });
  const lastStart = Math.max(parsed.words.at(-1)?.t ?? 0, parsed.segments.at(-1)?.start ?? 0);
  if (durationSec && lastStart > durationSec + 5) {
    throw new Error(`This transcript runs to ${fmt(lastStart)} but the video is ${fmt(durationSec)} long. Is it the transcript of this video?`);
  }

  await fs.mkdir(o.dir, { recursive: true });
  const timing = parsed.words.length ? "words" : "segments";
  const words = parsed.words.length ? parsed.words : await fitWords(parsed.segments, o.file, o.dir, o.onLog);
  const transcript = Transcript.parse({
    language: parsed.language ?? "und",
    engine: providedEngine(parsed.format),
    segments: parsed.segments,
    words,
  });

  const record: ProvidedTranscript = {
    name: o.name?.trim() || `transcript.${parsed.format === "lines" ? "txt" : parsed.format}`,
    format: parsed.format,
    timing,
    words: transcript.words.length,
    segments: transcript.segments.length,
    at: Date.now(),
    by: o.by ?? "",
  };
  await removeProvidedFiles(o.dir);
  await fs.writeFile(path.join(o.dir, `transcript.original${path.extname(record.name) || ".txt"}`), o.text);
  await writeTranscript(path.join(o.dir, "transcript.json"), transcript);
  await fs.writeFile(path.join(o.dir, PROVIDED_RECORD), JSON.stringify(record));

  const covered = durationSec && transcript.words.length ? (transcript.words.at(-1)!.t - transcript.words[0].t) / durationSec : 1;
  o.onLog?.(
    `${record.name}: ${record.words} words in ${record.segments} lines` +
      (timing === "segments" ? ", timed per line and fitted to the speech" : ", timed per word") +
      (covered < 0.5 ? ` — it covers only ${Math.round(covered * 100)}% of the video` : ""),
  );
  return { transcript, record };
}

async function removeProvidedFiles(dir: string) {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(files
    .filter((file) => file === PROVIDED_RECORD || file.startsWith("transcript.original."))
    .map((file) => fs.rm(path.join(dir, file), { force: true })));
}

/**
 * Make a transcript the person has the words of the source (or of one imported media),
 * and put those words on everything already cut from it.
 */
export async function importTranscript(projectId: string, o: ImportTranscriptOptions) {
  const where = await target(projectId, o.mediaId);
  const job = q.activeJob(projectId);
  if (job && READERS.has(job.kind)) throw new Error(`A ${job.kind} job is reading this project's words; add the transcript when it finishes`);

  const { record } = await writeProvidedTranscript({ text: o.text, name: o.name, file: where.file, dir: where.dir, by: o.by, onLog: o.onLog });

  // The words go onto the timeline through the paths that already do it for the
  // recogniser's: they read the transcript just written, so there is one way words land.
  let patched = 0;
  const { transcribeProjectMedia, transcribingNow } = await import("./media");
  if (where.mediaId && transcribingNow(projectId).has(where.mediaId)) {
    // The recogniser already listening to this media keeps the provided transcript
    // when it finishes, and puts those words on the timeline itself.
    o.onLog?.(`${where.label} is still being recognised; your words replace its words when that run ends`);
  } else if (where.mediaId) {
    const done = await transcribeProjectMedia(projectId, { mediaIds: [where.mediaId], by: o.by, onLog: o.onLog });
    patched = done.results[0]?.items ?? 0;
  } else if (where.file) {
    const { resyncTranscript } = await import("./resync");
    patched = (await resyncTranscript(projectId, { reuse: true, onLog: o.onLog })).patched;
  }
  return { ...record, engine: providedEngine(record.format), target: where.mediaId ?? "source", patched, revision: readEditor(projectId).revision };
}

/**
 * Stop treating a provided transcript as the words. The next analysis or transcription
 * runs the recogniser; the words already on clips stay until it does, because an
 * empty caption track is worse than the last words anybody trusted.
 */
export async function discardTranscript(projectId: string, o: { mediaId?: string } = {}) {
  const where = await target(projectId, o.mediaId);
  if (!existsSync(path.join(where.dir, PROVIDED_RECORD))) {
    throw new Error(`${where.label} has no transcript you provided; its words came from the recogniser`);
  }
  await removeProvidedFiles(where.dir);
  await fs.rm(path.join(where.dir, "transcript.json"), { force: true });
  if (where.mediaId) {
    const { forgetTranscription } = await import("./media");
    forgetTranscription(projectId, where.mediaId);
  }
  return { target: where.mediaId ?? "source", revision: readEditor(projectId).revision };
}

/**
 * Where the source's words come from. Synchronous and cheap, because both interfaces
 * poll it: the record is a few bytes, and a recognised transcript is only read far
 * enough to find its engine — a five-hour one is megabytes.
 */
export function sourceTranscriptState(projectId: string): SourceTranscriptState {
  const dir = projectDir(projectId);
  try {
    const record = JSON.parse(readFileSync(path.join(dir, PROVIDED_RECORD), "utf8")) as ProvidedTranscript;
    return { status: "provided", engine: providedEngine(record.format), ...record };
  } catch { /* none provided */ }
  const file = path.join(dir, "transcript.json");
  if (!existsSync(file)) return { status: "none" };
  const head = Buffer.alloc(256);
  const fd = openSync(file, "r");
  try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
  return { status: "recognised", engine: /"engine":"([^"]*)"/.exec(head.toString("utf8"))?.[1] ?? "" };
}
