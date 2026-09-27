import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { WORKSPACE, projectDir } from "../../../common/server/config";
import { readEditor } from "../../editor/server/store";
import { claimPidLock, renderProject } from "../../render/server/render-project";
import { probe } from "../../media/server/ffmpeg";
import type { Edl } from "../../editor/types";
import type { Artifact } from "../types";
import { artifact, put } from "./store";

export function contentSignature(edl: Edl, sequenceId: string): string {
  const video = edl.sequences.find(s => s.id === sequenceId) ?? edl.clips.find(c => c.id === sequenceId);
  if (!video) throw new Error("Video no longer exists");
  const value = { ...video, ...("plan" in video ? { plan: undefined } : {}) };
  const media = "items" in video ? edl.media.filter(m => video.items.some(i => i.mediaId === m.id)) : [];
  return createHash("sha256").update(JSON.stringify({ video: value, media, source: edl.source, output: "output" in video ? video.output : edl.output })).digest("hex");
}
export function artifactFile(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid artifact"); return path.join(WORKSPACE, "publishing", "artifacts", `${id}.mp4`); }
export async function fileHash(file: string) { const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex"); }
export async function captureArtifact(projectId: string, sequenceId: string, revision: number, signature: string, source: string): Promise<Artifact> {
  const id = randomUUID(), target = artifactFile(id), temp = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, temp);
  try {
    const [sha256, stat, meta] = await Promise.all([fileHash(temp), fs.stat(temp), probe(temp)]);
    if (!meta.width || !meta.height || !meta.durationSec) throw new Error("The export is not a playable video");
    await fs.rename(temp, target);
    const record: Artifact = { id, projectId, sequenceId, revision, signature, sha256, bytes: stat.size, width: meta.width, height: meta.height, duration: meta.durationSec, createdAt: Date.now() };
    put("artifact", id, record);
    return record;
  } catch (error) { await fs.rm(temp, { force: true }); throw error; }
}
export async function verifyArtifact(id: string) { const a = artifact(id); if (await fileHash(artifactFile(id)) !== a.sha256) throw new Error("Approved export changed. Pin a verified export before publishing."); return a; }
export async function pinExport(projectId: string, sequenceId: string, render: boolean) {
  const snapshot = readEditor(projectId), signature = contentSignature(snapshot.edl, sequenceId);
  if (render) {
    let captured: Artifact | null = null;
    await renderProject(projectId, { only: [sequenceId], expectedRevision: snapshot.revision, capture: async (outputs, revision) => { captured = await captureArtifact(projectId, sequenceId, revision, signature, outputs[0].file); } });
    if (!captured) throw new Error("No export was produced");
    return captured as Artifact;
  }
  const dir = projectDir(projectId), lockPath = path.join(dir, "render.lock");
  const lock = await claimPidLock(lockPath, "Wait for the current export to finish");
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(dir, "rendered.json"), "utf8"));
    const entry = manifest[sequenceId] as { revision: number; file: string } | undefined;
    if (!entry || entry.revision !== snapshot.revision) throw new Error("Export the current revision before pinning it, or choose Render and pin");
    return await captureArtifact(projectId, sequenceId, snapshot.revision, signature, path.join(dir, "clips", path.basename(entry.file)));
  } finally { await lock.close(); await fs.rm(lockPath, { force: true }); }
}
