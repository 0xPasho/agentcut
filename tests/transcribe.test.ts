import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { frameLevels, readWavMono, rebaseOntoSource, refineWordTimes, speechRuns } from "../src/lib/transcribe/align";
import { applyCorrections, retimeWords, suspectSegments } from "../src/lib/transcribe/polish";
import { activeWordIndex, lineAt, toLines, visibleWords } from "../src/lib/timeline";
import { Transcript, type Word } from "../src/lib/transcript";

const word = (w: string, t: number, d: number, p?: number): Word => ({ w, t, d, ...(p === undefined ? {} : { p }) });

/** Silence, 1s of tone from 1.0s, silence, 1s of tone from 3.0s. */
function toneSamples(sampleRate = 16000): Int16Array {
  const pcm = new Int16Array(sampleRate * 4);
  for (const start of [1, 3]) {
    for (let i = 0; i < sampleRate; i++) {
      const n = start * sampleRate + i;
      pcm[n] = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 12000);
    }
  }
  return pcm;
}

test("speech runs follow the audio, not the clock", () => {
  const runs = speechRuns(frameLevels(toneSamples(), 16000));
  assert.equal(runs.length, 2);
  assert.ok(Math.abs(runs[0].start - 1) < 0.05, `first run starts at ${runs[0].start}`);
  assert.ok(Math.abs(runs[0].end - 2) < 0.05, `first run ends at ${runs[0].end}`);
  assert.ok(Math.abs(runs[1].start - 3) < 0.05, `second run starts at ${runs[1].start}`);
});

test("a word guessed early in the silence snaps to the onset", () => {
  const runs = [{ start: 1, end: 2 }, { start: 3, end: 4 }];
  const [first] = refineWordTimes([word("hola", 0.82, 0.4)], runs);
  assert.equal(first.t, 1);
});

test("a word guessed late inside a run snaps back to the onset", () => {
  const runs = [{ start: 1, end: 2 }];
  const [first] = refineWordTimes([word("hola", 1.12, 0.3)], runs);
  assert.equal(first.t, 1);
});

test("words inside continuous speech keep the recogniser's timing", () => {
  const runs = [{ start: 1, end: 4 }];
  const words = [word("uno", 1.0, 0.4), word("dos", 1.5, 0.4), word("tres", 2.4, 0.5)];
  const refined = refineWordTimes(words, runs);
  assert.deepEqual(refined.map((w) => w.t), [1.0, 1.5, 2.4]);
});

test("a highlight never runs past the end of its own speech run", () => {
  const runs = [{ start: 1, end: 2 }, { start: 3, end: 4 }];
  // Whisper often ends the last word of a phrase where the next one starts.
  const refined = refineWordTimes([word("final", 1.6, 1.5), word("siguiente", 3.0, 0.4)], runs);
  assert.ok(refined[0].t + refined[0].d <= 2.01, `ends at ${refined[0].t + refined[0].d}`);
});

test("refined word times stay ordered and positive", () => {
  const runs = [{ start: 1, end: 2 }];
  const refined = refineWordTimes([word("a", 1.05, 0.3), word("b", 1.04, 0.3), word("c", 1.9, 0.3)], runs);
  for (let i = 1; i < refined.length; i++) assert.ok(refined[i].t > refined[i - 1].t);
  for (const w of refined) assert.ok(w.d > 0);
});

test("VAD words come back onto the source's clock, not the decoded audio's", () => {
  // Whisper decoded speech-only audio: its words start at 0, but this segment is
  // really 100s into the source, after 100s of silence VAD removed.
  const seg = { start: 100, end: 102 };
  const runs = [{ start: 100, end: 102 }];
  const words = [word("uno", 0, 0.5), word("dos", 0.5, 0.5), word("tres", 1.0, 1.0)];
  const rebased = rebaseOntoSource(words, seg, runs);
  assert.deepEqual(rebased.map((w) => Number(w.t.toFixed(2))), [100, 100.5, 101]);
  assert.ok(rebased.every((w) => w.t >= seg.start && w.t + w.d <= seg.end + 0.01));
});

test("silence removed inside a segment is put back between its words", () => {
  // 1s of speech, a 4s pause, 1s more — the decoder saw the two seconds back to back.
  const seg = { start: 10, end: 16 };
  const runs = [{ start: 10, end: 11 }, { start: 15, end: 16 }];
  const rebased = rebaseOntoSource([word("antes", 0, 1), word("después", 1, 1)], seg, runs);
  assert.ok(Math.abs(rebased[0].t - 10) < 0.01, `first at ${rebased[0].t}`);
  assert.ok(Math.abs(rebased[1].t - 15) < 0.01, `second at ${rebased[1].t}`);
});

test("words already on the source's clock are left alone", () => {
  const words = [word("uno", 10.02, 0.5), word("dos", 10.6, 0.5)];
  assert.deepEqual(rebaseOntoSource(words, { start: 10, end: 11.2 }, [{ start: 10, end: 11.2 }]), words);
});

test("word confidence survives a round trip through the schema", () => {
  const parsed = Transcript.parse({ segments: [], words: [{ t: 0, d: 0.2, w: "hola", p: 0.31 }] });
  assert.equal(parsed.words[0].p, 0.31);
  // Older transcripts have no confidence at all, and must still parse.
  assert.equal(Transcript.parse({ segments: [], words: [{ t: 0, d: 0.2, w: "hola" }] }).words[0].p, undefined);
});

test("a 16kHz mono wav reads back as PCM", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-wav-"));
  const file = path.join(dir, "a.wav");
  const pcm = toneSamples();
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length * 2, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length * 2, 40);
  const body = Buffer.alloc(pcm.length * 2);
  pcm.forEach((s, i) => body.writeInt16LE(s, i * 2));
  await fs.writeFile(file, Buffer.concat([header, body]));

  const read = await readWavMono(file);
  assert.ok(read);
  assert.equal(read.sampleRate, 16000);
  assert.equal(read.pcm.length, pcm.length);
  await fs.rm(dir, { recursive: true, force: true });
});

test("the lit word is the one being spoken, with no dark gap between words", () => {
  const words = [word("uno", 0, 0.3), word("dos", 0.5, 0.3), word("tres", 1.0, 0.4)];
  assert.equal(activeWordIndex(words, 0.1), 0);
  // 0.4s falls in the gap after "uno" ends: it stays lit until "dos" starts.
  assert.equal(activeWordIndex(words, 0.4), 0);
  assert.equal(activeWordIndex(words, 0.5), 1);
  assert.equal(activeWordIndex(words, 1.2), 2);
  // Long after the last word, nothing is lit.
  assert.equal(activeWordIndex(words, 3), -1);
  assert.equal(activeWordIndex(words, -0.2), -1);
});

test("the line on screen is the one that has started most recently", () => {
  const words = [word("uno", 0, 0.3), word("dos", 0.3, 0.3), word("tres", 2.0, 0.3), word("cuatro", 2.3, 0.3)];
  const lines = toLines(words, 2);
  assert.equal(lines.length, 2);
  // Inside the old line's tail and the new line's lead, the new line wins.
  const overlap = lineAt(lines, 1.95);
  assert.equal(overlap?.words[0].w, "tres");
  assert.equal(lineAt(lines, 0.1)?.words[0].w, "uno");
  assert.equal(lineAt(lines, 10), null);
});

test("each caption preset shows what it promises", () => {
  const words = [word("uno", 0, 0.3), word("dos", 0.5, 0.3)];
  assert.deepEqual(visibleWords(words, 1, "karaoke").map((w) => w.w), ["uno", "dos"]);
  assert.deepEqual(visibleWords(words, 1, "boxed").map((w) => w.w), ["uno", "dos"]);
  // One word at a time, and nothing at all between words.
  assert.deepEqual(visibleWords(words, 1, "popline").map((w) => w.w), ["dos"]);
  assert.deepEqual(visibleWords(words, -1, "popline"), []);
  assert.deepEqual(visibleWords(words, 0, "none"), []);
});

test("a corrected word inherits the timing of the word it replaces", () => {
  const original = [word("recomiendes", 1.0, 0.5, 0.3), word("una", 1.5, 0.2), word("app", 1.7, 0.3)];
  const retimed = retimeWords(original, ["recomiendas", "una", "app"]);
  assert.ok(retimed);
  assert.deepEqual(retimed.map((w) => w.w), ["recomiendas", "una", "app"]);
  assert.equal(retimed[1].t, 1.5);
  assert.equal(retimed[2].t, 1.7);
  assert.ok(Math.abs(retimed[0].t - 1.0) < 0.05);
});

test("a word the recogniser missed takes a share of its neighbours' time", () => {
  const original = [word("de", 1.0, 0.2), word("chats", 1.2, 0.6, 0.4)];
  const retimed = retimeWords(original, ["de", "mis", "chats"]);
  assert.ok(retimed);
  assert.deepEqual(retimed.map((w) => w.w), ["de", "mis", "chats"]);
  for (let i = 1; i < retimed.length; i++) assert.ok(retimed[i].t > retimed[i - 1].t, "times stay ordered");
  assert.ok(retimed[retimed.length - 1].t + retimed[retimed.length - 1].d <= 1.81, "stays inside the span");
});

test("a rewrite that keeps nothing is refused", () => {
  const original = [word("uno", 1.0, 0.3), word("dos", 1.3, 0.3), word("tres", 1.6, 0.3)];
  assert.equal(retimeWords(original, ["completely", "different", "sentence"]), null);
});

test("corrections change text without moving the transcript", () => {
  const transcript = Transcript.parse({
    language: "es",
    segments: [{ start: 1, end: 2, text: "recomiendes una app" }],
    words: [word("recomiendes", 1.0, 0.5, 0.3), word("una", 1.5, 0.2), word("app", 1.7, 0.3)],
  });
  const { transcript: fixed, changed } = applyCorrections(transcript, [{ i: 0, text: "recomiendas una app" }]);
  assert.equal(changed, 1);
  assert.equal(fixed.segments[0].text, "recomiendas una app");
  assert.equal(fixed.words[0].w, "recomiendas");
  assert.equal(fixed.words[2].t, 1.7);
  // An out-of-range index, and a no-op correction, are both ignored.
  assert.equal(applyCorrections(transcript, [{ i: 9, text: "hola" }]).changed, 0);
  assert.equal(applyCorrections(transcript, [{ i: 0, text: "recomiendes una app" }]).changed, 0);
});

test("only segments the recogniser doubted are sent for proofreading", () => {
  const transcript = Transcript.parse({
    segments: [
      { start: 0, end: 1, text: "clear" },
      { start: 1, end: 2, text: "muddy" },
      { start: 2, end: 3, text: "" },
    ],
    words: [word("clear", 0.1, 0.5, 0.98), word("muddy", 1.1, 0.5, 0.2), word("ghost", 2.1, 0.5, 0.1)],
  });
  assert.deepEqual(suspectSegments(transcript), [1]);
});

/**
 * Re-transcribing an existing project must refresh words without disturbing the
 * work around them — the whole point of a re-sync over a re-analysis.
 */
let workspace: string;
let database: typeof import("../src/lib/db");
let store: typeof import("../src/lib/editor/store");
let resync: typeof import("../src/lib/transcribe/resync");
let engine: typeof import("../src/lib/transcribe/whispercpp");

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-transcribe-test-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  database = await import("../src/lib/db");
  store = await import("../src/lib/editor/store");
  resync = await import("../src/lib/transcribe/resync");
  engine = await import("../src/lib/transcribe/whispercpp");
});
after(async () => {
  database.db.close();
  await fs.rm(workspace, { recursive: true, force: true });
});

test("a re-sync replaces the words on everything cut from the source, and nothing else", async () => {
  const { Edl } = await import("../src/lib/edl");
  const { projectDir } = await import("../src/lib/config");
  const id = "resync";
  const source = path.join(workspace, "source.mp4");
  const imported = path.join(workspace, "other.mp4");
  const edl = Edl.parse({
    projectId: id,
    source: { file: source, width: 640, height: 360, fps: 30, durationSec: 60 },
    media: [
      { id: "original-source", name: "Original source", file: source, width: 640, height: 360, fps: 30, durationSec: 60 },
      { id: "extra", name: "Imported", file: imported, width: 640, height: 360, fps: 30, durationSec: 60 },
    ],
    clips: [{ id: "one", title: "One", start: 10, end: 20, words: [word("stale", 1, 0.5)], edits: [{ type: "punch", t: 1, d: 1, scale: 1.2, by: "" }] }],
    sequences: [{
      id: "seq", title: "Seq", output: { width: 1080, height: 1920, fps: 30 },
      items: [
        { id: "cut", mediaId: "original-source", clip: { id: "cut", title: "Cut", start: 30, end: 40, words: [word("stale", 2, 0.5)] } },
        { id: "other", mediaId: "extra", clip: { id: "other", title: "Other", start: 0, end: 5, words: [word("keep", 1, 0.5)] } },
        { id: "canvas", mediaId: null, clip: { id: "canvas", title: "Canvas", start: 0, end: 3 } },
      ],
    }],
  });
  database.q.insertProject({ id, name: id, source_path: source, created_at: Date.now() });
  store.publishClips(id, edl);

  const dir = projectDir(id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "transcript.json"), JSON.stringify(Transcript.parse({
    engine: engine.engineId(),
    segments: [],
    words: [word("uno", 11, 0.5), word("dos", 12, 0.5), word("tres", 31, 0.5)],
  })));

  // reuse: the transcript on disk is current, so this exercises the rebase alone.
  const result = await resync.resyncTranscript(id, { reuse: true });
  assert.equal(result.patched, 2);

  const after = store.readEditor(id).edl;
  assert.deepEqual(after.clips[0].words.map((w) => w.w), ["uno", "dos"]);
  // Source seconds become clip-relative seconds.
  assert.equal(after.clips[0].words[0].t, 1);
  assert.deepEqual(after.clips[0].edits, edl.clips[0].edits, "edits are untouched");
  assert.equal(after.clips[0].start, 10);

  const items = after.sequences[0].items;
  assert.deepEqual(items[0].clip.words.map((w) => w.w), ["tres"]);
  assert.deepEqual(items[1].clip.words.map((w) => w.w), ["keep"], "imported media keeps its own words");
  assert.equal(items[2].clip.words.length, 0, "a canvas scene has no source words");
});

test("a re-sync refuses a project whose source has not been downloaded", async () => {
  const id = "remote";
  database.q.insertProject({ id, name: id, source_path: "https://example.com/video.mp4", created_at: Date.now() });
  await assert.rejects(resync.resyncTranscript(id, { reuse: true }), /no downloaded source/);
});

test("a word saved starting before its clip no longer freezes the whole project", async () => {
  const { Edl } = await import("../src/lib/edl");
  const operations = await import("../src/lib/editor/operations");
  const id = "legacy";
  const source = path.join(workspace, "source.mp4");
  const edl = Edl.parse({
    projectId: id,
    source: { file: source, width: 640, height: 360, fps: 30, durationSec: 60 },
    clips: [
      { id: "broken", title: "Broken", start: 10, end: 20, words: [word("reps.", -0.39, 0.4), word("more", 1, 0.5)] },
      { id: "other", title: "Other", start: 20, end: 30, words: [word("fine", 1, 0.5)] },
    ],
  });
  database.q.insertProject({ id, name: id, source_path: source, created_at: Date.now() });
  // Saved before clip cutting clamped word starts, so it never passed today's validation.
  database.db.prepare("INSERT INTO projects (id, name, source_path, created_at, edl, revision) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET edl = excluded.edl, revision = 0")
    .run(id, id, source, Date.now(), JSON.stringify(edl));

  const read = store.readEditor(id);
  const repaired = read.edl.clips[0].words;
  assert.equal(repaired[0].t, 0, "the word now starts with its clip");
  assert.ok(Math.abs(repaired[0].d - 0.01) < 1e-9, "it keeps only the part inside the clip");
  assert.deepEqual(read.edl.clips[1].words.map((w) => w.w), ["fine"], "untouched clips stay untouched");

  // The whole point: an edit to a different clip is no longer refused.
  const saved = store.editProject(id, {
    expectedRevision: read.revision,
    operations: [{ type: "clip.patch", clipId: "other", patch: { title: "Edited" } }],
  });
  assert.equal(saved.edl.clips[1].title, "Edited");
  assert.equal(saved.edl.clips[0].words[0].t, 0);

  // A negative word arriving through an operation is still rejected.
  assert.throws(() => store.editProject(id, {
    expectedRevision: saved.revision,
    operations: [{ type: "clip.patch", clipId: "other", patch: { words: [word("bad", -1, 0.5)] } }],
  }), /nonnegative/);
  void operations;
});
