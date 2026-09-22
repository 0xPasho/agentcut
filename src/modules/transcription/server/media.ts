import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "../../../common/server/config";
import { q } from "../../../common/server/db";
import { wordsForClip } from "../lib/transcript";
import { probe, audioLevel, SILENCE_PEAK_DB } from "../../media/server/ffmpeg";
import type { MediaTranscription } from "../../editor/types";
import { editProject, readEditor, RevisionConflict } from "../../editor/server/store";
import type { EditorOperation } from "../../editor/lib/operations";
import { ensureTranscript, type TranscribeRunOptions } from "./transcribe";
import { resolveTranscribeMode, type TranscribeMode } from "./settings";

/**
 * Imported media get their own transcript, one per file, under
 * `<project>/transcripts/<mediaId>/`. The words go onto every timeline item cut
 * from that media through ordinary item.patch operations, so captions on a raw
 * upload work the same as on a clipped source.
 *
 * Where each source stands is recorded on the media itself (`media.transcription`),
 * in the same atomic batch as the words it produced. That record is the durable
 * half of the state: done, failed with its reason, skipped with its reason, or
 * queued. "Running" is deliberately not one of them — see `auto.ts`.
 */
export type MediaTranscribeOptions = Pick<TranscribeRunOptions, "brief" | "provider" | "model" | "onLog" | "onEvent" | "force" | "recognise"> & {
  mediaIds?: string[];
  /**
   * Apply the import-time rules before spending a recogniser run: `audio` skips a
   * file with no audio track or with silence on it, `always` transcribes anyway.
   * Omitted means the caller asked for this by name and gets it regardless.
   */
  gate?: TranscribeMode;
  /** Who asked. "" is a person, "import" the automatic pass, "agent:<id>" a turn. */
  by?: string;
  /** Checked between sources: false abandons the rest without marking them failed. */
  keepGoing?: () => boolean;
  onMedia?: (media: { id: string; name: string }, phase: "start" | "done") => void;
};

export type MediaTranscribeResult = {
  mediaId: string;
  words: number;
  items: number;
  status: MediaTranscription["status"];
  reason: string;
  error?: string;
};

export const mediaTranscriptDir = (projectId: string, mediaId: string) => path.join(projectDir(projectId), "transcripts", mediaId);

declare global {
  /** `projectId:mediaId` → the run in flight, so two callers share one recogniser. */
  var __agentcutTranscribing: Map<string, Promise<MediaTranscribeResult>> | undefined;
}
const inFlight = (globalThis.__agentcutTranscribing ??= new Map<string, Promise<MediaTranscribeResult>>());
const key = (projectId: string, mediaId: string) => `${projectId}:${mediaId}`;

/** Which sources this process is recognising right now. The live half of the state. */
export const transcribingNow = (projectId: string) =>
  new Set([...inFlight.keys()].filter((k) => k.startsWith(`${projectId}:`)).map((k) => k.slice(projectId.length + 1)));

/**
 * Whether this file is worth a recogniser run, before paying for one. A decode to
 * measure the peak costs a fraction of what whisper costs, and it is the whole
 * reason forty silent b-roll clips do not become forty model runs.
 */
export async function skipReason(file: string, mode: TranscribeMode): Promise<string> {
  if (mode === "always") return "";
  if (mode === "off") return "automatic transcription is off for this project";
  const meta = await probe(file).catch(() => null);
  // An unreadable file is not a skip: let the run fail with the recogniser's own message.
  if (!meta) return "";
  if (!meta.hasAudio) return "this file has no audio track";
  const level = await audioLevel(file);
  if (!level) return "this file has no audio track";
  if (level.maxDb <= SILENCE_PEAK_DB) return `this file's audio is silent (peaks at ${level.maxDb.toFixed(0)} dB)`;
  return "";
}

/** Write one source's standing, and optionally the words it produced, as one revision. */
function record(projectId: string, mediaId: string, transcription: MediaTranscription, words?: EditorOperation[]) {
  for (let attempt = 0; ; attempt++) {
    const current = readEditor(projectId);
    // The media can be removed while its transcription is running. That is not an error.
    if (!current.edl.media.some((m) => m.id === mediaId)) return current;
    const operations: EditorOperation[] = [...(words ?? []), { type: "media.transcription", mediaId, transcription }];
    try { return editProject(projectId, { expectedRevision: current.revision, operations }); }
    catch (error) { if (!(error instanceof RevisionConflict) || attempt >= 5) throw error; }
  }
}

/** Mark sources as waiting for the recogniser. Used by import, before any work starts. */
export function markQueued(projectId: string, mediaIds: string[], by = "import", reason = "") {
  if (!mediaIds.length) return;
  for (const mediaId of mediaIds) record(projectId, mediaId, { status: "queued", reason, engine: "", words: 0, at: Date.now(), by });
}

/** Record a decision that needed no recogniser at all — the import-time skips. */
export function markSkipped(projectId: string, mediaId: string, reason: string, by = "import") {
  record(projectId, mediaId, { status: "skipped", reason, engine: "", words: 0, at: Date.now(), by });
}

async function transcribeOne(projectId: string, media: { id: string; name: string; file: string }, o: MediaTranscribeOptions): Promise<MediaTranscribeResult> {
  const by = o.by ?? "";
  const skip = o.gate ? await skipReason(media.file, o.gate) : "";
  if (skip) {
    o.onLog?.(`${media.name}: not transcribed — ${skip}`);
    markSkipped(projectId, media.id, skip, by);
    return { mediaId: media.id, words: 0, items: 0, status: "skipped", reason: skip };
  }
  const dir = mediaTranscriptDir(projectId, media.id);
  await fs.mkdir(dir, { recursive: true });
  const { transcript } = await ensureTranscript({
    dir, sourcePath: media.file, projectId,
    brief: o.brief, provider: o.provider, model: o.model, force: o.force, recognise: o.recognise,
    onLog: o.onLog, onEvent: o.onEvent,
  });
  const current = readEditor(projectId);
  const operations: EditorOperation[] = [];
  for (const sequence of current.edl.sequences) for (const item of sequence.items) {
    if (item.mediaId !== media.id) continue;
    operations.push({ type: "item.patch", sequenceId: sequence.id, itemId: item.id, patch: { words: wordsForClip(transcript, item.clip.start, item.clip.end) } });
  }
  record(projectId, media.id, {
    status: "done", reason: "", engine: transcript.engine, words: transcript.words.length, at: Date.now(), by,
  }, operations);
  return { mediaId: media.id, words: transcript.words.length, items: operations.length, status: "done", reason: "" };
}

export async function transcribeProjectMedia(projectId: string, o: MediaTranscribeOptions = {}) {
  if (!q.getProject(projectId)) throw new Error("Project not found");
  const { edl } = readEditor(projectId);
  const wanted = edl.media.filter((m) => !o.mediaIds || o.mediaIds.includes(m.id));
  if (o.mediaIds?.some((id) => !edl.media.some((m) => m.id === id))) throw new Error("Media not found");
  const results: MediaTranscribeResult[] = [];
  for (const media of wanted) {
    if (o.keepGoing && !o.keepGoing()) break;
    o.onMedia?.(media, "start");
    // Two callers — an import's background pass and a batch run, or the same source
    // imported twice — share one recogniser rather than racing over one transcript.
    const running = inFlight.get(key(projectId, media.id));
    const run = running ?? transcribeOne(projectId, media, o).catch((error: Error) => {
      const reason = error.message;
      o.onLog?.(`${media.name}: transcription failed — ${reason}`);
      // The reason belongs on the media, the way a failed batch video keeps its
      // `plan.reasons.error`: an interface that only sees "no words" cannot tell a
      // silent video from a recogniser that is not installed.
      try { record(projectId, media.id, { status: "failed", reason, engine: "", words: 0, at: Date.now(), by: o.by ?? "" }); }
      catch { /* the reason is already in the log */ }
      return { mediaId: media.id, words: 0, items: 0, status: "failed" as const, reason, error: reason };
    });
    if (!running) inFlight.set(key(projectId, media.id), run);
    try { results.push(await run); }
    finally {
      if (!running) inFlight.delete(key(projectId, media.id));
      o.onMedia?.(media, "done");
    }
  }
  return { revision: readEditor(projectId).revision, results };
}

/**
 * The state of every source's words, for a human panel and an agent tool alike:
 * the durable record on the media, plus whatever is running in this process.
 */
export function transcriptionState(projectId: string) {
  const { edl, revision } = readEditor(projectId);
  const live = transcribingNow(projectId);
  const mode = resolveTranscribeMode(projectId);
  return {
    revision,
    mode,
    media: edl.media.map((m) => ({
      id: m.id,
      name: m.name,
      running: live.has(m.id),
      // A source nobody has considered reads as "none", not as a video with no speech.
      status: live.has(m.id) ? ("running" as const) : m.transcription?.status ?? ("none" as const),
      reason: m.transcription?.reason ?? "",
      engine: m.transcription?.engine ?? "",
      words: m.transcription?.words ?? 0,
      at: m.transcription?.at ?? 0,
      by: m.transcription?.by ?? "",
    })),
  };
}

/**
 * One sentence for an agent's prompt, so a run never reads empty `words` as "this
 * video has no speech" while the recogniser is still working on it.
 */
export function transcriptionNote(projectId: string): string {
  let state;
  try { state = transcriptionState(projectId); } catch { return ""; }
  const waiting = state.media.filter((m) => m.status === "running" || m.status === "queued");
  const failed = state.media.filter((m) => m.status === "failed");
  const skipped = state.media.filter((m) => m.status === "skipped");
  const lines: string[] = [];
  if (waiting.length) lines.push(`Still being transcribed: ${waiting.map((m) => m.name).join(", ")}. Their words are not final — do not conclude these sources have no speech, and do not write words onto them by hand.`);
  if (failed.length) lines.push(`Transcription failed: ${failed.map((m) => `${m.name} (${m.reason})`).join("; ")}. Retry with media.transcribe, or say so.`);
  if (skipped.length) lines.push(`Not transcribed: ${skipped.map((m) => `${m.name} (${m.reason})`).join("; ")}.`);
  return lines.join("\n");
}
