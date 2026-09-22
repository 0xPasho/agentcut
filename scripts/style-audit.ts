/**
 * Read a finished video back out of its own pixels and check it against what the
 * template said it would be.
 *
 *   tsx scripts/style-audit.ts <projectId> [sequenceId]
 *
 * A template's claims are all checkable against the export, and none of them are
 * checkable by reading the project: that a shot is framed the way the layout says, at
 * the moment the cuts say; that the hook is on screen for the whole body and off the end
 * card; that a word being spoken lights the caption band and a gap does not; that the end
 * card is the card itself and plays whole.
 *
 * Every video must have been rendered — `rendered.json` is what this reads.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "../src/lib/bin";
import { projectDir } from "../src/lib/config";
import { readEditor } from "../src/lib/editor/store";
import { sequenceFrames } from "../src/lib/sequences";
import { buildTimeMap, type TimeMap } from "../src/lib/timeline";
import { regionFilter } from "../src/lib/thumbs";
import type { Word } from "../src/lib/transcript";

function pixels(args: string[]): Buffer {
  const out = spawnSync(FFMPEG, ["-v", "error", ...args], { maxBuffer: 1 << 28 });
  if (out.status !== 0) throw new Error(out.stderr.toString().slice(0, 400));
  return out.stdout;
}

/** One frame, through a filter, at a size two frames can be compared at. */
const frame = (file: string, at: number, filter: string, width: number, height: number) =>
  pixels(["-ss", String(at), "-i", file, "-frames:v", "1", "-vf", `${filter},scale=${width}:${height}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);

const box = (x: number, y: number, w: number, h: number) =>
  `crop=${Math.max(2, Math.round(w))}:${Math.max(2, Math.round(h))}:${Math.max(0, Math.round(x))}:${Math.max(0, Math.round(y))}`;

const meanAbs = (a: Buffer, b: Buffer) => {
  const n = Math.min(a.length, b.length);
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.abs(a[i] - b[i]);
  return n ? total / n : 255;
};
const mean = (b: Buffer) => {
  let total = 0;
  for (let i = 0; i < b.length; i++) total += b[i];
  return b.length ? total / b.length : 0;
};
/** Share of a band that is white: what says "a card is here" rather than "this is bright". */
const whiteShare = (b: Buffer) => {
  let bright = 0;
  for (let i = 0; i + 2 < b.length; i += 3) if (b[i] > 200 && b[i + 1] > 200 && b[i + 2] > 200) bright += 1;
  return b.length ? bright / (b.length / 3) : 0;
};

/** Source seconds → output seconds, and back, across the cuts. */
const outAt = (map: TimeMap, source: number) => {
  for (const span of map.spans) {
    if (source < span.srcStart) return span.outStart;
    if (source <= span.srcEnd) return span.outStart + (source - span.srcStart);
  }
  return map.duration;
};
const sourceAt = (map: TimeMap, out: number, clipStart: number) => {
  for (const span of map.spans) {
    const end = span.outStart + (span.srcEnd - span.srcStart);
    if (out >= span.outStart && out <= end) return clipStart + span.srcStart + (out - span.outStart);
  }
  return clipStart + map.spans[0].srcStart;
};

async function main() {
  const [projectId, only] = process.argv.slice(2);
  if (!projectId) throw new Error("usage: style-audit.ts <projectId> [sequenceId]");
  const edl = readEditor(projectId).edl;
  const manifestPath = path.join(projectDir(projectId), "rendered.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8").catch(() => "{}")) as Record<string, { file: string }>;
  let checks = 0;
  let failed = 0;
  const check = (ok: boolean, line: string) => { checks += 1; if (!ok) failed += 1; console.log(`  ${line} ${ok ? "✓" : "✗"}`); };

  for (const sequence of edl.sequences) {
    if (only && sequence.id !== only) continue;
    const entry = manifest[sequence.id];
    if (!entry) { console.log(`${sequence.id}: not rendered yet`); continue; }
    const file = path.join(projectDir(projectId), "clips", entry.file);
    const { width, height, fps } = sequence.output;
    const resolved = sequenceFrames(sequence);
    const named = (title: string) => resolved.items.find((e) => e.item.clip.title === title);
    const body = resolved.items.find((e) => e.item.mediaId && e.item.clip.title !== "Outro" && e.item.clip.title !== "Intro");
    if (!body) { console.log(`${sequence.id}: no footage to audit`); continue; }
    const outro = named("Outro");
    const hook = named("Hook");
    const item = body.item;
    const media = edl.media.find((m) => m.id === item.mediaId)!;
    const map = buildTimeMap(item.clip);
    const from = body.from / fps;
    const to = (body.from + body.duration) / fps;
    console.log(`${sequence.id} "${item.clip.title}" — ${(resolved.duration / fps).toFixed(2)}s`);

    // The framing, the cuts and the source all at once: rebuild a pane from the footage
    // and compare it with the pane that was exported.
    if (item.clip.layout.type === "split") {
      const layout = item.clip.layout;
      const topHeight = Math.round((height * layout.topPct) / 100);
      const onTop = layout.camera !== "bottom";
      const region = onTop ? layout.top : layout.bottom;
      const pane = { top: onTop ? 0 : topHeight, height: onTop ? topHeight : height - topHeight };
      // A push-in is a zoom the source frame does not have, so the samples avoid them.
      const punches = item.clip.edits.filter((e): e is Extract<typeof e, { type: "punch" }> => e.type === "punch");
      const clear = (at: number) => !punches.some((p) => at >= outAt(map, p.t) - 0.15 && at <= outAt(map, p.t + p.d) + 0.15);
      const samples = [0.2, 0.45, 0.7, 0.9].map((share) => from + (to - from) * share).filter((at) => clear(at) && at > from + 0.3 && at < to - 0.3);
      const diffs = samples.map((at) => meanAbs(
        frame(file, at, box(0, pane.top, width, pane.height), 160, 90),
        frame(media.file, sourceAt(map, at, item.clip.start), regionFilter(region, { width, height: pane.height }), 160, 90),
      ));
      check(diffs.length > 0 && Math.max(...diffs) < 18,
        `the ${onTop ? "top" : "bottom"} pane is the footage framed as the layout says: worst ${diffs.length ? Math.max(...diffs).toFixed(1) : "—"}/255 over ${diffs.length} moments`);
    }

    if (hook) {
      const band = (at: number) => whiteShare(frame(file, at, box(width * 0.2, height * 0.1, width * 0.6, height * 0.03), 60, 10));
      const across = [from + 0.2, (from + to) / 2, to - 0.3].map(band);
      check(across.every((share) => share > 0.5), `the hook card holds across the body: ${across.map((v) => `${Math.round(v * 100)}%`).join(", ")} white`);
      if (outro) check(band(outro.from / fps + 1) < 0.2, "and is off the end card");
    }

    const words: Word[] = item.clip.words;
    if (words.length && item.clip.captions.preset !== "none") {
      const band = (at: number) => mean(frame(file, at, box(width * 0.1, item.clip.captions.positionY * height, width * 0.8, height * 0.07), 60, 10));
      const spoken = words.find((w) => outAt(map, w.t) > from + 1 && outAt(map, w.t) < to - 1);
      let quiet: number | null = null;
      for (let i = 1; i < words.length && quiet === null; i++) {
        const gap = words[i].t - (words[i - 1].t + words[i - 1].d);
        if (gap > 0.25) quiet = outAt(map, words[i - 1].t + words[i - 1].d + gap / 2);
      }
      if (spoken && quiet !== null) {
        const lit = band(outAt(map, spoken.t) + 0.08);
        const dark = band(quiet);
        check(lit > dark + 4, `a word lights the caption band: ${lit.toFixed(0)} on "${spoken.w}" against ${dark.toFixed(0)} in a gap`);
      }
    }

    if (outro) {
      const card = edl.media.find((m) => m.id === outro.item.mediaId);
      if (card) {
        const at = outro.from / fps + Math.min(1.5, outro.duration / fps / 2);
        const diff = meanAbs(
          frame(file, at, box(0, 0, width, height), 120, 200),
          frame(card.file, at - outro.from / fps, regionFilter({ x: 0, y: 0, w: card.width, h: card.height }, { width, height }), 120, 200),
        );
        check(diff < 12, `the end card is the card itself: ${diff.toFixed(1)}/255`);
        check(Math.abs(outro.duration / fps - card.durationSec) < 0.2, `and plays whole: ${(outro.duration / fps).toFixed(2)}s of ${card.durationSec.toFixed(2)}s`);
      }
    }
  }
  console.log(failed ? `\n${failed} of ${checks} checks failed` : `\nall ${checks} checks passed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
