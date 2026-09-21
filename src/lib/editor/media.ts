import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { projectDir } from "../config";
import { probe } from "../media";
import { Clip, Edl, MediaSource } from "../edl";
import { q } from "../db";
import { editProject, publishClips, readEditor, RevisionConflict } from "./store";
import type { EditorOperation } from "./operations";

export type MediaInput = { name: string; bytes: Uint8Array } | { file: string } | { assetId: string };
/** Where a new shot goes when it is imported straight onto a timeline. */
export type MediaPlacement = { sequenceId: string; at?: number | null; layer?: number };
/** Copy source footage into the project so moving the original does not break edits. */
async function prepareMedia(projectId: string, input: MediaInput): Promise<MediaSource> {
  // A library video is already in the workspace: reference it, do not copy it again.
  if ("assetId" in input) {
    const asset = q.getAsset(input.assetId);
    if (!asset || asset.kind !== "video") throw new Error("Choose a video asset from the library");
    const { toAbs } = await import("../assets");
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
export async function importProjectMedia(projectId: string, expectedRevision: number, input: MediaInput, place?: MediaPlacement) {
  if (!q.getProject(projectId)) throw new Error("Project not found");
  z.number().int().nonnegative().parse(expectedRevision);
  const current = readEditor(projectId);
  if (current.revision !== expectedRevision) throw new RevisionConflict(current);
  const media = await prepareMedia(projectId, input);
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
  try { return editProject(projectId, { expectedRevision, operations }); }
  catch (error) { if (!known && !("assetId" in input)) await fs.rm(media.file, { force: true }); throw error; }
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
} = {}) {
  const id = randomUUID().slice(0, 10);
  let inserted = false;
  try {
    const media = [];
    for (const input of inputs) media.push(await prepareMedia(id, input));
    const first = media[0] ?? null;
    q.insertProject({ id, name: name.trim() || "Untitled project", source_path: first?.file ?? "", created_at: Date.now() });
    inserted = true;
    const output = options.output ?? (first ? { width: first.width, height: first.height, fps: first.fps } : { width: 1920, height: 1080, fps: 30 });
    const item = (m: MediaSource) => { const itemId = `i_${randomUUID().slice(0, 8)}`; return {
      id: itemId, mediaId: m.id, clip: Clip.parse({ id: itemId, title: m.name, start: 0, end: m.durationSec, captions: { preset: "none" } }),
    }; };
    const sequences = options.layout === "separate" && media.length
      ? media.map(m => ({ id: `s_${randomUUID().slice(0, 8)}`, title: m.name.replace(/\.[^.]+$/, ""), output: options.output ?? { width: m.width, height: m.height, fps: m.fps }, items: [item(m)] }))
      : [{ id: `s_${randomUUID().slice(0, 8)}`, title: "Main video", output, items: media.map(item) }];
    publishClips(id, Edl.parse({ projectId: id, source: first, output, media, clips: [], sequences }));
    q.setProject(id, { status: "ready" });
    return { id, name: q.getProject(id)!.name };
  } catch (error) {
    if (inserted) q.deleteProject(id);
    await fs.rm(projectDir(id), { recursive: true, force: true });
    throw error;
  }
}
