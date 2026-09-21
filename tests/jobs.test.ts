import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * The project lock is one job at a time, and the row that holds it is written by a
 * process that can die without ever writing the ending. These cover the recovery:
 * a dead owner loses the lock, a live one keeps it, and the owner can always force it.
 */

let workspace: string;
let database: typeof import("../src/lib/db");
let reaper: typeof import("../src/lib/reaper");
let jobs: typeof import("../src/lib/jobs");

/** Above any pid the kernel hands out, so `kill(pid, 0)` is reliably ESRCH. */
const DEAD_PID = 2 ** 31 - 1;

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-jobs-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [database, reaper, jobs] = await Promise.all([
    import("../src/lib/db"), import("../src/lib/reaper"), import("../src/lib/jobs"),
  ]);
});
after(async () => { await fs.rm(workspace, { recursive: true, force: true }); });

let seq = 0;
function project(status = "ready", edl: string | null = '{"clips":[]}') {
  const id = `p${++seq}`;
  database.q.upsertProject({ id, name: `Project ${id}`, source_path: path.join(workspace, "source.mp4"), status });
  if (edl) database.db.prepare("UPDATE projects SET edl = ? WHERE id = ?").run(edl, id);
  database.q.setProject(id, { status });
  return id;
}

function insertJob(projectId: string, over: Partial<import("../src/lib/db").JobRow> = {}) {
  const now = Date.now();
  const job = {
    id: `j${++seq}`, project_id: projectId, kind: "edit", status: "running", stage: "agent",
    progress: 0.5, error: null, created_at: now, updated_at: now,
    pid: DEAD_PID, boot_id: "another-run", heartbeat: now, ...over,
  } as import("../src/lib/db").JobRow;
  database.q.insertJob(job);
  return job;
}

test("a job whose process is gone stops holding the project", () => {
  const id = project("agent");
  const job = insertJob(id);
  assert.ok(database.q.activeJob(id), "precondition: the row holds the lock");

  const reaped = reaper.reapDeadJobs(id);

  assert.deepEqual(reaped.map((j) => j.id), [job.id]);
  assert.ok(!database.q.activeJob(id), "the lock is open");
  assert.equal(database.q.getJob(job.id)?.status, "error");
  assert.match(database.q.getJob(job.id)?.error ?? "", /interrupted/);
  // The project is usable again, not painted red over a job nobody is waiting for.
  assert.equal(database.q.getProject(id)?.status, "ready");
  assert.equal(database.q.getProject(id)?.error, null);
});

test("a project that never finished analysing goes back to new, not ready", () => {
  const id = project("transcribe", null);
  insertJob(id, { kind: "analyze", stage: "transcribe" });
  reaper.reapDeadJobs(id);
  assert.equal(database.q.getProject(id)?.status, "new");
});

test("a job another live process is running keeps the lock", () => {
  const id = project("agent");
  // Same machine, different run: our own pid stands in for a live MCP process.
  const job = insertJob(id, { pid: process.pid, boot_id: "live-mcp", heartbeat: Date.now() });

  assert.deepEqual(reaper.reapDeadJobs(id), []);
  assert.equal(database.q.activeJob(id)?.id, job.id);
  assert.throws(() => jobs.startJob(id, "render"), /already running/);
});

test("a live pid that stopped beating long ago is treated as recycled", () => {
  const id = project("agent");
  insertJob(id, { pid: process.pid, boot_id: "recycled", heartbeat: Date.now() - 30 * 60_000 });
  assert.equal(reaper.reapDeadJobs(id).length, 1);
  assert.ok(!database.q.activeJob(id), "the lock is open");
});

test("a row this process wrote but is no longer running is dead", () => {
  const id = project("agent");
  // What a `next dev` hot reload used to leave behind: our boot id, no live run.
  insertJob(id, { pid: process.pid, boot_id: reaper.BOOT_ID });
  assert.equal(reaper.reapDeadJobs(id).length, 1);
  assert.ok(!database.q.activeJob(id), "the lock is open");
});

test("a claimed job is protected from the reaper until it is released", () => {
  const id = project("agent");
  const job = insertJob(id, { pid: process.pid, boot_id: reaper.BOOT_ID });
  reaper.claim(job.id, id);

  assert.deepEqual(reaper.reapDeadJobs(id), []);
  assert.equal(database.q.activeJob(id)?.id, job.id);

  reaper.release(job.id);
  assert.equal(reaper.reapDeadJobs(id).length, 1);
});

test("unlocking gives the project back and makes the abandoned run's ending a no-op", () => {
  const id = project("agent");
  const job = insertJob(id, { pid: process.pid, boot_id: reaper.BOOT_ID });
  reaper.claim(job.id, id);

  const stopped = reaper.unlockProject(id);

  assert.equal(stopped?.id, job.id);
  assert.equal(database.q.getJob(job.id)?.status, "canceled");
  assert.ok(!database.q.activeJob(id), "the lock is open");
  assert.equal(database.q.getProject(id)?.status, "ready");
  // The work was abandoned, not interrupted: if it ever finishes it must not write.
  assert.equal(reaper.ownsJob(job.id), false);
});

test("the agent has the same escape hatch as the panel", async () => {
  const id = project("agent");
  const job = insertJob(id, { pid: process.pid, boot_id: reaper.BOOT_ID });
  reaper.claim(job.id, id);
  const { executeEditorTool, projectStatus } = await import("../src/lib/editor/tools");

  // It can see the job it is waiting on, the same one the panel shows.
  assert.equal(projectStatus(id).working, true);
  assert.equal(projectStatus(id).job?.id, job.id);

  const result = await executeEditorTool(id, { tool: "project.unlock" }) as { stopped: { id: string } | null };

  assert.equal(result.stopped?.id, job.id);
  assert.equal(projectStatus(id).working, false);
  assert.ok(!database.q.activeJob(id), "the lock is open");
});

test("a status poll reaps a job whose process is gone", async () => {
  const id = project("agent");
  insertJob(id);
  const { projectStatus } = await import("../src/lib/editor/tools");
  assert.equal(projectStatus(id).working, false);
  assert.equal(projectStatus(id).status, "ready");
});

test("a render lock left by a dead process is taken over, not obeyed forever", async () => {
  const id = project();
  const dir = (await import("../src/lib/config")).projectDir(id);
  const lockPath = path.join(dir, "render.lock");
  await fs.writeFile(lockPath, JSON.stringify({ pid: DEAD_PID, at: Date.now() }));
  const render = await import("../src/lib/editor/render");

  // The run still fails — this fixture has no real footage — but on its own terms,
  // never on a lock whose owner does not exist.
  await assert.rejects(render.renderProject(id, { only: ["nope"] }), (e: Error) => !/render in progress/.test(e.message));
  assert.equal(await fs.readFile(lockPath, "utf8").then(() => true, () => false), false, "the lock is released");
});

test("a render lock held by a live process is respected", async () => {
  const id = project();
  const dir = (await import("../src/lib/config")).projectDir(id);
  await fs.writeFile(path.join(dir, "render.lock"), JSON.stringify({ pid: process.pid, at: Date.now() }));
  const render = await import("../src/lib/editor/render");

  await assert.rejects(render.renderProject(id), /already has a render in progress/);
});

test("startJob clears a dead owner and takes the lock", () => {
  const id = project("agent");
  const stale = insertJob(id);

  const job = jobs.startJob(id, "render");

  assert.equal(database.q.getJob(stale.id)?.status, "error");
  assert.equal(job.pid, process.pid);
  assert.equal(job.boot_id, reaper.BOOT_ID);
  assert.equal(database.q.activeJob(id)?.id, job.id);
});

/**
 * Automatic transcription is unfinished work that deliberately does not hold the
 * project. These pin the two halves of that: the lock stays open while it runs,
 * and the reaper still heals it — without handing back a project somebody else
 * is holding right now.
 */
const background = (projectId: string, over: Partial<import("../src/lib/db").JobRow> = {}) =>
  insertJob(projectId, { kind: "transcribe-media", status: "background", stage: "transcribing 1/3", ...over });

test("a source being transcribed does not lock the project, so the editing carries on", async () => {
  const id = project("ready");
  const words = background(id, { pid: process.pid, boot_id: reaper.BOOT_ID });
  reaper.claim(words.id, id);

  assert.equal(database.q.activeJob(id), undefined, "the lock never closed");
  // The whole point: a render, an agent turn or a human save is not refused.
  const render = jobs.startJob(id, "render");
  assert.equal(database.q.activeJob(id)?.id, render.id);
  assert.equal(database.q.getJob(words.id)?.status, "background", "and the transcription is untouched by it");
  // It is still unfinished work the reaper can see.
  assert.ok(database.q.unfinishedJobs(id).some((j) => j.id === words.id));
  assert.equal(database.q.backgroundJobs(id)[0]?.id, words.id);
  reaper.release(words.id);
  reaper.unlockProject(id);
});

test("a transcription whose process died is reaped without disturbing the job that holds the project", () => {
  const id = project("agent");
  const live = insertJob(id, { kind: "edit", pid: process.pid, boot_id: reaper.BOOT_ID });
  reaper.claim(live.id, id);
  const dead = background(id);

  const reaped = reaper.reapDeadJobs(id);

  assert.deepEqual(reaped.map((j) => j.id), [dead.id]);
  assert.equal(database.q.getJob(dead.id)?.status, "error");
  // The live edit still holds the project, and its status was not cleared underneath it.
  assert.equal(database.q.activeJob(id)?.id, live.id);
  assert.equal(database.q.getProject(id)?.status, "agent");
  reaper.release(live.id);
});

test("stopping a project also stops the recogniser working on its footage", () => {
  const id = project("ready");
  const words = background(id, { pid: process.pid, boot_id: reaper.BOOT_ID });
  reaper.claim(words.id, id);

  const stopped = reaper.unlockProject(id);

  assert.equal(stopped?.id, words.id, "with no lock job, the background run is what was stopped");
  assert.equal(database.q.getJob(words.id)?.status, "canceled");
  // The drain checks this between sources, so the queue stops without writing.
  assert.equal(reaper.ownsJob(words.id), false);
});

test("background transcription is not what an interface means by 'what is this project doing'", async () => {
  const id = project("ready");
  const words = background(id, { pid: process.pid, boot_id: reaper.BOOT_ID });
  reaper.claim(words.id, id);
  const { projectStatus } = await import("../src/lib/editor/tools");

  const status = projectStatus(id);
  assert.notEqual(status.job?.id, words.id, "the panel does not paint the editor busy over it");
  assert.equal(status.working, false);
  // It is reported where it belongs instead: next to the sources it is about.
  assert.ok(status.transcription);
  reaper.release(words.id);
});
