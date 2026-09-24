import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnStream } from "../server/spawn";

/**
 * When a harness counts as hung.
 *
 * A wall-clock limit once killed an agent that was working: it had asked the host for a
 * transcription, the host took twenty-one minutes, and the fifteen-minute timer fired a
 * heartbeat before the answer landed. Time is not the measure — silence is, and only
 * while the host owes the agent nothing.
 */
const node = (script: string, opts: Parameters<typeof spawnStream>[2]) =>
  spawnStream(process.execPath, ["-e", script], opts);

test("a harness that says nothing while it waits on one of our tools is left alone", async () => {
  let busy = true;
  setTimeout(() => { busy = false; }, 600);
  const res = await node("setTimeout(() => console.log('done'), 800)", { cwd: process.cwd(), idleMs: 500, busy: () => busy });
  assert.equal(res.code, 0);
  assert.match(res.stdout, /done/);
});

test("a harness that says nothing with nothing owed to it is stopped, and the reason says so", async () => {
  await assert.rejects(
    node("setTimeout(() => console.log('too late'), 10_000)", { cwd: process.cwd(), idleMs: 300 }),
    /said nothing for 0s|said nothing/,
  );
});

test("a harness that keeps talking runs past the idle limit, however long the work takes", async () => {
  const lines: string[] = [];
  const res = await node(
    "let n = 0; const t = setInterval(() => { console.log('step', ++n); if (n === 8) { clearInterval(t); } }, 100)",
    { cwd: process.cwd(), idleMs: 300, onLine: (l) => lines.push(l) },
  );
  assert.equal(res.code, 0);
  assert.equal(lines.length, 8);
});

test("a ceiling still ends a harness stuck in a loud loop", async () => {
  await assert.rejects(
    node("setInterval(() => console.log('spin'), 20)", { cwd: process.cwd(), idleMs: 60_000, maxMs: 500 }),
    /ran past its/,
  );
});

test("a busy host does not keep a harness alive past the ceiling", async () => {
  await assert.rejects(
    node("setTimeout(() => {}, 10_000)", { cwd: process.cwd(), idleMs: 60_000, maxMs: 400, busy: () => true }),
    /ran past its/,
  );
});

/**
 * And when it counts as unwanted. Stopping used to mean "let go of the lock": the row
 * said canceled, the panel unlocked, and the harness carried on talking to a model on
 * behalf of somebody who had already walked away.
 */
test("stopping the job kills the harness it spawned, not just the lock", async () => {
  const { cancelJob, claim, release, runWithJob } = await import("../../project/server/reaper");
  const jobId = "test-stop";
  claim(jobId, "test-project");
  const started = Date.now();
  await runWithJob(jobId, async () => {
    const run = node("setInterval(() => {}, 1000)", { cwd: process.cwd(), idleMs: 60_000 });
    // What "Stop" does, minus the database: fire the job's signal.
    setTimeout(() => cancelJob(jobId, "stopped by the owner"), 150);
    await assert.rejects(run, /was stopped/);
  });
  release(jobId);
  assert.ok(Date.now() - started < 5_000, "it ended when it was told to, not at a timeout");
});

test("a harness is never started for a job that has already been stopped", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    node("console.log('should not run')", { cwd: process.cwd(), signal: controller.signal }),
    /was stopped before it started/,
  );
});
