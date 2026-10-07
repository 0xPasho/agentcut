import fs from "node:fs/promises";
import { constants, mkdirSync, renameSync, rmSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { db } from "../../../common/server/db";
import "../../../common/server/secrets";
import "../../publishing/server/store";
import { clearMediaIndex } from "../../editor/server/store";
import { WORKSPACE, ROOT } from "../../../common/server/config";
import { SNAPSHOT_TABLES } from "../data";
import { SnapshotCommand } from "../types";
import type { SnapshotExport, SnapshotImport, SnapshotPreview, SnapshotRead, SnapshotTable } from "../types";
import { rebaseSnapshotValue } from "../lib/snapshot";
import { digest, inventorySnapshot, readSnapshotArchive, writeSnapshotArchive } from "./snapshot-files";

let busy = false;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const resolveFile = (file: string) => path.resolve(file.replace(/^~(?=\/)/, os.homedir()));

export function snapshotFile(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Snapshot not found");
  return path.join(WORKSPACE, "exports", "snapshots", `${id}.agentcut.gz`);
}

function databaseTables(): SnapshotTable[] {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
  return names.map(({ name }) => {
    if (!(SNAPSHOT_TABLES as readonly string[]).includes(name)) throw new Error(`Update Agentcut to export the workspace table ${name}`);
    const info = db.prepare(`PRAGMA table_info(${quote(name)})`).all() as Array<{ name: string; type: SnapshotTable["columns"][number]["type"]; notnull: number; pk: number }>;
    const columns = info.map(c => ({ name: c.name, type: c.type, notNull: !!c.notnull, primaryKey: c.pk }));
    const rows = db.prepare(`SELECT * FROM ${quote(name)}`).all().map(row => columns.map(c => row[c.name] as string | number | null));
    return { name, columns, rows };
  });
}

function preview(snapshot: SnapshotRead): SnapshotPreview {
  const table = (name: string) => snapshot.tables.find(t => t.name === name);
  const settings = table("settings"), publications = table("publishing_records");
  return {
    createdAt: snapshot.header.createdAt, projects: table("projects")?.rows.length ?? 0,
    packs: snapshot.files.filter(f => /^packs\/[^/]+\.json$/.test(f.path)).length,
    files: snapshot.files.length, publications: publications?.rows.filter(r => r[publications.columns.findIndex(c => c.name === "kind")] === "publication").length ?? 0,
    omittedMedia: snapshot.header.omitted.length,
    includesCredentials: !!settings?.rows.some(r => r[settings.columns.findIndex(c => c.name === "scope")] === "secret" && r[settings.columns.findIndex(c => c.name === "value")]) || !!table("publishing_secrets")?.rows.length,
    fingerprint: snapshot.fingerprint,
  };
}

async function exportSnapshot(destination?: string): Promise<SnapshotExport> {
  const id = randomUUID(), file = snapshotFile(id);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  db.exec("BEGIN");
  let tables: SnapshotTable[];
  try { tables = databaseTables(); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
  const inventory = await inventorySnapshot(WORKSPACE);
  try {
    await writeSnapshotArchive(file, WORKSPACE, {
      format: "agentcut-workspace", version: 1, createdAt: new Date().toISOString(),
      sourceWorkspace: WORKSPACE, sourceRoot: ROOT, files: inventory.files.length, tables: tables.length, omitted: inventory.omitted,
    }, tables, inventory);
    if (digest(JSON.stringify(databaseTables())) !== digest(JSON.stringify(tables)) || JSON.stringify((await inventorySnapshot(WORKSPACE)).files) !== JSON.stringify(inventory.files)) {
      throw new Error("Workspace changed during export. Wait for ongoing work to finish and export again.");
    }
    const restored = await readSnapshotArchive(file);
    let output = file;
    if (destination) {
      output = resolveFile(destination);
      if ((await fs.stat(/*turbopackIgnore: true*/ output).catch(() => null))?.isDirectory()) output = path.join(output, `agentcut-workspace-${new Date().toISOString().slice(0, 10)}-${id.slice(0, 8)}.agentcut.gz`);
      if (output !== file) {
        await fs.copyFile(file, output, constants.COPYFILE_EXCL);
        await fs.chmod(output, 0o600);
      }
    }
    return { ...preview(restored), id, file: output, bytes: (await fs.stat(file)).size, downloadUrl: `/api/workspace/snapshot?id=${id}` };
  } catch (error) { await fs.rm(file, { force: true }); throw error; }
}

function assertIdle() {
  const jobs = db.prepare("SELECT count(*) AS n FROM jobs WHERE status IN ('queued','running')").get() as { n: number };
  if (jobs.n) throw new Error("Finish or stop running jobs before restoring workspace data");
  const leases = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publishing_leases'").get();
  if (leases && db.prepare("SELECT 1 FROM publishing_leases WHERE until_at > ? LIMIT 1").get(Date.now())) throw new Error("Finish the publishing session before restoring workspace data");
}

function rebase(value: unknown, snapshot: SnapshotRead): unknown {
  return rebaseSnapshotValue(value, snapshot.header.sourceWorkspace, WORKSPACE, { previous: snapshot.header.sourceRoot, next: ROOT });
}

function rebaseCell(cell: string | number | null, snapshot: SnapshotRead) {
  if (typeof cell !== "string") return cell;
  try {
    const parsed: unknown = JSON.parse(cell);
    const changed = rebase(parsed, snapshot);
    return JSON.stringify(parsed) === JSON.stringify(changed) ? cell : JSON.stringify(changed);
  } catch { return rebase(cell, snapshot) as string; }
}

function restoredRow(table: SnapshotTable, row: Array<string | number | null>, snapshot: SnapshotRead) {
  const values = row.map(v => rebaseCell(v, snapshot));
  const index = (name: string) => table.columns.findIndex(c => c.name === name);
  const set = (name: string, value: string | number | null) => { const i = index(name); if (i >= 0) values[i] = value; };
  if (table.name === "jobs" && ["queued", "running"].includes(String(values[index("status")]))) {
    set("status", "failed"); set("error", "Interrupted by workspace transfer. Start the job again when its media is available.");
    set("pid", null); set("boot_id", null); set("heartbeat", null);
  }
  if (table.name === "publication_attempts" && values[index("ended_at")] === null) { set("ended_at", Date.now()); set("result", "unknown_after_workspace_transfer"); }
  if (table.name === "publishing_records") {
    const kind = values[index("kind")];
    // Approval for a live send and device leases never become runnable on a second computer.
    if (kind === "grant" || kind === "approval") return null;
    if (kind === "publication") {
      const record = JSON.parse(String(values[index("document")]));
      for (const destination of record.destinations ?? []) {
        if (["queued", "sending", "cancel_pending"].includes(destination.state)) {
          destination.state = "unknown";
          destination.error = "Transferred during delivery. Verify the result before sending again.";
        }
      }
      set("document", JSON.stringify(record));
    }
    if (kind === "session") {
      const record = JSON.parse(String(values[index("document")]));
      if (record.status === "active") { record.status = "aborted"; record.step = "Stopped by workspace transfer"; }
      record.leaseUntil = 0;
      set("document", JSON.stringify(record));
    }
  }
  return values;
}

function restoreDatabase(snapshot: SnapshotRead) {
  const existing = databaseTables();
  for (const table of snapshot.tables) {
    const local = existing.find(t => t.name === table.name);
    if (local && JSON.stringify([...local.columns].sort((a, b) => a.name.localeCompare(b.name))) !== JSON.stringify([...table.columns].sort((a, b) => a.name.localeCompare(b.name)))) throw new Error("This snapshot needs the same Agentcut database version. Update Agentcut before restoring.");
    if (!local) {
      if (table.name === "sqlite_sequence") continue;
      const primary = table.columns.filter(c => c.primaryKey).sort((a, b) => a.primaryKey - b.primaryKey);
      const columns = table.columns.map(c => `${quote(c.name)} ${c.type}${c.notNull ? " NOT NULL" : ""}`);
      if (primary.length) columns.push(`PRIMARY KEY (${primary.map(c => quote(c.name)).join(",")})`);
      db.exec(`CREATE TABLE ${quote(table.name)} (${columns.join(",")})`);
    }
  }
  for (const table of existing) db.exec(`DELETE FROM ${quote(table.name)}`);
  for (const table of snapshot.tables.filter(t => t.name !== "publishing_leases" && t.name !== "sqlite_sequence")) {
    const insert = db.prepare(`INSERT INTO ${quote(table.name)} (${table.columns.map(c => quote(c.name)).join(",")}) VALUES (${table.columns.map(() => "?").join(",")})`);
    for (const row of table.rows) {
      const values = restoredRow(table, row, snapshot);
      if (values) insert.run(...values);
    }
  }
  const sequences = snapshot.tables.find(t => t.name === "sqlite_sequence");
  if (sequences) {
    db.exec("DELETE FROM sqlite_sequence");
    const insert = db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)");
    for (const row of sequences.rows) insert.run(...row);
  }
  if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Snapshot contains inconsistent project references");
}

async function prepareFiles(stage: string, snapshot: SnapshotRead) {
  for (const file of snapshot.files) {
    // Rebasing JSON updates media references, pack installation paths and saved history together.
    if (!file.path.endsWith(".json")) continue;
    const target = path.join(stage, file.path);
    let parsed: unknown;
    try { parsed = JSON.parse(await fs.readFile(target, "utf8")); } catch { continue; }
    const changed = rebase(parsed, snapshot);
    if (/^packs\/[^/]+\.json$/.test(file.path) && changed && typeof changed === "object") {
      (changed as Record<string, unknown>).trustedRecipesHash = null;
    }
    await fs.writeFile(target, JSON.stringify(changed, null, 2), { mode: 0o600 });
  }
}

async function restoreSnapshot(file: string, fingerprint: string): Promise<SnapshotImport> {
  assertIdle();
  const stage = await fs.mkdtemp(path.join(WORKSPACE, ".snapshot-stage-"));
  const rollback = await fs.mkdtemp(path.join(WORKSPACE, ".snapshot-rollback-"));
  const moved: string[] = [], installed: string[] = [];
  let transaction = false, recovered = false;
  try {
    const incoming = await readSnapshotArchive(resolveFile(file), stage);
    if (incoming.fingerprint !== fingerprint) throw new Error("The snapshot changed. Preview it again before restoring.");
    await prepareFiles(stage, incoming);
    const backup = await exportSnapshot();
    const before = await readSnapshotArchive(backup.file);
    const current = await inventorySnapshot(WORKSPACE);
    db.exec("BEGIN IMMEDIATE"); transaction = true;
    db.exec("PRAGMA defer_foreign_keys = ON");
    assertIdle();
    if (digest(JSON.stringify(databaseTables())) !== digest(JSON.stringify(before.tables))) throw new Error("Workspace changed after the backup. Preview and restore again.");
    if (current.files.length !== before.files.length || current.files.some(item => {
      const saved = before.files.find(f => f.path === item.path);
      return !saved || saved.sha256 !== digest(readFileSync(path.join(WORKSPACE, item.path)));
    })) throw new Error("Workspace files changed after the backup. Preview and restore again.");
    // Refuse parent symlinks, even if an existing binary file uses that path.
    for (const item of incoming.files) {
      const parts = item.path.split("/");
      for (let length = 1; length <= parts.length; length++) {
        const entry = lstatSync(path.join(WORKSPACE, ...parts.slice(0, length)), { throwIfNoEntry: false });
        if (entry?.isSymbolicLink()) throw new Error("Remove workspace symlinks before restoring data");
      }
    }
    for (const item of current.files) {
      const target = path.join(rollback, item.path);
      mkdirSync(path.dirname(target), { recursive: true });
      renameSync(path.join(WORKSPACE, item.path), target); moved.push(item.path);
    }
    for (const item of incoming.files) {
      const target = path.join(WORKSPACE, item.path);
      mkdirSync(path.dirname(target), { recursive: true });
      renameSync(path.join(stage, item.path), target); installed.push(item.path);
    }
    restoreDatabase(incoming);
    db.exec("COMMIT"); transaction = false; recovered = true;
    clearMediaIndex();
    return { backup, restored: preview(incoming) };
  } catch (error) {
    if (transaction) db.exec("ROLLBACK");
    for (const item of installed.reverse()) rmSync(path.join(WORKSPACE, item), { force: true });
    for (const item of moved.reverse()) {
      mkdirSync(path.dirname(path.join(WORKSPACE, item)), { recursive: true });
      renameSync(path.join(rollback, item), path.join(WORKSPACE, item));
    }
    recovered = true; throw error;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
    if (recovered) await fs.rm(rollback, { recursive: true, force: true });
  }
}

/** UI, terminal and workspace MCP share this command surface. Never returns secret bytes. */
export async function executeSnapshotCommand(input: unknown): Promise<SnapshotExport | SnapshotPreview | SnapshotImport> {
  const command = SnapshotCommand.parse(input);
  if (busy) throw new Error("Another workspace transfer is running. Wait for it to finish.");
  busy = true;
  try {
    if (command.tool === "workspace.snapshot.export") return await exportSnapshot(command.destination);
    if (command.tool === "workspace.snapshot.preview") return preview(await readSnapshotArchive(resolveFile(command.file)));
    return await restoreSnapshot(command.file, command.fingerprint);
  } finally { busy = false; }
}
