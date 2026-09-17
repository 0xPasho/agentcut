import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { projectDir } from "../config";
import { probe } from "../media";
import { Clip, Edl, MediaSource } from "../edl";
import { q } from "../db";
import { editProject, publishClips, readEditor, RevisionConflict } from "./store";

export type MediaInput = { name: string; bytes: Uint8Array } | { file: string };
/** Copy source footage into the project so moving the original does not break edits. */
async function prepareMedia(projectId: string, input: MediaInput) {
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
export async function importProjectMedia(projectId: string, expectedRevision: number, input: MediaInput) {
  if (!q.getProject(projectId)) throw new Error("Project not found");
  z.number().int().nonnegative().parse(expectedRevision);
  const current = readEditor(projectId);
  if (current.revision !== expectedRevision) throw new RevisionConflict(current);
  const media = await prepareMedia(projectId, input);
  try { return editProject(projectId, { expectedRevision, operations: [{ type: "media.add", media }] }); }
  catch (error) { await fs.rm(media.file, { force: true }); throw error; }
}
/**
 * A new video project. With no inputs it is an empty canvas in the same editor: one
 * sequence, no media, and no primary source — footage is imported later, as media.
 */
export async function createVideoProject(name: string, inputs: MediaInput[] = []) {
  const id = randomUUID().slice(0, 10);
  let inserted = false;
  try {
    const media = [];
    for (const input of inputs) media.push(await prepareMedia(id, input));
    const first = media[0] ?? null;
    q.insertProject({ id, name: name.trim() || "Untitled project", source_path: first?.file ?? "", created_at: Date.now() });
    inserted = true;
    const output = first ? { width: first.width, height: first.height, fps: first.fps } : { width: 1920, height: 1080, fps: 30 };
    publishClips(id, Edl.parse({ projectId: id, source: first, output, media, clips: [], sequences: [{
      id: `s_${randomUUID().slice(0, 8)}`, title: "Main video", output,
      items: media.map(m => { const itemId = `i_${randomUUID().slice(0, 8)}`; return {
        id: itemId, mediaId: m.id, clip: Clip.parse({ id: itemId, title: m.name, start: 0, end: m.durationSec, captions: { preset: "none" } }),
      }; }),
    }] }));
    q.setProject(id, { status: "ready" });
    return { id, name: q.getProject(id)!.name };
  } catch (error) {
    if (inserted) q.deleteProject(id);
    await fs.rm(projectDir(id), { recursive: true, force: true });
    throw error;
  }
}
