import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import type { SnapshotExport, SnapshotImport, SnapshotRead } from "../types";
import { snapshotPathAllowed, rebaseSnapshotValue } from "../lib/snapshot";

let workspace: string;
let service: typeof import("../server/snapshots");
let archive: typeof import("../server/snapshot-files");
let database: typeof import("../../../common/server/db");
let saved: SnapshotExport;
let original: SnapshotRead;
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-snapshot-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  service = await import("../server/snapshots");
  archive = await import("../server/snapshot-files");
  database = await import("../../../common/server/db");
  database.q.insertProject({ id: "transfer", name: "My project", source_path: path.join(workspace, "recording.mp4"), created_at: 1 });
  const secrets = await import("../../../common/server/secrets");
  secrets.setProviderKey("pexels", "private-test-key");
  for (const [name, value] of Object.entries({
    "onboarding.json": '{"profile":{"name":"Owner","language":"es"}}',
    "preferences.md": "Use my own wording", "glossary.json": '[]',
    "packs/style.json": '{"id":"style","trustedRecipesHash":"old-trust"}',
    "packs/style/reference.mp4": "pack footage", "library/music.wav": "library music",
    "recording.mp4": "large recording", "transfer/edl.json": JSON.stringify({ file: path.join(workspace, "recording.mp4") }),
  })) {
    await fs.mkdir(path.dirname(path.join(workspace, name)), { recursive: true });
    await fs.writeFile(path.join(workspace, name), value);
  }
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

test("one inclusion rule retains logical data and pack media but rejects traversal, databases and outputs", () => {
  for (const p of ["../x", "/etc/file", "a/../../x", "a\\b", "clipsmith.db-wal", "exports/a.json", "bin/ffmpeg", "recording.mp4"]) assert.equal(snapshotPathAllowed(p), false, p);
  for (const p of ["onboarding.json", "packs/demo/reference.mp4", "library/song.wav", "project/history.json"]) assert.equal(snapshotPathAllowed(p), true, p);
  assert.deepEqual(rebaseSnapshotValue({ file: "/old/a", text: "Mention /old/a", other: "/older/a" }, "/old", "/new"), { file: "/new/a", text: "Mention /old/a", other: "/older/a" });
});

test("UI export and agent preview share complete private data without returning credentials", async () => {
  const http = await import("../server/snapshot-http");
  saved = await http.snapshotRequest({ action: "export" }) as SnapshotExport;
  original = await archive.readSnapshotArchive(saved.file);
  assert.equal(saved.projects, 1); assert.equal(saved.packs, 1); assert.equal(saved.includesCredentials, true);
  assert.equal(saved.omittedMedia, 1);
  assert.equal((await fs.stat(saved.file)).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(saved).includes("private-test-key"));
  assert.ok(JSON.stringify(original.tables).includes("private-test-key"));
  const mcp = await import("../../agent/server/mcp");
  assert.deepEqual(await mcp.callMcpTool("agentcut_workspace_snapshot_preview", { file: saved.file }), (({ id, file, bytes, downloadUrl, ...preview }) => preview)(saved));
  const response = await http.downloadSnapshot(saved.id);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await fs.readFile(saved.file));
});

test("restore replaces logical data, keeps footage, removes old files, resets trust and saves recovery", async () => {
  await fs.writeFile(path.join(workspace, "preferences.md"), "Newer local preference");
  await fs.writeFile(path.join(workspace, "extra.json"), "{}");
  database.db.prepare("UPDATE projects SET name=? WHERE id=?").run("Local name", "transfer");
  const restored = await service.executeSnapshotCommand({ tool: "workspace.snapshot.restore", file: saved.file, fingerprint: saved.fingerprint, confirm: "replace-workspace-data" }) as SnapshotImport;
  assert.equal(await fs.readFile(path.join(workspace, "preferences.md"), "utf8"), "Use my own wording");
  assert.equal(database.q.getProject("transfer")?.name, "My project");
  assert.equal(await fs.readFile(path.join(workspace, "recording.mp4"), "utf8"), "large recording");
  assert.equal(JSON.parse(await fs.readFile(path.join(workspace, "packs/style.json"), "utf8")).trustedRecipesHash, null);
  await assert.rejects(fs.stat(path.join(workspace, "extra.json")), { code: "ENOENT" });
  const recovery = await archive.readSnapshotArchive(restored.backup.file);
  assert.ok(JSON.stringify(recovery.tables).includes("Local name"));
});

async function altered(name: string, change: (records: any[]) => void) {
  const records = gunzipSync(await fs.readFile(saved.file)).toString().trimEnd().split("\n").map(line => JSON.parse(line));
  records.pop(); change(records);
  const body = records.map(record => JSON.stringify(record) + "\n").join("");
  const checksum = createHash("sha256").update(body).digest("hex");
  const file = path.join(workspace, "exports", `${name}.agentcut.gz`);
  await fs.writeFile(file, gzipSync(body + JSON.stringify({ kind: "end", sha256: checksum }) + "\n"));
  return { file, checksum };
}

test("corruption and unsafe paths fail before touching the workspace", async () => {
  const unsafe = await altered("unsafe", records => { records.find(r => r.kind === "file").value.path = "../escape.json"; });
  await assert.rejects(service.executeSnapshotCommand({ tool: "workspace.snapshot.restore", file: unsafe.file, fingerprint: unsafe.checksum, confirm: "replace-workspace-data" }), /Unsafe/);
  const bad = await altered("bad", records => { records.find(r => r.kind === "file").value.sha256 = "0".repeat(64); });
  await assert.rejects(archive.readSnapshotArchive(bad.file), /checksum/);
  await assert.rejects(service.executeSnapshotCommand({ tool: "workspace.snapshot.restore", file: saved.file, fingerprint: "0".repeat(64), confirm: "replace-workspace-data" }), /changed/);
  assert.equal(database.q.getProject("transfer")?.name, "My project");
});

test("schema failure rolls back database and file replacement", async () => {
  await fs.writeFile(path.join(workspace, "preferences.md"), "Keep on failure");
  const changed = await altered("schema", records => { records.find(r => r.kind === "table" && r.value.name === "projects").value.columns[0].type = "INTEGER"; });
  await assert.rejects(service.executeSnapshotCommand({ tool: "workspace.snapshot.restore", file: changed.file, fingerprint: changed.checksum, confirm: "replace-workspace-data" }), /database version/);
  assert.equal(await fs.readFile(path.join(workspace, "preferences.md"), "utf8"), "Keep on failure");
  assert.equal(database.q.getProject("transfer")?.name, "My project");
});

test("moving computers rebases database and JSON paths together", async () => {
  const changed = await altered("rebase", records => {
    for (const record of records) {
      if (record.kind === "header") record.value.sourceWorkspace = "/old/workspace";
      if (record.kind === "table") record.value = rebaseSnapshotValue(record.value, workspace, "/old/workspace");
      if (record.kind === "file" && record.value.path.endsWith("edl.json")) {
        const content = Buffer.from(JSON.stringify({ file: "/old/workspace/recording.mp4" }));
        record.value.data = content.toString("base64"); record.value.sha256 = archive.digest(content);
      }
    }
  });
  await service.executeSnapshotCommand({ tool: "workspace.snapshot.restore", file: changed.file, fingerprint: changed.checksum, confirm: "replace-workspace-data" });
  assert.equal(database.q.getProject("transfer")?.source_path, path.join(workspace, "recording.mp4"));
  assert.equal(JSON.parse(await fs.readFile(path.join(workspace, "transfer/edl.json"), "utf8")).file, path.join(workspace, "recording.mp4"));
});

test("active destination jobs block restore", async () => {
  database.db.prepare("INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES ('active','transfer','render','running',0,0)").run();
  await assert.rejects(service.executeSnapshotCommand({ tool: "workspace.snapshot.restore", file: saved.file, fingerprint: saved.fingerprint, confirm: "replace-workspace-data" }), /stop running jobs/);
  database.db.prepare("DELETE FROM jobs WHERE id='active'").run();
});

test("interrupted source jobs and sends never resume on the destination", async () => {
  database.db.prepare("INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at,pid,boot_id,heartbeat) VALUES ('source-active','transfer','render','running',0,0,123,'old',10)").run();
  database.db.prepare("INSERT INTO publishing_records(kind,id,revision,document) VALUES (?,?,0,?)").run("publication", "post", JSON.stringify({ destinations: [{ state: "sending" }, { state: "published" }] }));
  database.db.prepare("INSERT INTO publishing_records(kind,id,revision,document) VALUES (?,?,0,?)").run("approval", "grant", "{}");
  const source = await service.executeSnapshotCommand({ tool: "workspace.snapshot.export" }) as SnapshotExport;
  database.db.prepare("DELETE FROM jobs").run();
  await service.executeSnapshotCommand({ tool: "workspace.snapshot.restore", file: source.file, fingerprint: source.fingerprint, confirm: "replace-workspace-data" });
  const job = database.db.prepare("SELECT status,pid,boot_id,heartbeat FROM jobs WHERE id='source-active'").get();
  assert.deepEqual({ ...job }, { status: "failed", pid: null, boot_id: null, heartbeat: null });
  assert.equal(database.db.prepare("SELECT 1 FROM publishing_records WHERE kind='approval'").get(), undefined);
  const post = database.db.prepare("SELECT document FROM publishing_records WHERE id='post'").get()!;
  assert.deepEqual(JSON.parse(String(post.document)).destinations.map((d: { state: string }) => d.state), ["unknown", "published"]);
});


test("migrated databases can have a different physical column order", async () => {
  const changed = await altered("column-order", records => {
    const table = records.find(r => r.kind === "table" && r.value.name === "projects").value;
    table.columns.reverse(); table.rows.forEach((row: unknown[]) => row.reverse());
  });
  await service.executeSnapshotCommand({ tool: "workspace.snapshot.restore", file: changed.file, fingerprint: changed.checksum, confirm: "replace-workspace-data" });
  assert.equal(database.q.getProject("transfer")?.name, "My project");
  assert.equal(database.q.getProject("transfer")?.source_path, path.join(workspace, "recording.mp4"));
});
