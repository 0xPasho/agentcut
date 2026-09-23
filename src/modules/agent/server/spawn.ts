import { spawn } from "node:child_process";
import type { AgentEvent } from "../types";

export type SpawnResult = { stdout: string; stderr: string; code: number | null };

/** Run a CLI, streaming stdout line-by-line to `onLine`. */
export function spawnStream(
  bin: string,
  args: string[],
  opts: {
    cwd: string;
    /**
     * How long the CLI may say nothing at all before it counts as hung. A wall-clock
     * limit killed a working agent: it had asked for a transcription, the host took
     * twenty-one minutes to answer, and the harness was killed a heartbeat before the
     * answer arrived. Silence is the only thing that means stuck, and only while the
     * host owes the agent nothing.
     */
    idleMs?: number;
    /** A ceiling regardless of activity, so a CLI stuck in a loud loop still ends. */
    maxMs?: number;
    /** True while the host is running a tool the agent asked for: it is waiting, not hung. */
    busy?: () => boolean;
    env?: NodeJS.ProcessEnv;
    onLine?: (line: string) => void;
    onStderr?: (chunk: string) => void;
  },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let buf = "";
    let spoke = Date.now();
    const started = Date.now();
    const spell = (ms: number) => ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)}s`;

    /** SIGTERM first so the CLI can write its own last words; SIGKILL if it will not go. */
    const stop = (why: string) => {
      clearInterval(watch);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref?.();
      reject(new Error(`${bin} ${why}${stderr.trim() ? `: ${stderr.trim().slice(-400)}` : ""}`));
    };
    const watch = setInterval(() => {
      if (opts.maxMs && opts.maxMs > 0 && Date.now() - started > opts.maxMs) {
        stop(`ran past its ${spell(opts.maxMs)} limit and was stopped`);
        return;
      }
      if (!opts.idleMs || opts.idleMs <= 0) return;
      // A tool of ours still running is the agent waiting on us, however long it takes.
      if (opts.busy?.()) { spoke = Date.now(); return; }
      if (Date.now() - spoke > opts.idleMs) stop(`said nothing for ${spell(opts.idleMs)} and was stopped`);
    }, Math.max(25, Math.min(5_000, ...[opts.idleMs, opts.maxMs].filter((ms): ms is number => !!ms && ms > 0).map(ms => ms / 4))));
    watch.unref?.();

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      spoke = Date.now();
      if (!opts.onLine) return;
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) opts.onLine(line);
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      spoke = Date.now();
      opts.onStderr?.(chunk);
    });

    child.on("error", (err) => {
      clearInterval(watch);
      reject(err);
    });
    child.on("close", (code) => {
      clearInterval(watch);
      if (buf.trim()) opts.onLine?.(buf);
      resolve({ stdout, stderr, code });
    });
  });
}

export function makeEvent(kind: AgentEvent["kind"], text: string, name?: string): AgentEvent {
  return { kind, text, name, at: Date.now() };
}
