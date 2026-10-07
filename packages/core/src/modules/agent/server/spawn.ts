import { spawn } from "node:child_process";
import { currentJobSignal } from "../../project/server/reaper";
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
    /**
     * Stops the CLI where it stands. Defaults to the signal of the job this spawn is
     * running under, so pressing Stop kills the harness rather than leaving it talking
     * to a model on behalf of somebody who has left.
     */
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
    onLine?: (line: string) => void;
    onStderr?: (chunk: string) => void;
  },
): Promise<SpawnResult> {
  const signal = opts.signal ?? currentJobSignal();
  if (signal?.aborted) return Promise.reject(new Error(`${bin} was stopped before it started`));
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
      done();
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref?.();
      reject(new Error(`${bin} ${why}${stderr.trim() ? `: ${stderr.trim().slice(-400)}` : ""}`));
    };
    const stopped = () => stop("was stopped");
    const done = () => {
      clearInterval(watch);
      signal?.removeEventListener("abort", stopped);
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
    signal?.addEventListener("abort", stopped, { once: true });

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
      done();
      reject(err);
    });
    child.on("close", (code) => {
      done();
      if (buf.trim()) opts.onLine?.(buf);
      resolve({ stdout, stderr, code });
    });
  });
}

export function makeEvent(kind: AgentEvent["kind"], text: string, name?: string): AgentEvent {
  return { kind, text, name, at: Date.now() };
}
