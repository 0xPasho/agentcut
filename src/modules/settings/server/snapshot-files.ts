import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createGzip, createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { SNAPSHOT_EXCLUDED_ROOTS, SNAPSHOT_LIMITS, SNAPSHOT_MEDIA, SNAPSHOT_TABLES } from "../data";
import { snapshotPathAllowed } from "../lib/snapshot";
import { SnapshotHeader, SnapshotFile, SnapshotTable } from "../types";
import type { SnapshotInventory, SnapshotRead } from "../types";

export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export async function inventorySnapshot(root: string): Promise<SnapshotInventory> {
  const result: SnapshotInventory = { files: [], omitted: [] };
  async function walk(relative: string) {
    for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
      if (!relative && ((SNAPSHOT_EXCLUDED_ROOTS as readonly string[]).includes(name) || name.startsWith(".snapshot-"))) continue;
      const file = relative ? `${relative}/${name}` : name;
      const stat = await fs.lstat(path.join(root, file));
      if (stat.isSymbolicLink()) {
        if (snapshotPathAllowed(file)) throw new Error(`Copy the linked workspace file into the workspace before exporting: ${file}`);
        result.omitted.push({ path: file, bytes: stat.size });
        continue;
      }
      if (stat.isDirectory()) { await walk(file); continue; }
      if (!stat.isFile()) continue;
      if (!snapshotPathAllowed(file)) {
        if (SNAPSHOT_MEDIA.test(file)) result.omitted.push({ path: file, bytes: stat.size });
        continue;
      }
      if (stat.size > SNAPSHOT_LIMITS.file) throw new Error(`Workspace data file exceeds the 128 MB snapshot limit: ${file}`);
      result.files.push({ path: file, bytes: stat.size, modifiedAt: stat.mtimeMs });
      if (result.files.length > SNAPSHOT_LIMITS.entries) throw new Error("Too many workspace files for one snapshot");
    }
  }
  await walk("");
  return result;
}

/** NDJSON inside gzip: process one file at a time, even when run history is large. */
export async function writeSnapshotArchive(file: string, root: string, header: SnapshotHeader, tables: SnapshotTable[], inventory: SnapshotInventory) {
  const hash = createHash("sha256");
  let expanded = 0;
  function line(record: unknown) {
    const text = JSON.stringify(record) + "\n";
    expanded += Buffer.byteLength(text);
    if (expanded > SNAPSHOT_LIMITS.expanded) throw new Error("Workspace data exceeds the 1 GB snapshot limit");
    hash.update(text);
    return text;
  }
  async function* records() {
    yield line({ kind: "header", value: header });
    for (const table of tables) yield line({ kind: "table", value: table });
    for (const item of inventory.files) {
      const content = await fs.readFile(path.join(root, item.path));
      const stat = await fs.stat(path.join(root, item.path));
      if (content.length !== item.bytes || stat.mtimeMs !== item.modifiedAt) throw new Error("Workspace files changed during export. Wait for ongoing work to finish and try again.");
      yield line({ kind: "file", value: { path: item.path, sha256: digest(content), data: content.toString("base64") } });
    }
    yield JSON.stringify({ kind: "end", sha256: hash.digest("hex") }) + "\n";
  }
  await pipeline(Readable.from(records()), createGzip(), createWriteStream(file, { flags: "wx", mode: 0o600 }));
  if ((await fs.stat(file)).size > SNAPSHOT_LIMITS.compressed) throw new Error("Snapshot exceeds the 512 MB transfer limit");
}

async function* lines(file: string) {
  if ((await fs.stat(file)).size > SNAPSHOT_LIMITS.compressed) throw new Error("Choose a snapshot smaller than 512 MB");
  const source = createReadStream(file), decoded = createGunzip(), decoder = new StringDecoder("utf8");
  source.on("error", error => decoded.destroy(error));
  source.pipe(decoded);
  let pending: string[] = [], bytes = 0;
  try {
    for await (const chunk of decoded) {
      bytes += chunk.length;
      if (bytes > SNAPSHOT_LIMITS.expanded) throw new Error("Snapshot expands beyond the 1 GB transfer limit");
      const text = decoder.write(chunk);
      let from = 0, at: number;
      while ((at = text.indexOf("\n", from)) >= 0) {
        pending.push(text.slice(from, at));
        yield pending.join("");
        pending = [];
        from = at + 1;
      }
      if (from < text.length) pending.push(text.slice(from));
    }
    const tail = decoder.end();
    if (pending.length || tail) throw new Error("Incomplete snapshot: missing final newline");
  } finally { source.destroy(); decoded.destroy(); }
}

export async function readSnapshotArchive(file: string, stage?: string): Promise<SnapshotRead> {
  let header: SnapshotHeader | undefined, fingerprint = "", ended = false;
  const tables: SnapshotTable[] = [], files: SnapshotRead["files"] = [], names = new Set<string>();
  const hash = createHash("sha256");
  for await (const line of lines(file)) {
    if (ended) throw new Error("Unexpected data after the end of the snapshot");
    const record = JSON.parse(line) as { kind: string; value?: unknown; sha256?: string };
    if (record.kind === "end") {
      fingerprint = hash.digest("hex");
      if (fingerprint !== record.sha256) throw new Error("Snapshot checksum does not match");
      ended = true;
      continue;
    }
    hash.update(line + "\n");
    if (!header) {
      if (record.kind !== "header") throw new Error("Choose an Agentcut workspace snapshot");
      header = SnapshotHeader.parse(record.value);
      continue;
    }
    if (record.kind === "table") {
      const table = SnapshotTable.parse(record.value);
      if (!(SNAPSHOT_TABLES as readonly string[]).includes(table.name) || tables.some(t => t.name === table.name)) throw new Error("Unsupported or duplicate snapshot table");
      if (new Set(table.columns.map(c => c.name)).size !== table.columns.length || table.rows.some(r => r.length !== table.columns.length)) throw new Error("Invalid snapshot table columns");
      tables.push(table);
      continue;
    }
    if (record.kind !== "file") throw new Error("Unsupported snapshot record");
    const entry = SnapshotFile.parse(record.value);
    if (!snapshotPathAllowed(entry.path) || names.has(entry.path)) throw new Error("Unsafe or duplicate snapshot file path");
    const content = Buffer.from(entry.data, "base64");
    if (content.length > SNAPSHOT_LIMITS.file || content.toString("base64") !== entry.data || digest(content) !== entry.sha256) throw new Error("Invalid snapshot file or checksum");
    names.add(entry.path);
    files.push({ path: entry.path, sha256: entry.sha256 });
    if (files.length > SNAPSHOT_LIMITS.entries) throw new Error("Too many files in the snapshot");
    if (stage) {
      const target = path.join(stage, entry.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, { flag: "wx", mode: 0o600 });
    }
  }
  if (!header || !ended || files.length !== header.files || tables.length !== header.tables) throw new Error("Incomplete workspace snapshot");
  if (!tables.some(t => t.name === "projects") || !tables.some(t => t.name === "settings")) throw new Error("Snapshot is missing its workspace database");
  return { header, tables, files, fingerprint };
}
