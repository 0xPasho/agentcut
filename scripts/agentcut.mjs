#!/usr/bin/env node
/**
 * Launcher usable by absolute path from any directory:
 *
 *   node /path/to/agentcut/scripts/agentcut.mjs render <projectId>
 *
 * It finds the app root from its own location, runs the repository's own
 * pnpm script or tsx binary with that root as cwd, and leaves the workspace
 * resolution to src/lib/config.ts (AGENTCUT_WORKSPACE still wins).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "agentcut";
const WIN = process.platform === "win32";

const COMMANDS = {
  dev: { kind: "pnpm", script: "dev", help: "start the Next dev server" },
  start: { kind: "pnpm", script: "start", help: "start the built Next server" },
  edit: { kind: "tsx", entry: "scripts/edit.ts", help: "headless editor: <projectId> [read | call req.json | ask ...]" },
  projects: { kind: "tsx", entry: "scripts/projects.ts", help: 'list | create "Project name" video1.mp4 video2.mp4 ...' },
  render: { kind: "tsx", entry: "scripts/render.ts", help: "render clips: <projectId|edl.json> [--only id,id]" },
};

function findPackageRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    try {
      if (JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))?.name === PACKAGE_NAME) return dir;
    } catch {
      // keep climbing
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** realpath first, so a symlinked launcher still points at the real checkout. */
function appRoot() {
  const self = fileURLToPath(import.meta.url);
  const root = findPackageRoot(path.dirname(fs.realpathSync(self))) ?? findPackageRoot(path.dirname(self));
  if (!root) throw new Error(`cannot locate the ${PACKAGE_NAME} package root from ${self}`);
  return root;
}

function localBin(root, name) {
  const bin = path.join(root, "node_modules", ".bin", WIN ? `${name}.cmd` : name);
  return fs.existsSync(bin) ? bin : undefined;
}

function onPath(name) {
  const exts = WIN ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function plan(command, rest, root, from) {
  const spec = COMMANDS[command];
  const args = rest.map((arg, index) => {
    // Only path positions are rewritten. Instructions and project titles are literal.
    if (command === "projects" && rest[0] === "create" && index >= 2) return path.resolve(from, arg.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
    if ((command === "render" && index === 0 && /\.json$/i.test(arg)) || (command === "edit" && rest[1] === "call" && index === 2)) return path.resolve(from, arg);
    return arg;
  });
  if (spec.kind === "tsx") {
    const tsx = localBin(root, "tsx") ?? onPath("tsx");
    if (!tsx) throw new Error(`tsx not found — run "pnpm install" in ${root}`);
    return { command: tsx, args: [path.join(root, spec.entry), ...args], cwd: root };
  }
  const pnpm = localBin(root, "pnpm") ?? onPath("pnpm");
  if (pnpm) return { command: pnpm, args: ["run", spec.script, ...args], cwd: root };
  const next = localBin(root, "next");
  if (!next) throw new Error(`neither pnpm nor a local next binary found — run "pnpm install" in ${root}`);
  return { command: next, args: [spec.script, ...args], cwd: root };
}

function usage() {
  const lines = Object.entries(COMMANDS).map(([name, spec]) => `  ${name.padEnd(7)} ${spec.help}`);
  return [`usage: agentcut <${Object.keys(COMMANDS).join("|")}> [args…]`, ...lines, "", "  --dry-run   print the resolved command as JSON instead of running it"].join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run") || process.env.AGENTCUT_DRY_RUN === "1";
  const [command, ...rest] = argv.filter(arg => arg !== "--dry-run");

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(usage());
    return;
  }
  if (!Object.hasOwn(COMMANDS, command)) {
    console.error(`unknown command: ${command}\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  const root = appRoot();
  const resolved = plan(command, rest, root, process.cwd());
  const env = { ...process.env, AGENTCUT_ROOT: root, ...(process.env.AGENTCUT_WORKSPACE ? { AGENTCUT_WORKSPACE: path.resolve(process.env.AGENTCUT_WORKSPACE) } : {}) };

  if (dryRun) {
    console.log(JSON.stringify({ ...resolved, root, workspace: env.AGENTCUT_WORKSPACE ? path.resolve(env.AGENTCUT_WORKSPACE) : path.join(root, "workspace") }));
    return;
  }

  const child = spawn(resolved.command, resolved.args, { cwd: resolved.cwd, env, stdio: "inherit", shell: WIN });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
  child.on("error", error => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
