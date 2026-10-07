#!/usr/bin/env node
/**
 * The old absolute-path launcher, kept so anything that runs
 * `node /path/to/agentcut/scripts/agentcut.mjs …` keeps working. The CLI lives in
 * packages/cli now; this runs it from source, exactly as `pnpm agentcut` does.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, ["--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), path.join(root, "packages/cli/src/bin.ts"), ...process.argv.slice(2)], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
