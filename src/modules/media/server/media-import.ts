import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { projectDir } from "../../../common/server/config";
import { probe } from "./ffmpeg";
import { Clip, Edl, MediaSource, type MediaTranscription } from "../../editor/types";
import { q } from "../../../common/server/db";
import { editProject, publishClips, readEditor, RevisionConflict } from "../../editor/server/store";
import type { EditorOperation } from "../../editor/lib/operations";

export type MediaInput = { name: string; bytes: Uint8Array } | { file: string } | { assetId: string };
/** Where a new shot goes when it is imported straight onto a timeline. */
export type MediaPlacement = { sequenceId: string; at?: number | null; layer?: number };
/**
 * What an import says about its own words. Every route into this app's media —
 * the home composer, `media.import`, `media.upload`, a library video placed into a
 * project, the batch flow, the CLI — lands in one of the two functions below, which
 * is why this is the only place that has to ask the question.
 *
 * `transcribe: false` is "not this one" and `true` is "this one regardless";
 * omitted follows the project's setting. Either way the answer is written onto the
 * media in the same atomic batch that registers it, so a source is never a video
 * that merely happens to have no words.
 */
export type ImportOptions = { transcribe?: boolean; by?: string };
/** Copy source footage into the project so moving the original does not break edits. */
async function prepareMedia(projectId: string, input: MediaInput): Promise<MediaSource> {
  // A library video is already in the workspace: reference it, do not copy it again.
  if ("assetId" in input) {
    const asset = q.getAsset(input.assetId);
    if (!asset || asset.kind !== "video") throw new Error("Choose a video asset from the library");
    const { toAbs } = await import("./assets");
    const file = toAbs(asset.path);
    const metadata = await probe(file);
    return MediaSource.parse({ id: `m_${randomUUID().replaceAll("-", "")}`, name: asset.name, file, ...metadata });
  }
  const id = `m_${randomUUID().replaceAll("-", "")}`;
  const name = "file" in input ? path.basename(input.file) : path.basename(input.name);
  const dir = path.join(projectDir(projectId), "media");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}${path.extname(name) || ".mp4"}`);
  try {
    if ("file" in input) {
      const source = path.resolve(input.file.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
      if (!(await fs.stat(source)).isFile()) throw new Error("Choose a video file");
      await fs.copyFile(source, file);
    } else await fs.writeFile(file, input.bytes);
    const metadata = await probe(file);
    return MediaSource.parse({ id, name, file, ...metadata });
  } catch (error) { await fs.rm(file, { force: true }); throw error; }
}
/**
 * Whether this source should recognise itself, as a record to store on it. The
 * decision is taken here, at import, because that is where the person or the agent
 * said what they were doing; the run itself happens afterwards, off the lock.
 */
async function transcriptionIntent(projectId: string, options: ImportOptions = {}): Promise<MediaTranscription> {
  const { importSkipReason } = await import("../../transcription/server/auto");
  const reason = importSkipReason(projectId, options.transcribe);
  const base = { engine: "", words: 0, at: Date.now(), by: options.by ?? "import" };
  return reason ? { ...base, status: "skipped", reason } : { ...base, status: "queued", reason: "" };
}

export async function importProjectMedia(projectId: string, expectedRevision: number, input: MediaInput, place?: MediaPlacement, options: ImportOptions = {}) {
  if (!q.getProject(projectId)) throw new Error("Project not found");
  z.number().int().nonnegative().parse(expectedRevision);
  const current = readEditor(projectId);
  if (current.revision !== expectedRevision) throw new RevisionConflict(current);
  const prepared = await prepareMedia(projectId, input);
  const media = { ...prepared, transcription: await transcriptionIntent(projectId, options) };
  // The same library video used twice is one media entry, not two.
  const known = current.edl.media.find(m => m.file === media.file);
  const source = known ?? media;
  const operations: EditorOperation[] = [];
  if (!known) operations.push({ type: "media.add", media });
  if (place) {
    const itemId = `i_${randomUUID().slice(0, 8)}`;
    operations.push({ type: "item.add", sequenceId: place.sequenceId, item: {
      id: itemId, mediaId: source.id, at: place.at ?? null, layer: place.layer ?? 0,
      clip: Clip.parse({ id: itemId, title: source.name, start: 0, end: source.durationSec, captions: { preset: "none" } }),
    } });
  }
  if (!operations.length) return current;
  let saved;
  try { saved = editProject(projectId, { expectedRevision, operations }); }
  catch (error) { if (!known && !("assetId" in input)) await fs.rm(media.file, { force: true }); throw error; }
  // Only once the media is committed: a queue entry for a source no revision holds
  // would be a recogniser run against a file the project does not have.
  if (!known && media.transcription?.status === "queued") await startTranscribing(projectId, [media.id], options.by);
  return saved;
}

/**
 * Hand the new sources to the background recogniser. Never fatal: an import that
 * succeeded must not be reported as failed because the queue could not start, and
 * the sources stay marked waiting, which is what the retry reads.
 */
async function startTranscribing(projectId: string, mediaIds: string[], by?: string) {
  try {
    const { startMediaTranscription } = await import("../../transcription/server/auto");
    startMediaTranscription(projectId, { mediaIds, by: by ?? "import" });
  } catch (error) {
    console.error("automatic transcription did not start", error);
  }
}
/**
 * A new video project. With no inputs it is an empty canvas in the same editor: one
 * sequence, no media, and no primary source — footage is imported later, as media.
 */
export async function createVideoProject(name: string, inputs: MediaInput[] = [], options: {
  /** `together`: one timeline with every input in a row. `separate`: one video per input, for a batch. */
  layout?: "together" | "separate";
  /**
   * The shape the author asked for. Without it a project takes the shape of its first
   * source, which is right when footage is what started it and wrong when someone chose
   * "vertical" on an empty canvas and then dropped a landscape clip in.
   */
  output?: { width: number; height: number; fps: number };
  /** Off for this project's starting footage, on regardless, or the setting's answer. */
  transcribe?: boolean;
} = {}) {
  const id = randomUUID().slice(0, 10);
  let inserted = false;
  try {
    const media: MediaSource[] = [];
    const intent = await transcriptionIntent(id, { transcribe: options.transcribe });
    for (const input of inputs) media.push({ ...(await prepareMedia(id, input)), transcription: intent });
    const first = media[0] ?? null;
    q.insertProject({ id, name: name.trim() || "Untitled project", source_path: first?.file ?? "", created_at: Date.now() });
    inserted = true;
    const output = options.output ?? (first ? { width: first.width, height: first.height, fps: first.fps } : { width: 1920, height: 1080, fps: 30 });
    const item = (m: MediaSource) => { const itemId = `i_${randomUUID().slice(0, 8)}`; return {
      id: itemId, mediaId: m.id, clip: Clip.parse({ id: itemId, title: m.name, start: 0, end: m.durationSec, captions: { preset: "none" } }),
    }; };
    // Nothing was dropped and no shape was asked for: the project has no frame yet, and
    // says so, rather than pretending 1920x1080 was a decision somebody made. The first
    // video imported settles it.
    const undecided = !options.output && !first;
    const sequences = options.layout === "separate" && media.length
      ? media.map(m => ({ id: `s_${randomUUID().slice(0, 8)}`, title: m.name.replace(/\.[^.]+$/, ""), output: options.output ?? { width: m.width, height: m.height, fps: m.fps }, items: [item(m)] }))
      : [{ id: `s_${randomUUID().slice(0, 8)}`, title: "Main video", output, ...(undecided ? { autoOutput: true } : {}), items: media.map(item) }];
    publishClips(id, Edl.parse({ projectId: id, source: first, output, media, clips: [], sequences }));
    q.setProject(id, { status: "ready" });
    // Footage dropped on the home screen is exactly the footage whose words every
    // later judgement needs, so a new project starts recognising itself too.
    if (intent.status === "queued" && media.length) await startTranscribing(id, media.map((m) => m.id));
    return { id, name: q.getProject(id)!.name };
  } catch (error) {
    if (inserted) q.deleteProject(id);
    await fs.rm(projectDir(id), { recursive: true, force: true });
    throw error;
  }
}
