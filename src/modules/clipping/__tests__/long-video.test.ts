import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../../../common/server/bin";
import { cleanSegments, keptSeconds, sectionTimeline } from "../lib/section";
import { buildSelectPrompt } from "../lib/prompt";
import { SelectionSpec } from "../types";

/**
 * A five-hour stream and a two-hour video out of it.
 *
 * The arithmetic is the whole risk here, so it is tested without an agent: what happens
 * to stretches that overlap, that run backwards, that sit past the end of the file, or
 * that are two seconds long — and whether what a template asks for actually reaches the
 * prompt and the timeline instead of being overruled by a constant.
 */

let workspace: string;
let database: typeof import("../../../common/server/db");
let selection: typeof import("../server/selection");
let registry: typeof import("../../templates/server/registry");
let store: typeof import("../../editor/server/store");
let select: typeof import("../server/select");

const HORIZONTAL = { width: 1920, height: 1080, fps: 30 };
const PROBE = { width: 1920, height: 1080, fps: 30, durationSec: 5 * 3600, hasAudio: true };

/** One word every half second across a stretch, so a boundary has something to land on. */
function speech(from: number, to: number) {
  const words: Array<{ t: number; d: number; w: string }> = [];
  for (let t = from; t < to; t += 0.5) words.push({ t, d: 0.4, w: "palabra" });
  return words;
}

const TRANSCRIPT = {
  language: "es", engine: "test", segments: [],
  words: [...speech(600, 1800), ...speech(2400, 4200), ...speech(7200, 9000)],
} as never;

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-longvideo-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [database, selection, registry, store, select] = await Promise.all([
    import("../../../common/server/db"), import("../server/selection"),
    import("../../templates/server/registry"), import("../../editor/server/store"), import("../server/select"),
  ]);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

const spec = (over: Record<string, unknown> = {}) =>
  SelectionSpec.parse({ mode: "section", count: 1, minSec: 1200, maxSec: 9000, minSegmentSec: 45, chapters: true, output: HORIZONTAL, ...over });

test("a template says what kind of video it makes, and that is what the run is asked for", async () => {
  const shorts = await selection.resolveSelection({ templateId: "explainer-broll" });
  assert.equal(shorts.spec.mode, "clips");
  assert.ok(shorts.spec.output.height > shorts.spec.output.width, "a short is vertical");

  const long = await selection.resolveSelection({ templateId: "stream-to-youtube" });
  assert.equal(long.spec.mode, "section", "a long-form template asks for one section, not six clips");
  assert.equal(long.spec.count, 1);
  assert.equal(long.spec.output.width, 1920, "and it is cut to the shape the template names");
  assert.ok(long.spec.minSec >= 20 * 60, `a long video is measured in minutes: ${long.spec.minSec}`);
  assert.ok(long.summary.includes("video"), long.summary);

  // No template at all is the old behaviour, unchanged: six vertical clips.
  const bare = await selection.resolveSelection({});
  assert.equal(bare.spec.mode, "clips");
  assert.equal(bare.spec.count, 6);
  assert.equal(bare.spec.minSec, 20);
  assert.equal(bare.spec.maxSec, 75);
  assert.deepEqual(bare.spec.output, { width: 1080, height: 1920, fps: 30 });
});

test("the owner's own numbers win over the template's, and only the ones they gave", async () => {
  const resolved = await selection.resolveSelection({ templateId: "stream-to-youtube", selection: { targetSec: 5400 } });
  assert.equal(resolved.spec.targetSec, 5400, "ninety minutes, because that is what was asked for");
  assert.equal(resolved.spec.mode, "section", "and everything untouched is still the template's");
  assert.equal(resolved.spec.chapters, true);
  assert.ok(resolved.spec.brief.length > 0, "including the direction the template gives the agent");
});

test("a template that extends the long-form one inherits being long-form", async () => {
  const recap = await registry.getTemplate("stream-recap");
  assert.equal(recap.selection.mode, "section", "extends resolves for built-ins too, or this is a bare patch");
  assert.equal(recap.output?.width, 1920);
  assert.equal(recap.selection.targetSec, 20 * 60, "but its own running time");
  assert.equal(recap.captions.preset, "boxed", "and its own captions, where the parent has none");
  assert.equal(recap.audio.targetLufs, -14, "while the parent's loudness carries over");
});

test("the prompt asks for what the template wants, not for a short", () => {
  const section = buildSelectPrompt({ probe: PROBE as never, spec: spec(), userBrief: "", hasFrames: false, chunks: [] });
  assert.ok(/one \*\*publishable\*\* video|one publishable video/.test(section), "it says one video");
  assert.ok(section.includes("video.json"), "and asks for the long-form answer file");
  assert.ok(!/short-form/.test(section), "it never tells a long-form run it is making shorts");
  assert.ok(section.includes("horizontal 16:9"), "the frame is named as it is, not assumed vertical");
  assert.ok(section.includes("Never reorder segments"), "order is the thing a long video cannot lose");

  const clips = buildSelectPrompt({ probe: PROBE as never, spec: SelectionSpec.parse({ output: HORIZONTAL }), userBrief: "", hasFrames: false, chunks: [] });
  assert.ok(clips.includes("clips.json"));
  assert.ok(!clips.includes("webcam somewhere in the corner"), "a 16:9 output has nothing to split into halves");

  const vertical = buildSelectPrompt({ probe: PROBE as never, spec: SelectionSpec.parse({ output: { width: 1080, height: 1920, fps: 30 } }), userBrief: "", hasFrames: false, chunks: [] });
  assert.ok(vertical.includes("webcam somewhere in the corner"), "a vertical output still gets the split guidance");
});

test("the owner's direction is what the run is told to obey", () => {
  const prompt = buildSelectPrompt({
    probe: PROBE as never, spec: spec(), hasFrames: false, chunks: [],
    userBrief: "Las dos horas sobre la migración a Postgres.",
  });
  assert.ok(prompt.includes("Las dos horas sobre la migración a Postgres."));
  assert.ok(prompt.indexOf("wins over any default") < prompt.indexOf("Las dos horas"), "and said to win before it is said");
});

test("stretches that overlap, run backwards or fall off the end are settled, never published twice", () => {
  const cleaned = cleanSegments([
    { start: 4200, end: 3600, title: "backwards", why: "" },
    { start: 600, end: 1800, title: "first", why: "" },
    { start: 1700, end: 2600, title: "overlaps the first", why: "" },
    { start: 2600, end: 2610, title: "ten seconds", why: "" },
    { start: 19000, end: 20000, title: "past the end", why: "" },
  ], { durationSec: 5 * 3600, minSegmentSec: 45 });

  assert.deepEqual(cleaned.map(s => s.title), ["first", "overlaps the first", "backwards"], "kept in the order they happened");
  assert.equal(cleaned.length, 3, `kept: ${cleaned.map(s => s.title).join(", ")}`);
  assert.deepEqual(cleaned.map(s => Math.round(s.start)), [600, 1800, 3600], "each one starts where the last ended");
  for (let i = 1; i < cleaned.length; i++) assert.ok(cleaned[i].start >= cleaned[i - 1].end, "no second is in the video twice");
  assert.ok(cleaned.every(s => s.end <= 5 * 3600), "nothing points past the recording");
  assert.ok(!cleaned.some(s => s.title === "ten seconds"), "a ten-second stretch is not a shot, it is a flicker");
});

test("a long video is published as one timeline of ordered stretches, with chapters", () => {
  const timeline = sectionTimeline({
    title: "La migración a Postgres", summary: "", reason: "", score: 82,
    segments: [
      { start: 700, end: 1700, title: "El problema", why: "donde se plantea" },
      { start: 2500, end: 4100, title: "La migración", why: "el trabajo" },
      { start: 7300, end: 8900, title: "Qué salió mal", why: "el final" },
    ],
    tags: ["postgres"], rules: [],
  }, {
    transcript: TRANSCRIPT, probe: PROBE, output: HORIZONTAL, minSegmentSec: 45,
    chapters: true, mediaId: "original-source", itemId: (i) => `s${i + 1}`,
  });

  assert.equal(timeline.items.length, 3);
  assert.deepEqual(timeline.items.map(i => i.clip.title), ["El problema", "La migración", "Qué salió mal"]);
  for (let i = 1; i < timeline.items.length; i++) {
    assert.ok(timeline.items[i].clip.start > timeline.items[i - 1].clip.end, "the order it happened in is the order it plays in");
  }
  assert.ok(timeline.items.every(i => i.mediaId === "original-source"), "every stretch is cut from the recording, not from nothing");
  assert.ok(timeline.items.every(i => i.clip.words.length > 0), "and carries its own words, so captions and the dead-air pass work on it");
  const crop = timeline.items[0].clip.crop[0];
  assert.deepEqual([crop.x, crop.y, crop.w, crop.h], [0, 0, 1920, 1080], "a 16:9 video out of a 16:9 stream crops nothing");
  assert.deepEqual(timeline.beats.map(b => b.intent), ["El problema", "La migración", "Qué salió mal"]);
  assert.deepEqual(timeline.beats.map(b => b.itemIds[0]), timeline.items.map(i => i.id));
  assert.ok(Math.abs(timeline.keptSec - keptSeconds(timeline.items.map(i => i.clip))) < 0.01);
  assert.ok(timeline.keptSec > 60 * 60, `three of those stretches is an hour of video: ${timeline.keptSec}`);
});

test("an edit far past the length the template asked for is reported, not silently cut short", async () => {
  const dir = path.join(workspace, "run");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "video.json"), JSON.stringify({
    video: {
      title: "Todo el stream", summary: "", reason: "", score: 50, tags: [], rules: [],
      segments: [{ start: 600, end: 1800, title: "Una parte", why: "" }],
    },
  }));
  const edl = await select.buildSection({
    projectId: "long", videoPath: "/tmp/none.mp4", dir,
    probe: PROBE as never, transcript: TRANSCRIPT,
    spec: spec({ minSec: 3600, maxSec: 9000 }),
    signals: { scenes: [], peaks: [] },
  });
  assert.equal(edl.clips.length, 0, "a long video is not a clip proposal");
  assert.equal(edl.sequences.length, 1, "it is a finished timeline");
  assert.equal(edl.sequences[0].title, "Todo el stream");
  assert.deepEqual(edl.output, HORIZONTAL);
  assert.ok(edl.sequences[0].plan.reasons.warnings?.includes("short of"), `the shortfall is said: ${edl.sequences[0].plan.reasons.warnings}`);
  assert.equal(edl.media.length, 1, "with the source it was cut from");
});

test("publishing a long video into a project that already has clips adds to it", async () => {
  const id = "publish-long";
  database.q.upsertProject({ id, name: "Stream", source_path: "/tmp/none.mp4", status: "ready", probe: null });
  const first = store.publishClips(id, {
    version: 1, projectId: id,
    source: { file: "/tmp/none.mp4", width: 1920, height: 1080, fps: 30, durationSec: 18000 },
    output: { width: 1080, height: 1920, fps: 30 },
    clips: [{ id: "short1", title: "Un short", start: 0, end: 30, crop: [], layout: { type: "crop" }, captions: {}, words: [], edits: [], hook: "", reason: "", score: 50, tags: [] }],
    media: [], sequences: [], plan: {},
  } as never);
  assert.equal(first.edl.clips.length, 1);

  const dir = path.join(workspace, "run2");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "video.json"), JSON.stringify({
    video: {
      title: "El video largo", summary: "dos horas", reason: "", score: 70, tags: [], rules: ["r1"],
      segments: [
        { start: 700, end: 1700, title: "Uno", why: "" },
        { start: 2500, end: 4100, title: "Dos", why: "" },
      ],
    },
  }));
  const proposal = await select.buildSection({
    projectId: id, videoPath: "/tmp/none.mp4", dir,
    probe: PROBE as never, transcript: TRANSCRIPT, spec: spec(), signals: { scenes: [], peaks: [] },
  });
  const saved = store.publishClips(id, proposal);

  assert.equal(saved.edl.clips.length, 1, "the clips that were there are still there");
  assert.equal(saved.edl.sequences.length, 1, "and the long video is beside them");
  assert.equal(saved.edl.sequences[0].items.length, 2);
  assert.ok(saved.edl.media.some(m => m.file === "/tmp/none.mp4"), "the source it needs was imported with it");
  const mediaIds = new Set(saved.edl.media.map(m => m.id));
  assert.ok(saved.edl.sequences[0].items.every(i => i.mediaId && mediaIds.has(i.mediaId)), "every shot points at media the project holds");
  const matches = JSON.parse(await fs.readFile(path.join(dir, "rule-matches.json"), "utf8"));
  assert.deepEqual(Object.values(matches), [["r1"]], "the rules judged to hold travel with it, keyed by the video");
});

test("the long-form template edits a long video as a long video, through the shared operations", async () => {
  const id = "apply-long";
  const source = path.join(workspace, "talk.mp4");
  // Twenty seconds of speech-shaped sound with two silent holes in it, so the dead-air
  // pass has something real to find.
  const result = spawnSync(FFMPEG, ["-y",
    "-f", "lavfi", "-i", "color=navy:size=640x360:rate=15:duration=20",
    "-f", "lavfi", "-i", "sine=frequency=220:duration=20",
    "-filter_complex", "[1:a]volume=enable='between(t,4,6)+between(t,12,14)':volume=0[a]",
    "-map", "0:v", "-map", "[a]", "-pix_fmt", "yuv420p", "-shortest", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);

  const probe = { width: 640, height: 360, fps: 15, durationSec: 20, hasAudio: true };
  const transcript = {
    language: "es", engine: "test", segments: [],
    words: [...speech(0, 4), ...speech(6, 12), ...speech(14, 20)],
  } as never;
  const dir = path.join(workspace, "apply-run");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "video.json"), JSON.stringify({
    video: {
      title: "La charla", summary: "", reason: "", score: 60, tags: [], rules: [],
      segments: [{ start: 0, end: 20, title: "Todo", why: "" }],
    },
  }));

  database.q.upsertProject({ id, name: "Long", source_path: source, status: "ready", probe: null });
  const proposal = await select.buildSection({
    projectId: id, videoPath: source, dir, probe: probe as never, transcript,
    spec: spec({ minSec: 10, maxSec: 60, minSegmentSec: 5, output: { width: 1920, height: 1080, fps: 15 } }),
    signals: { scenes: [], peaks: [] },
  });
  const published = store.publishClips(id, proposal);
  const sequenceId = published.edl.sequences[0].id;

  const { applyTemplate } = await import("../../templates/server/apply");
  const applied = await applyTemplate(id, { templateId: "stream-to-youtube", sequenceId }, published.revision);

  const sequence = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!;
  const item = sequence.items.find(i => i.id === proposal.sequences[0].items[0].id)!;
  const kinds = new Set(item.clip.edits.map(e => e.type));
  assert.ok(kinds.has("silence"), `the dead air is cut: ${[...kinds].join(", ") || "nothing"}`);
  assert.ok(!kinds.has("punch"), "a two-hour video does not get a push-in every fifteen seconds");
  assert.ok(!kinds.has("image"), "and no b-roll it never asked for");
  assert.equal(item.clip.captions.preset, "none", "captions stay off, because the platform draws its own");
  assert.equal(sequence.items.filter(i => i.clip.title.includes("Hook")).length, 0);
  assert.equal(applied.applied.images, 0);
  assert.ok(applied.plan.totals.silences + applied.plan.totals.redundancies > 0, "the plan said so before it did it");
  assert.ok(item.volume === undefined || item.volume > 0, "and it is still audible after the loudness pass");
});
