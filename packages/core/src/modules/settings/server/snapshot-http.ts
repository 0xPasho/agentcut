import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { fileResponse } from "../../../common/server/http-file";
import { SNAPSHOT_LIMITS } from "../data";
import { executeSnapshotCommand, snapshotFile } from "./snapshots";

export async function downloadSnapshot(id: string) {
  const response = await fileResponse(snapshotFile(id), null);
  response.headers.set("Content-Disposition", `attachment; filename="agentcut-workspace-${id.slice(0, 8)}.agentcut.gz"`);
  response.headers.set("Content-Type", "application/gzip");
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export async function uploadSnapshot(request: Request) {
  if (!request.body) throw new Error("Choose a workspace snapshot file");
  const id = randomUUID(), file = snapshotFile(id);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let size = 0;
  const limit = new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length;
    if (size > SNAPSHOT_LIMITS.compressed) { callback(new Error("Choose a snapshot smaller than 512 MB")); return; }
    callback(null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(request.body as import("node:stream/web").ReadableStream), limit, createWriteStream(file, { flags: "wx", mode: 0o600 }));
    return { id, preview: await executeSnapshotCommand({ tool: "workspace.snapshot.preview", file }) };
  } catch (error) { await fs.rm(file, { force: true }); throw error; }
}

export async function snapshotRequest(input: unknown) {
  const body = z.discriminatedUnion("action", [
    z.object({ action: z.literal("export") }).strict(),
    z.object({ action: z.literal("restore"), id: z.string(), fingerprint: z.string(), confirm: z.literal("replace-workspace-data") }).strict(),
  ]).parse(input);
  if (body.action === "export") return executeSnapshotCommand({ tool: "workspace.snapshot.export" });
  return executeSnapshotCommand({ tool: "workspace.snapshot.restore", file: snapshotFile(body.id), fingerprint: body.fingerprint, confirm: body.confirm });
}
