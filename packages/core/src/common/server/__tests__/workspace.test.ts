/**
 * Root and workspace resolution must not depend on process.cwd(): the studio, every CLI
 * command and an installed `agentcut` from any directory have to agree on one workspace.
 * Run with: pnpm --filter @agentcut/core exec tsx --test src/common/server/__tests__/workspace.test.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentcut, REPO } from "../../../modules/__tests__/repo";

const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const CONFIG = path.join(REPO, "packages", "core", "src", "common", "server", "config.ts");

let elsewhere: string;
let alsoElsewhere: string;

before(() => {
  elsewhere = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "agentcut-cwd-a-"));
  alsoElsewhere = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "agentcut-cwd-b-"));
});
after(() => {
  for (const dir of [elsewhere, alsoElsewhere]) fs.rmSync(dir, { recursive: true, force: true });
});

const CLEAN = { AGENTCUT_WORKSPACE: undefined, AGENTCUT_ROOT: undefined, AGENTCUT_HOME: undefined, AGENTCUT_RUNTIME: undefined };
type Seen = { ROOT: string; WORKSPACE: string; DB_PATH: string; IS_CHECKOUT: boolean; HOME: string; ASSETS: string; RUNTIME: string; publishing: { command: string; args: string[] } };

/** Load config.ts in a fresh process with the given cwd and env. */
function config(cwd: string, env: Record<string, string | undefined> = {}): Seen {
  const probe = `import(${JSON.stringify(CONFIG)}).then(m => console.log("::" + JSON.stringify({ ROOT: m.ROOT, WORKSPACE: m.WORKSPACE, DB_PATH: m.DB_PATH, IS_CHECKOUT: m.IS_CHECKOUT, HOME: m.HOME, ASSETS: m.ASSETS, RUNTIME: m.RUNTIME, publishing: m.cliCommand("publishing-runner") })))`;
  const run = spawnSync(TSX, ["-e", probe], { cwd, encoding: "utf8", env: { ...process.env, ...CLEAN, ...env } });
  assert.equal(run.status, 0, run.stderr);
  const line = run.stdout.split("\n").find(l => l.startsWith("::"));
  assert.ok(line, `no probe output: ${run.stdout}${run.stderr}`);
  return JSON.parse(line.slice(2)) as Seen;
}

function launcher(cwd: string, args: string[], env: Record<string, string | undefined> = {}) {
  const [command, argv] = agentcut(...args);
  return spawnSync(command, argv, { cwd, encoding: "utf8", env: { ...process.env, ...CLEAN, ...env } });
}

test("the same workspace resolves from unrelated working directories", () => {
  const fromRepo = config(REPO);
  assert.equal(fromRepo.ROOT, REPO);
  assert.equal(fromRepo.IS_CHECKOUT, true);
  for (const cwd of [elsewhere, alsoElsewhere, path.parse(REPO).root, path.join(REPO, "apps", "studio")]) {
    assert.deepEqual(config(cwd), fromRepo, cwd);
  }
});

test("a checkout keeps its workspace beside the code, and its assets in core", () => {
  const seen = config(elsewhere);
  assert.equal(seen.WORKSPACE, path.join(REPO, "workspace"));
  assert.equal(seen.ASSETS, path.join(REPO, "packages", "core", "assets"));
  assert.ok(fs.existsSync(path.join(seen.ASSETS, "sfx")), "the sound effects travel with core");
  assert.deepEqual(seen.publishing.args.slice(-1), [path.join(REPO, "packages", "cli", "src", "commands", "publishing-runner.ts")]);
});

test("an installed agentcut keeps everything under ~/.agentcut and runs its bundled commands", () => {
  // What `npm i -g agentcut` leaves: a package called agentcut with dist/ and assets/.
  const install = path.join(elsewhere, "lib", "node_modules", "agentcut");
  fs.mkdirSync(install, { recursive: true });
  fs.writeFileSync(path.join(install, "package.json"), JSON.stringify({ name: "agentcut", version: "9.9.9" }));
  const home = path.join(alsoElsewhere, "home");
  const seen = config(alsoElsewhere, { AGENTCUT_ROOT: install, AGENTCUT_HOME: home });
  assert.equal(seen.IS_CHECKOUT, false);
  assert.equal(seen.WORKSPACE, path.join(home, "workspace"));
  assert.equal(seen.RUNTIME, path.join(home, "runtime"));
  assert.equal(seen.ASSETS, path.join(install, "assets"));
  assert.deepEqual(seen.publishing, { command: process.execPath, args: [path.join(install, "dist", "commands", "publishing-runner.mjs")] });
});

test("an absolute AGENTCUT_WORKSPACE overrides the default from any cwd", () => {
  const override = path.join(elsewhere, "custom-workspace");
  const seen = config(alsoElsewhere, { AGENTCUT_WORKSPACE: override });
  assert.equal(seen.ROOT, REPO);
  assert.equal(seen.WORKSPACE, override);
  assert.equal(seen.DB_PATH, path.join(override, "agentcut.db"));
});

test("a relative AGENTCUT_WORKSPACE still resolves against the caller's cwd", () => {
  const seen = config(elsewhere, { AGENTCUT_WORKSPACE: "relative-ws" });
  assert.equal(seen.WORKSPACE, path.join(elsewhere, "relative-ws"));
});

test("AGENTCUT_ROOT relocates the root for runtimes that cannot report a module path", () => {
  const seen = config(REPO, { AGENTCUT_ROOT: elsewhere });
  assert.equal(seen.ROOT, elsewhere);
  assert.equal(seen.WORKSPACE, path.join(elsewhere, "workspace"));
});

test("the launcher runs commands with the checkout as cwd", () => {
  for (const command of ["edit", "render", "projects", "mcp"]) {
    const run = launcher(elsewhere, [command, "--dry-run"]);
    assert.equal(run.status, 0, run.stderr);
    const seen = JSON.parse(run.stdout);
    assert.equal(seen.root, REPO, command);
    assert.equal(seen.cwd, REPO, command);
    assert.equal(seen.checkout, true, command);
    assert.equal(seen.workspace, path.join(REPO, "workspace"), command);
    assert.equal(seen.command, process.execPath);
    assert.equal(seen.args[2], path.join(REPO, "packages", "cli", "src", "commands", `${command}.ts`));
  }
  for (const command of ["dev", "start", "studio"]) {
    const run = launcher(elsewhere, [command, "--dry-run"]);
    assert.equal(run.status, 0, run.stderr);
    const seen = JSON.parse(run.stdout);
    assert.equal(seen.app, path.join(REPO, "apps", "studio"), command);
    assert.equal(seen.mode, command);
  }
});

test("with no command, or only studio flags, agentcut opens the studio", () => {
  for (const args of [["--dry-run"], ["--port", "8123", "--dry-run"], ["--no-open", "--dry-run"]]) {
    const run = launcher(elsewhere, args);
    assert.equal(run.status, 0, run.stderr);
    const seen = JSON.parse(run.stdout);
    assert.equal(seen.mode, "studio", args.join(" "));
    if (args[0] === "--port") assert.equal(seen.port, 8123);
    if (args[0] === "--no-open") assert.equal(seen.open, false);
  }
});

test("the launcher absolutizes caller-relative file arguments but not ids or flags", () => {
  fs.writeFileSync(path.join(elsewhere, "edl.json"), "{}");
  const run = launcher(elsewhere, ["render", "./edl.json", "--only", "one,two", "--dry-run"]);
  assert.equal(run.status, 0, run.stderr);
  const { args } = JSON.parse(run.stdout);
  assert.deepEqual(args.slice(3), [path.join(elsewhere, "edl.json"), "--only", "one,two"]);
  assert.deepEqual(JSON.parse(launcher(elsewhere, ["render", "proj_1", "--dry-run"]).stdout).args.slice(3), ["proj_1"]);
  assert.deepEqual(JSON.parse(launcher(elsewhere, ["packs", "publish", "./my-pack", "--dry-run"]).stdout).args.slice(3), ["publish", path.join(elsewhere, "my-pack")]);
});

test("an unknown command fails with usage instead of launching anything", () => {
  const run = launcher(elsewhere, ["nope"]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /unknown command: nope/);
  assert.match(run.stderr, /usage: agentcut \[command\]/);
  assert.match(run.stderr, /\n {2}runtime /);
});

test("the launcher really executes the command from a foreign cwd", () => {
  const workspace = path.join(alsoElsewhere, "spawned-workspace");
  const run = launcher(alsoElsewhere, ["edit"], { AGENTCUT_WORKSPACE: workspace });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /usage: agentcut edit/);
  assert.ok(fs.existsSync(workspace), "the override workspace should have been created by the child");
});

test("project creation paths use the caller directory and keep project names literal", () => {
  const run = launcher(elsewhere, ["projects", "create", "My / film", "one.mp4", "./two.mp4", "--dry-run"]);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).args.slice(3), ["create", "My / film", path.join(elsewhere, "one.mp4"), path.join(elsewhere, "two.mp4")]);
});

test("relative workspace overrides resolve before the launcher changes directories", () => {
  const run = launcher(elsewhere, ["projects", "list"], { AGENTCUT_WORKSPACE: "relative-launch-workspace" });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(path.join(elsewhere, "relative-launch-workspace", "agentcut.db")));
});

test("the version and the runtime are reported without starting anything", () => {
  const version = launcher(elsewhere, ["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), JSON.parse(fs.readFileSync(path.join(REPO, "packages", "cli", "package.json"), "utf8")).version);
  const runtime = launcher(elsewhere, ["runtime", "status", "--json"], { AGENTCUT_HOME: path.join(elsewhere, "home") });
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.deepEqual(JSON.parse(runtime.stdout).map((s: { component: string }) => s.component), ["ffmpeg", "render", "studio"]);
});
