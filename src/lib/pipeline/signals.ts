import fs from "node:fs/promises";
import path from "node:path";
import { detectScenes, loudnessCurve, type Probe } from "../media";

export type Signals = {
  scenes: number[];
  /** Loudness peaks — laughter, applause, raised voice. Seconds. */
  peaks: Array<{ t: number; db: number }>;
};

/** Everything a transcript can't tell you, computed deterministically once. */
export async function computeSignals(videoPath: string, probe: Probe): Promise<Signals> {
  const [scenes, curve] = await Promise.all([
    detectScenes(videoPath).catch(() => [0]),
    probe.hasAudio ? loudnessCurve(videoPath).catch(() => []) : Promise.resolve([]),
  ]);

  // Peak = >6dB above the rolling median. Cheap, robust to overall level.
  const sorted = [...curve].sort((a, b) => a.db - b.db);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)].db : -30;
  const peaks = curve.filter((p) => p.db > median + 6).slice(0, 400);

  return { scenes, peaks };
}

export async function writeSignals(dir: string, s: Signals) {
  await fs.writeFile(path.join(dir, "signals.json"), JSON.stringify(s, null, 2));
}
