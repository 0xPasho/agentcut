/**
 * Opening the studio. In a checkout that is the Next dev server, as `pnpm dev` always
 * was. Installed, it is the release's standalone server, fetched into the runtime the
 * first time and started from there with this CLI's own root, version and workspace,
 * so the studio and the terminal always edit the same projects.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { cliCommand, ensureWorkspace, HOME, IS_CHECKOUT, ROOT, RUNTIME, WORKSPACE } from "@agentcut/core/common/server/config";
import { ensureFfmpeg, ensureStudio, VERSION } from "@agentcut/core/common/server/runtime";

const DEFAULT_PORT = 7927;
const WIN = process.platform === "win32";

function option(rest: string[], name: string) {
  const i = rest.indexOf(`--${name}`);
  if (i !== -1) return rest[i + 1];
  return rest.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

function portFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

/** An AgentCut studio already listening there: open it instead of starting a second one. */
async function isStudio(port: number) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspace`, { signal: AbortSignal.timeout(1500) });
    return res.headers.get("x-agentcut") === "studio";
  } catch {
    return false;
  }
}

async function choosePort(wanted: number): Promise<{ port: number; running: boolean }> {
  for (let port = wanted; port < wanted + 20; port++) {
    if (await portFree(port)) return { port, running: false };
    if (await isStudio(port)) return { port, running: true };
  }
  throw new Error(`Ports ${wanted}–${wanted + 19} are all taken. Pass --port.`);
}

function openBrowser(url: string) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : WIN ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {}); // no browser here (a server, a container): the URL is printed anyway
  child.unref();
}

async function waitUntilUp(url: string, child: ChildProcess) {
  let exited = false;
  child.once("exit", () => { exited = true; });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !exited) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** The publishing worker the studio's calendar relies on, as the old launcher started it beside the server. */
function startPublishingWorker(env: NodeJS.ProcessEnv) {
  const { command, args } = cliCommand("publishing-runner");
  // A first run has no workspace yet, and a missing cwd is a spawn that never starts.
  ensureWorkspace();
  const worker = spawn(command, args, { cwd: WORKSPACE, env, stdio: "ignore", detached: true });
  worker.on("error", () => console.error("Publishing worker could not start. Run agentcut publishing tick."));
  worker.unref();
}

type Plan = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; url: string; port: number };

async function plan(mode: "studio" | "dev" | "start", port: number): Promise<Plan> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTCUT_ROOT: ROOT,
    AGENTCUT_VERSION: VERSION,
    AGENTCUT_WORKSPACE: WORKSPACE,
    AGENTCUT_HOME: HOME,
    AGENTCUT_RUNTIME: RUNTIME,
    PORT: String(port),
  };
  const url = `http://localhost:${port}`;
  if (IS_CHECKOUT) {
    const app = path.join(ROOT, "apps", "studio");
    const next = path.join(app, "node_modules", ".bin", WIN ? "next.cmd" : "next");
    if (!fs.existsSync(next)) throw new Error(`next not found — run "pnpm install" in ${ROOT}`);
    return { command: next, args: [mode === "start" ? "start" : "dev", "-p", String(port)], cwd: app, env, url, port };
  }
  if (mode !== "studio") throw new Error(`agentcut ${mode} runs from a source checkout. Installed, use agentcut studio.`);
  await ensureFfmpeg();
  const dir = await ensureStudio();
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { agentcut?: { server?: string } };
  const server = path.join(dir, manifest.agentcut?.server ?? "server.js");
  return {
    command: process.execPath, args: [server], cwd: path.dirname(server),
    env: { ...env, NODE_ENV: "production", HOSTNAME: "127.0.0.1" }, url, port,
  };
}

export async function studio(mode: "studio" | "dev" | "start", rest: string[], { dryRun }: { dryRun: boolean }) {
  const wanted = Number(option(rest, "port") ?? process.env.AGENTCUT_PORT ?? DEFAULT_PORT);
  const open = !rest.includes("--no-open") && process.env.AGENTCUT_NO_OPEN !== "1";

  if (dryRun) {
    const env = IS_CHECKOUT ? null : "downloaded on first run";
    const app = IS_CHECKOUT ? path.join(ROOT, "apps", "studio") : path.join(RUNTIME, "studio", VERSION);
    console.log(JSON.stringify({ mode, checkout: IS_CHECKOUT, root: ROOT, workspace: WORKSPACE, app, port: wanted, open, studio: env }));
    return;
  }

  const { port, running } = await choosePort(wanted);
  if (running) {
    console.log(`The studio is already running → http://localhost:${port}`);
    if (open) openBrowser(`http://localhost:${port}`);
    return;
  }

  console.error(`AgentCut ${VERSION}${IS_CHECKOUT ? " (checkout)" : ""}`);
  const resolved = await plan(mode, port);
  startPublishingWorker(resolved.env);
  const child = spawn(resolved.command, resolved.args, { cwd: resolved.cwd, env: resolved.env, stdio: IS_CHECKOUT ? "inherit" : ["ignore", "pipe", "pipe"], shell: WIN });
  // Installed, the server's own log stays quiet unless something goes wrong.
  let log = "";
  child.stdout?.on("data", (d) => { log = (log + d).slice(-8000); });
  child.stderr?.on("data", (d) => { log = (log + d).slice(-8000); if (process.env.AGENTCUT_DEBUG) process.stderr.write(d); });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => {
    if (code && !IS_CHECKOUT) console.error(`\nThe studio stopped (exit ${code}).\n${log.trim().split("\n").slice(-20).join("\n")}`);
    process.exitCode = signal ? 0 : (code ?? 0);
  });

  if (await waitUntilUp(resolved.url, child)) {
    console.error(`\n  Studio  → ${resolved.url}\n  Workspace ${WORKSPACE}\n\n  Ctrl+C to stop.\n`);
    if (open) openBrowser(resolved.url);
  }
}
