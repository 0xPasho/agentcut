import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "../bin";
import { projectDir } from "../config";
import { readEditor } from "./store";
import { sequenceFrames } from "../sequences";
import { buildTimeMap, lineAt, mapWords, toLines, type TimeMap } from "../timeline";
import { regionFilter } from "../thumbs";
import type { Word } from "../transcript";

/**
 * Read a finished video back out of its own pixels and check it against what the
 * template said it would be.
 *
 * Everything a template promises is visible in the export and invisible in the project:
 * a pane framed where the layout says at the moment the cuts say, a hook that holds
 * across the body and is off the end card, a caption band that lights on a word and not
 * in a gap, an end card that is the card and plays whole. The checks read each video's
 * own template rather than one look, so they answer for a second channel's template as
 * well as for the one they were written against.
 */
export type StyleCheck = { name: string; ok: boolean; detail: string };
export type StyleAudit = {
  sequenceId: string;
  title: string;
  /** Empty when the video has been rendered; otherwise why nothing could be checked. */
  skipped?: string;
  /** Set when the project moved on after the export: a reason to render before believing it. */
  stale?: string;
  checks: StyleCheck[];
};

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

/** Every rendered video in a project, or one of them, read back out of its pixels. */
export async function auditStyle(projectId: string, only?: string): Promise<StyleAudit[]> {
  const snapshot = readEditor(projectId);
  const edl = snapshot.edl;
  const manifestPath = path.join(projectDir(projectId), "rendered.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8").catch(() => "{}")) as Record<string, { file: string; revision?: number }>;
  const audits: StyleAudit[] = [];

  for (const sequence of edl.sequences) {
    if (only && sequence.id !== only) continue;
    const entry = manifest[sequence.id];
    const checks: StyleCheck[] = [];
    const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
    if (!entry) { audits.push({ sequenceId: sequence.id, title: sequence.title, skipped: "not rendered yet", checks }); continue; }
    const file = path.join(projectDir(projectId), "clips", entry.file);
    const { width, height, fps } = sequence.output;
    const resolved = sequenceFrames(sequence);
    const named = (title: string) => resolved.items.find((e) => e.item.clip.title === title);
    const body = resolved.items.find((e) => e.item.mediaId && e.item.clip.title !== "Outro" && e.item.clip.title !== "Intro");
    if (!body) { audits.push({ sequenceId: sequence.id, title: sequence.title, skipped: "no footage to audit", checks }); continue; }
    const outro = named("Outro");
    const hook = named("Hook");
    const item = body.item;
    const media = edl.media.find((m) => m.id === item.mediaId)!;
    const map = buildTimeMap(item.clip);
    const from = body.from / fps;
    const to = (body.from + body.duration) / fps;
    // The revision counts the whole project, so this is a "look here first" and not a
    // verdict: editing another video in the same project moves it too.
    const stale = entry.revision !== undefined && entry.revision !== snapshot.revision
      ? `exported at revision ${entry.revision}, the project is at ${snapshot.revision}`
      : undefined;

    /** Which half of a split a row belongs to, and what that half is a picture of. */
    const paneAt = (y: number) => {
      if (item.clip.layout.type !== "split") return null;
      const layout = item.clip.layout;
      const topHeight = Math.round((height * layout.topPct) / 100);
      return y < topHeight
        ? { region: layout.top, top: 0, height: topHeight }
        : { region: layout.bottom, top: topHeight, height: height - topHeight };
    };
    /**
     * How much of a band the render draws that the footage does not have. A band is read
     * against the half it is actually in: a hook in the middle of the frame of a
     * camera-on-top video sits in the screen's half, and comparing it with the other half
     * says a difference that is only the two halves being different.
     */
    const drawnOver = (at: number, y: number, bandHeight: number) => {
      const pane = paneAt(y);
      if (!pane || y + bandHeight > pane.top + pane.height) return null;
      const rendered = frame(file, at, box(width * 0.1, y, width * 0.8, bandHeight), 80, 12);
      const expected = pixels(["-ss", String(sourceAt(map, at, item.clip.start)), "-i", media.file, "-frames:v", "1",
        "-vf", `${regionFilter(pane.region, { width, height: pane.height })},${box(width * 0.1, y - pane.top, width * 0.8, bandHeight)},scale=80:12`,
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
      return meanAbs(rendered, expected);
    };

    if (item.clip.layout.type === "split") {
      const layout = item.clip.layout;
      const topHeight = Math.round((height * layout.topPct) / 100);
      const onTop = layout.camera !== "bottom";
      const region = onTop ? layout.top : layout.bottom;
      const pane = { top: onTop ? 0 : topHeight, height: onTop ? topHeight : height - topHeight };
      const punches = item.clip.edits.filter((e): e is Extract<typeof e, { type: "punch" }> => e.type === "punch");
      const clear = (at: number) => !punches.some((p) => at >= outAt(map, p.t) - 0.15 && at <= outAt(map, p.t + p.d) + 0.15);
      const samples = [0.2, 0.45, 0.7, 0.9].map((share) => from + (to - from) * share).filter((at) => clear(at) && at > from + 0.3 && at < to - 0.3);
      const diffs = samples.map((at) => meanAbs(
        frame(file, at, box(0, pane.top, width, pane.height), 160, 90),
        frame(media.file, sourceAt(map, at, item.clip.start), regionFilter(region, { width, height: pane.height }), 160, 90),
      ));
      check("framing", diffs.length > 0 && Math.max(...diffs) < 18,
        `the ${onTop ? "top" : "bottom"} pane is the footage framed as the layout says: worst ${diffs.length ? Math.max(...diffs).toFixed(1) : "—"}/255 over ${diffs.length} moments`);
    }

    if (hook) {
      const hookFrom = hook.from / fps;
      const hookTo = (hook.from + hook.duration) / fps;
      const placed = hook.item.clip.edits.find((e): e is Extract<typeof e, { type: "text" }> => e.type === "text");
      const y = placed?.position === "center" ? height * 0.42 : placed?.position === "bottom" ? height * 0.76 : height * 0.08;
      const bandHeight = height * 0.1;
      const band = (at: number) => drawnOver(at, y, bandHeight);
      const share = (at: number) => whiteShare(frame(file, at, box(width * 0.2, y + bandHeight * 0.2, width * 0.6, bandHeight * 0.3), 60, 10));
      const present = (at: number) => { const over = band(at); return over === null ? share(at) > 0.4 : over > 20; };
      const sticky = hookTo - hookFrom > (to - from) * 0.9;
      if (sticky) {
        const seen = [from + 0.2, (from + to) / 2, to - 0.3].map((at) => ({ at, over: band(at) }));
        check("hook", seen.every((s) => (s.over === null ? share(s.at) > 0.4 : s.over > 20)),
          `the hook holds across the body: ${seen.map((s) => (s.over === null ? "white" : `${s.over.toFixed(0)}/255 over the footage`)).join(", ")}`);
      } else {
        const middle = (hookFrom + hookTo) / 2;
        const after = Math.min(to - 0.3, hookTo + 1.5);
        check("hook", present(middle), `the opening hook is on screen at ${middle.toFixed(1)}s, for the ${(hookTo - hookFrom).toFixed(1)}s the template gives it`);
        if (after > hookTo + 0.5) check("hook ends", !present(after), `and is gone by ${after.toFixed(1)}s`);
      }
      if (outro) check("hook off the card", share(outro.from / fps + 1) < 0.2, "the hook is off the end card");
    }

    const words: Word[] = item.clip.words;
    if (words.length && item.clip.captions.preset !== "none") {
      const band = (at: number) => mean(frame(file, at, box(width * 0.1, item.clip.captions.positionY * height, width * 0.8, height * 0.07), 60, 10));
      const spoken = words
        .filter((w) => outAt(map, w.t) > from + 1 && outAt(map, w.t) < to - 1)
        .sort((a, b) => b.w.length - a.w.length)[0];
      const lines = toLines(mapWords(map, words), item.clip.captions.maxWordsPerLine);
      let quiet: number | null = null;
      for (let at = from + 0.5; at < to - 0.5 && quiet === null; at += 0.1) {
        if (!lineAt(lines, at - from)) quiet = at;
      }
      if (spoken && quiet !== null) {
        const top = item.clip.captions.positionY * height;
        const bandHeight = height * 0.07;
        const litOver = drawnOver(outAt(map, spoken.t) + 0.08, top, bandHeight);
        const darkOver = drawnOver(quiet, top, bandHeight);
        if (litOver !== null && darkOver !== null) {
          check("captions", litOver > darkOver + 5 && litOver > 8,
            `a word is drawn into the caption band: ${litOver.toFixed(0)}/255 over the footage on "${spoken.w}" against ${darkOver.toFixed(0)} in a gap`);
        } else {
          const lit = band(outAt(map, spoken.t) + 0.08);
          const dark = band(quiet);
          check("captions", lit > dark + 4, `a word lights the caption band: ${lit.toFixed(0)} on "${spoken.w}" against ${dark.toFixed(0)} in a gap`);
        }
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
        check("end card", diff < 12, `the end card is the card itself: ${diff.toFixed(1)}/255`);
        check("end card length", Math.abs(outro.duration / fps - card.durationSec) < 0.2,
          `it plays whole: ${(outro.duration / fps).toFixed(2)}s of ${card.durationSec.toFixed(2)}s`);
      }
    }
    audits.push({ sequenceId: sequence.id, title: sequence.title, ...(stale ? { stale } : {}), checks });
  }
  return audits;
}
