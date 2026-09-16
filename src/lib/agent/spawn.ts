import { spawn } from "node:child_process";
import type { AgentEvent } from "./types";

export type SpawnResult = { stdout: string; stderr: string; code: number | null };

/** Run a CLI, streaming stdout line-by-line to `onLine`. */
export function spawnStream(
  bin: string,
  args: string[],
  opts: {
    cwd: string;
    timeoutMs?: number;
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
    let timer: NodeJS.Timeout | undefined;

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`${bin} timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
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
      opts.onStderr?.(chunk);
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (buf.trim()) opts.onLine?.(buf);
      resolve({ stdout, stderr, code });
    });
  });
}

export function makeEvent(kind: AgentEvent["kind"], text: string, name?: string): AgentEvent {
  return { kind, text, name, at: Date.now() };
}
