import fs from "node:fs/promises";
import path from "node:path";
import { detectScenes, loudnessCurve, LOUDNESS_STEP_SEC, type Probe } from "../media";

export type Signals = {
  scenes: number[];
  /** Loudness peaks — laughter, applause, raised voice. Seconds. */
  peaks: Array<{ t: number; db: number }>;
};

/** How many peaks travel with a project. Enough to mark every reaction in a long stream. */
const MAX_PEAKS = 400;
/** A run of loud readings closer together than this is one reaction, not several. */
const BURST_GAP_SEC = 1;

/**
 * One entry per loud moment, not one per loud reading.
 *
 * A reaction lasts a second or two, which is several readings, and taking the first
 * 400 that cross the line meant a four-hour stream was described by its opening
 * minutes and nothing else. Readings are grouped into bursts, each burst is reported
 * at its loudest instant, and if there are still more than the cap the quietest
 * bursts go first — so what survives is spread over the whole recording.
 */
export function peaksFromCurve(curve: Array<{ t: number; db: number }>): Array<{ t: number; db: number }> {
  if (!curve.length) return [];
  const sorted = [...curve].sort((a, b) => a.db - b.db);
  const median = sorted[Math.floor(sorted.length / 2)].db;
  const line = median + 6;

  const bursts: Array<{ t: number; db: number; last: number }> = [];
  for (const reading of curve) {
    if (reading.db <= line) continue;
    const open = bursts[bursts.length - 1];
    if (open && reading.t - open.last <= BURST_GAP_SEC + LOUDNESS_STEP_SEC) {
      open.last = reading.t;
      if (reading.db > open.db) { open.db = reading.db; open.t = reading.t; }
    } else {
      bursts.push({ t: reading.t, db: reading.db, last: reading.t });
    }
  }

  return bursts
    .sort((a, b) => b.db - a.db)
    .slice(0, MAX_PEAKS)
    .map(({ t, db }) => ({ t, db }))
    .sort((a, b) => a.t - b.t);
}

/** Everything a transcript can't tell you, computed deterministically once. */
export async function computeSignals(videoPath: string, probe: Probe, onLog?: (text: string) => void): Promise<Signals> {
  // A failure here is a missing signal, not a failed analysis — but it is said out
  // loud, because the way this went wrong before was silently.
  const [scenes, curve] = await Promise.all([
    detectScenes(videoPath).catch((error: Error) => { onLog?.(`scene detection failed, continuing without cuts: ${error.message}`); return [0]; }),
    probe.hasAudio
      ? loudnessCurve(videoPath).catch((error: Error) => { onLog?.(`loudness pass failed, continuing without peaks: ${error.message}`); return []; })
      : Promise.resolve([]),
  ]);

  return { scenes, peaks: peaksFromCurve(curve) };
}

export async function writeSignals(dir: string, s: Signals) {
  await fs.writeFile(path.join(dir, "signals.json"), JSON.stringify(s, null, 2));
}
