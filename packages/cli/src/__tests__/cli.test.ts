import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planArgs } from "../args";
import { COMMANDS, usage } from "../commands-table";

const CLI = path.resolve(import.meta.dirname, "../..");

test("caller-relative paths become absolute; ids, titles and flags stay as typed", () => {
  assert.deepEqual(planArgs("packs", ["publish", "./kit"], "/home/a"), ["publish", "/home/a/kit"]);
  assert.deepEqual(planArgs("packs", ["install", "streamer-kit"], "/home/a"), ["install", "streamer-kit"]);
  assert.deepEqual(planArgs("packs", ["import", "https://x.dev/r/kit/1.0.0"], "/home/a"), ["import", "https://x.dev/r/kit/1.0.0"]);
  assert.deepEqual(planArgs("projects", ["create", "A / B", "v.mp4", "--brief", "short"], "/home/a"), ["create", "A / B", "/home/a/v.mp4", "--brief", "short"]);
  assert.deepEqual(planArgs("templates", ["apply", "p", "t", "--slot", "intro=./clips"], "/home/a"), ["apply", "p", "t", "--slot", "intro=/home/a/clips"]);
  assert.deepEqual(planArgs("login", [], "/home/a"), ["login"]);
});

test("every command has a line in the help, and every command file a command", () => {
  const help = usage();
  for (const name of Object.keys(COMMANDS)) assert.match(help, new RegExp(`\\n  ${name} `), name);
  const entries = new Set<string>(Object.values(COMMANDS).flatMap((c) => ("entry" in c ? [c.entry] : [])));
  for (const file of fs.readdirSync(path.join(CLI, "src", "commands"))) {
    const name = file.replace(/\.ts$/, "");
    if (name === "publishing-runner") continue; // the worker the studio starts, not something to type
    assert.ok(entries.has(name), `${file} is not reachable from agentcut`);
  }
});

test("the published CLI is small and carries none of what it downloads", { timeout: 120_000 }, () => {
  execFileSync(process.execPath, [path.join(CLI, "build.mjs")], { stdio: "pipe" });
  const files: string[] = [];
  const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(path.join(dir, e.name)) : files.push(path.join(dir, e.name)); };
  walk(path.join(CLI, "dist"));
  const bytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
  assert.ok(bytes < 3 * 1024 * 1024, `dist is ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  const code = files.filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  for (const heavy of ["@remotion/renderer", "@remotion/bundler", "ffmpeg-static", "ffprobe-static", "next/dist", "react-dom"]) {
    assert.ok(!new RegExp(`(from|require\\()\\s*["']${heavy}`).test(code), `${heavy} is bundled or imported outright`);
  }

  // Run like an installed copy: a package called agentcut, a home of its own.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentcut-cli-home-"));
  const run = (...args: string[]) => spawnSync(process.execPath, [path.join(CLI, "dist", "agentcut.mjs"), ...args], { encoding: "utf8", env: { ...process.env, AGENTCUT_HOME: home, AGENTCUT_ROOT: "", AGENTCUT_WORKSPACE: "" } });
  const version = JSON.parse(fs.readFileSync(path.join(CLI, "package.json"), "utf8")).version;
  assert.equal(run("--version").stdout.trim(), version);
  const listed = run("projects", "list");
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout), []);
  assert.ok(fs.existsSync(path.join(home, "workspace", "agentcut.db")), "an installed CLI keeps its workspace in its home");
  const dry = JSON.parse(run("--dry-run").stdout);
  assert.equal(dry.checkout, false);
  assert.equal(dry.app, path.join(home, "runtime", "studio", version));
  fs.rmSync(home, { recursive: true, force: true });
});
