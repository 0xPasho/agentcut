/**
 * Root and workspace resolution must not depend on process.cwd(): the dev
 * server, `tsx scripts/*.ts` and the absolute-path launcher all have to agree
 * on one workspace. Run with: tsx --test tests/workspace.test.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Derived from this file's location, independent of the module under test. */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const LAUNCHER = path.join(REPO, "scripts", "agentcut.mjs");
const CONFIG = path.join(REPO, "src", "lib", "config.ts");

let elsewhere: string;
let alsoElsewhere: string;

before(() => {
  elsewhere = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "agentcut-cwd-a-"));
  alsoElsewhere = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "agentcut-cwd-b-"));
});
after(() => {
  for (const dir of [elsewhere, alsoElsewhere]) fs.rmSync(dir, { recursive: true, force: true });
});

/** Load src/lib/config in a fresh process with the given cwd and env. */
function config(cwd: string, env: Record<string, string | undefined> = {}) {
  const probe = `import(${JSON.stringify(CONFIG)}).then(m => console.log("::" + JSON.stringify({ ROOT: m.ROOT, WORKSPACE: m.WORKSPACE, DB_PATH: m.DB_PATH })))`;
  const run = spawnSync(TSX, ["-e", probe], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, AGENTCUT_WORKSPACE: undefined, AGENTCUT_ROOT: undefined, ...env },
  });
  assert.equal(run.status, 0, run.stderr);
  const line = run.stdout.split("\n").find(l => l.startsWith("::"));
  assert.ok(line, `no probe output: ${run.stdout}${run.stderr}`);
  return JSON.parse(line.slice(2)) as { ROOT: string; WORKSPACE: string; DB_PATH: string };
}

function launcher(cwd: string, args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [LAUNCHER, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, AGENTCUT_WORKSPACE: undefined, AGENTCUT_ROOT: undefined, ...env },
  });
}

test("the same workspace resolves from unrelated working directories", () => {
  const fromRepo = config(REPO);
  const fromTmp = config(elsewhere);
  const fromOtherTmp = config(alsoElsewhere);
  const fromRootDir = config(path.parse(REPO).root);

  assert.equal(fromRepo.ROOT, REPO);
  for (const seen of [fromTmp, fromOtherTmp, fromRootDir]) {
    assert.deepEqual(seen, fromRepo);
  }
});

test("the default workspace stays the repository workspace directory", () => {
  assert.equal(config(elsewhere).WORKSPACE, path.join(REPO, "workspace"));
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

test("the launcher runs repository commands with the app root as cwd", () => {
  for (const command of ["dev", "start", "edit", "render"]) {
    const run = launcher(elsewhere, [command, "--dry-run"]);
    assert.equal(run.status, 0, run.stderr);
    const seen = JSON.parse(run.stdout);
    assert.equal(seen.root, REPO, command);
    assert.equal(seen.cwd, REPO, command);
    assert.equal(seen.workspace, path.join(REPO, "workspace"), command);
    assert.ok(path.isAbsolute(seen.command), `${command}: ${seen.command}`);
    if (command === "edit" || command === "render") {
      assert.equal(seen.command, path.join(REPO, "node_modules", ".bin", "tsx"));
      assert.equal(seen.args[0], path.join(REPO, "scripts", `${command}.ts`));
    } else {
      assert.ok(seen.args.includes(command), `${command}: ${JSON.stringify(seen.args)}`);
    }
  }
});

test("the launcher absolutizes caller-relative file arguments but not ids or flags", () => {
  fs.writeFileSync(path.join(elsewhere, "edl.json"), "{}");
  const run = launcher(elsewhere, ["render", "./edl.json", "--only", "one,two", "--dry-run"]);
  assert.equal(run.status, 0, run.stderr);

  const { args } = JSON.parse(run.stdout);
  assert.deepEqual(args.slice(1), [path.join(elsewhere, "edl.json"), "--only", "one,two"]);
  assert.deepEqual(JSON.parse(launcher(elsewhere, ["render", "proj_1", "--dry-run"]).stdout).args.slice(1), ["proj_1"]);
});

test("an unknown command fails with usage instead of launching anything", () => {
  const run = launcher(elsewhere, ["nope"]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /unknown command: nope/);
  assert.match(run.stderr, /dev\|start\|edit\|projects\|render/);
});

test("the launcher really executes the repository script from a foreign cwd", () => {
  const workspace = path.join(alsoElsewhere, "spawned-workspace");
  const run = launcher(alsoElsewhere, ["edit"], { AGENTCUT_WORKSPACE: workspace });

  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /usage: tsx scripts\/edit\.ts/);
  assert.ok(fs.existsSync(workspace), "the override workspace should have been created by the child");
});


test("project creation paths use the caller directory and keep project names literal", () => {
  const run = launcher(elsewhere, ["projects", "create", "My / film", "one.mp4", "./two.mp4", "--dry-run"]);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).args.slice(1), ["create", "My / film", path.join(elsewhere, "one.mp4"), path.join(elsewhere, "two.mp4")]);
});

test("relative workspace overrides resolve before the launcher changes directories", () => {
  const run = launcher(elsewhere, ["projects", "list"], { AGENTCUT_WORKSPACE: "relative-launch-workspace" });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(path.join(elsewhere, "relative-launch-workspace", "agentcut.db")));
});
