import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { q } from "../../../common/server/db";
import { projectDir } from "../../../common/server/config";
import { cloneFile, saveStream } from "../../media/server/ingest";
import { isUrl, titleFor } from "./ingest";

/**
 * A new project from whatever the person handed over: a file streamed as the request
 * body, a multipart form, a link, or a path on this machine. Returns the project, or a
 * sentence saying why there is none. Whatever the route, the footage ends up as the
 * project's own `source.<ext>`: a path is cloned there, bytes are written as they arrive.
 */
export type Created = { id: string; name: string } | { error: string };

function register(id: string, name: string, sourcePath: string): Created {
  q.insertProject({ id, name, source_path: sourcePath, created_at: Date.now() });
  return { id, name };
}

/**
 * A dropped file arrives as the raw body and is written as it arrives. Buffering it
 * instead put the whole recording in memory, which failed outright past two gigabytes —
 * the size of an ordinary stream recording — with nothing but a 500 to show for it.
 */
export async function createFromUpload(fileName: string, body: ReadableStream | null): Promise<Created> {
  if (!body) return { error: "no file" };
  const id = randomUUID().slice(0, 10);
  const dir = projectDir(id);
  const name = decodeURIComponent(fileName);
  const sourcePath = path.join(dir, `source${path.extname(name) || ".mp4"}`);
  try {
    await saveStream(body, sourcePath);
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    return { error: `${name} could not be saved: ${(e as Error).message}` };
  }
  return register(id, name, sourcePath);
}

export async function createFromForm(file: FormDataEntryValue | null): Promise<Created> {
  if (!(file instanceof File)) return { error: "no file" };
  const id = randomUUID().slice(0, 10);
  const sourcePath = path.join(projectDir(id), `source${path.extname(file.name) || ".mp4"}`);
  await saveStream(file.stream(), sourcePath);
  return register(id, file.name, sourcePath);
}

export async function createFromSource(raw: string | undefined): Promise<Created> {
  const source = raw?.trim();
  if (!source) return { error: "source required" };
  const id = randomUUID().slice(0, 10);
  // The title comes from the site, which may be unreachable or refuse the link. The
  // link is still a project: fall back to it rather than failing the whole request.
  if (isUrl(source)) return register(id, await titleFor(source).catch(() => source), source);
  const original = path.resolve(source.replace(/^~/, process.env.HOME ?? "~"));
  try {
    if (!(await fs.stat(original)).isFile()) return { error: `not a file: ${original}` };
  } catch {
    return { error: `file not found: ${original}` };
  }
  // The project keeps its own clone rather than the path: it survives the original
  // moving, and a pack or a copied workspace carries the footage with it.
  const dir = projectDir(id);
  const sourcePath = path.join(dir, `source${path.extname(original) || ".mp4"}`);
  try {
    await cloneFile(original, sourcePath);
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    return { error: `${path.basename(original)} could not be added: ${(e as Error).message}` };
  }
  return register(id, path.basename(original), sourcePath);
}
