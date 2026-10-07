import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { IS_CHECKOUT, ROOT } from "./root";
import { ensureFfmpeg, runtimeBin } from "./runtime";

const pexec = promisify(execFile);

/**
 * Where ffmpeg comes from: an explicit override, the checkout's vendored
 * `ffmpeg-static` (decision S5), or the copy an installed CLI downloads into its
 * runtime on first use. The require is built at run time so neither the CLI bundle
 * nor the studio's trace drags 380 MB of binaries for every platform along.
 */
function resolveBinary(name: "ffmpeg" | "ffprobe"): string {
  const override = process.env[name === "ffmpeg" ? "AGENTCUT_FFMPEG" : "AGENTCUT_FFPROBE"];
  if (override) return override;
  if (IS_CHECKOUT) {
    try {
      const load = createRequire(path.join(ROOT, "packages", "core", "package.json"));
      return name === "ffmpeg" ? (load("ffmpeg-static") as string) : (load("ffprobe-static") as { path: string }).path;
    } catch {
      // A checkout without its dependencies installed falls through to the runtime copy.
    }
  }
  return runtimeBin(name);
}

export const FFMPEG = resolveBinary("ffmpeg");
export const FFPROBE = resolveBinary("ffprobe");

/** Download ffmpeg and ffprobe if this install has not yet. Every spawn of either goes through here first. */
export async function ensureBinaries() {
  if (FFMPEG === runtimeBin("ffmpeg") || FFPROBE === runtimeBin("ffprobe")) await ensureFfmpeg();
}

export class BinError extends Error {
  constructor(readonly bin: string, readonly code: number | null, readonly stderr: string) {
    super(`${bin} exited ${code}: ${stderr.trim().split("\n").slice(-4).join("\n")}`);
    this.name = "BinError";
  }
}

export async function run(
  bin: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; maxBuffer?: number } = {},
) {
  if (bin === FFMPEG || bin === FFPROBE) await ensureBinaries();
  try {
    const { stdout, stderr } = await pexec(bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 0,
      maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { code?: number; stderr?: string };
    throw new BinError(bin, typeof e.code === "number" ? e.code : null, e.stderr ?? String(err));
  }
}

/** Is a command available on PATH? */
export async function which(bin: string): Promise<string | null> {
  try {
    const { stdout } = await pexec("/usr/bin/which", [bin]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
