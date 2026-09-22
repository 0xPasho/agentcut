import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const pexec = promisify(execFile);

export const FFMPEG = ffmpegStatic as unknown as string;
export const FFPROBE = ffprobeStatic.path;

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
