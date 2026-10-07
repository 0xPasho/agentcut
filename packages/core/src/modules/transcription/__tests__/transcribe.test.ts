import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { frameLevels, readWavMono, rebaseOntoSource, refineWordTimes, speechRuns } from "../server/align";
import { activeWordIndex, lineAt, toLines, visibleWords } from "../../editor/lib/timeline";
import { Transcript, type Word } from "../lib/transcript";

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
  const retimed = polish.retimeWords(original, ["recomiendas", "una", "app"]);
  assert.ok(retimed);
  assert.deepEqual(retimed.map((w) => w.w), ["recomiendas", "una", "app"]);
  assert.equal(retimed[1].t, 1.5);
  assert.equal(retimed[2].t, 1.7);
  assert.ok(Math.abs(retimed[0].t - 1.0) < 0.05);
});

test("a word the recogniser missed takes a share of its neighbours' time", () => {
  const original = [word("de", 1.0, 0.2), word("chats", 1.2, 0.6, 0.4)];
  const retimed = polish.retimeWords(original, ["de", "mis", "chats"]);
  assert.ok(retimed);
  assert.deepEqual(retimed.map((w) => w.w), ["de", "mis", "chats"]);
  for (let i = 1; i < retimed.length; i++) assert.ok(retimed[i].t > retimed[i - 1].t, "times stay ordered");
  assert.ok(retimed[retimed.length - 1].t + retimed[retimed.length - 1].d <= 1.81, "stays inside the span");
});

test("a rewrite that keeps nothing is refused", () => {
  const original = [word("uno", 1.0, 0.3), word("dos", 1.3, 0.3), word("tres", 1.6, 0.3)];
  assert.equal(polish.retimeWords(original, ["completely", "different", "sentence"]), null);
});

test("corrections change text without moving the transcript", () => {
  const transcript = Transcript.parse({
    language: "es",
    segments: [{ start: 1, end: 2, text: "recomiendes una app" }],
    words: [word("recomiendes", 1.0, 0.5, 0.3), word("una", 1.5, 0.2), word("app", 1.7, 0.3)],
  });
  const { transcript: fixed, changed } = polish.applyCorrections(transcript, [{ i: 0, text: "recomiendas una app" }]);
  assert.equal(changed, 1);
  assert.equal(fixed.segments[0].text, "recomiendas una app");
  assert.equal(fixed.words[0].w, "recomiendas");
  assert.equal(fixed.words[2].t, 1.7);
  // An out-of-range index, and a no-op correction, are both ignored.
  assert.equal(polish.applyCorrections(transcript, [{ i: 9, text: "hola" }]).changed, 0);
  assert.equal(polish.applyCorrections(transcript, [{ i: 0, text: "recomiendes una app" }]).changed, 0);
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
  assert.deepEqual(polish.suspectSegments(transcript), [1]);
});

/**
 * Re-transcribing an existing project must refresh words without disturbing the
 * work around them — the whole point of a re-sync over a re-analysis.
 */
let workspace: string;
let database: typeof import("../../../common/server/db");
let store: typeof import("../../editor/server/store");
let resync: typeof import("../server/resync");
let engine: typeof import("../server/whispercpp");
/**
 * Loaded here rather than at the top of the file: proofreading reaches the harness
 * providers, which read the workspace as they load. Imported statically, every run of
 * this file wrote its fixtures into the real workspace — and then failed on the ids it
 * had left there the run before.
 */
let polish: typeof import("../server/polish");

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-transcribe-test-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  database = await import("../../../common/server/db");
  store = await import("../../editor/server/store");
  resync = await import("../server/resync");
  engine = await import("../server/whispercpp");
  polish = await import("../server/polish");
});
after(async () => {
  database.db.close();
  await fs.rm(workspace, { recursive: true, force: true });
});

test("a re-sync replaces the words on everything cut from the source, and nothing else", async () => {
  const { Edl } = await import("../../editor/types");
  const { projectDir } = await import("../../../common/server/config");
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
  const { Edl } = await import("../../editor/types");
  const operations = await import("../../editor/lib/operations");
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

/**
 * Importing a source starts its own transcription, off the project lock, with a
 * record on the media saying where it stands. These cover the skip rules, the
 * failure and its retry, the cache, the glossary reaching the recogniser, and the
 * two interfaces reading one state.
 */
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../../../common/server/bin";
import type { Recogniser } from "../server/transcribe";

let mediaService: typeof import("../../media/server/media-import");
let auto: typeof import("../server/auto");
let mediaTranscribe: typeof import("../server/media");
let settings: typeof import("../server/settings");
let transcribeIndex: typeof import("../server/transcribe");
let tools: typeof import("../../editor/server/tools");
/** Seconds of sound, silence, or no audio stream at all. */
let speaking: string, silent: string, mute: string;

/** What the recogniser was asked, and what it answered. No model, no download. */
function fakeRecogniser() {
  const prompts: Array<string | undefined> = [];
  let calls = 0;
  const recognise: Recogniser = async (_wav, o) => {
    calls += 1;
    prompts.push(o.prompt);
    return Transcript.parse({
      engine: engine.engineId(), language: "en",
      segments: [{ start: 0, end: 2, text: "hola mundo" }],
      words: [word("hola", 0.2, 0.4), word("mundo", 0.8, 0.4)],
    });
  };
  return { recognise, prompts, get calls() { return calls; } };
}

const settle = async (id: string) => {
  for (let i = 0; i < 400; i++) {
    if (!auto.backgroundTranscription(id)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("the background transcription never finished");
};
const mediaState = (id: string) => mediaTranscribe.transcriptionState(id).media;

/** Built once, on the first test that needs footage: the workspace exists by then. */
let fixtures: Promise<void> | null = null;
const ready = () => (fixtures ??= (async () => {
  [mediaService, auto, mediaTranscribe, settings, transcribeIndex, tools] = await Promise.all([
    import("../../media/server/media-import"), import("../server/auto"), import("../server/media"),
    import("../server/settings"), import("../server/transcribe"), import("../../editor/server/tools"),
  ]);
  const make = (name: string, args: string[]) => {
    const file = path.join(workspace, name);
    const result = spawnSync(FFMPEG, ["-y", ...args, "-pix_fmt", "yuv420p", "-shortest", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return file;
  };
  speaking = make("speaking.mp4", ["-f", "lavfi", "-i", "color=navy:size=160x90:rate=10:duration=3", "-f", "lavfi", "-i", "sine=frequency=300:duration=3"]);
  silent = make("silent.mp4", ["-f", "lavfi", "-i", "color=maroon:size=160x90:rate=10:duration=3", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=3"]);
  mute = make("mute.mp4", ["-f", "lavfi", "-i", "color=teal:size=160x90:rate=10:duration=3"]);
})());
after(() => transcribeIndex?.setDefaultRecogniser(undefined));

test("a newly imported source transcribes itself, and its words land on the shot it was placed as", async () => {
  await ready();
  const fake = fakeRecogniser();
  transcribeIndex.setDefaultRecogniser(fake.recognise);
  process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT = "audio";
  const { id } = await mediaService.createVideoProject("Imports", [{ file: speaking }]);
  // The record exists the moment the media does: a source is never quietly wordless.
  const queued = store.readEditor(id).edl.media[0];
  assert.ok(["queued", "done"].includes(queued.transcription!.status), queued.transcription!.status);
  assert.equal(queued.transcription!.by, "import");

  await settle(id);

  const after = store.readEditor(id).edl;
  assert.equal(after.media[0].transcription!.status, "done");
  assert.equal(after.media[0].transcription!.words, 2);
  assert.equal(after.media[0].transcription!.engine, engine.engineId());
  assert.deepEqual(after.sequences[0].items[0].clip.words.map((w) => w.w), ["hola", "mundo"], "the shot cut from it has the words");
  assert.equal(fake.calls, 1);
  delete process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT;
});

test("a source with no audio track, and one with only silence, are skipped with the reason rather than recognised", async () => {
  await ready();
  const fake = fakeRecogniser();
  transcribeIndex.setDefaultRecogniser(fake.recognise);
  process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT = "audio";
  const { id } = await mediaService.createVideoProject("Broll", [{ file: mute }, { file: silent }]);
  await settle(id);
  const [noTrack, quiet] = store.readEditor(id).edl.media;
  assert.equal(noTrack.transcription!.status, "skipped");
  assert.match(noTrack.transcription!.reason, /no audio track/);
  assert.equal(quiet.transcription!.status, "skipped");
  assert.match(quiet.transcription!.reason, /silent/);
  assert.equal(fake.calls, 0, "forty silent b-roll clips are not forty recogniser runs");
  delete process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT;
});

test("the switch is honoured at every level, and a per-import no is recorded as a skip that can still be undone", async () => {
  await ready();
  const fake = fakeRecogniser();
  transcribeIndex.setDefaultRecogniser(fake.recognise);
  process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT = "audio";
  // Explicitly not this one.
  const { id } = await mediaService.createVideoProject("Opt out", [{ file: speaking }], { transcribe: false });
  await settle(id);
  const skipped = store.readEditor(id).edl.media[0];
  assert.equal(skipped.transcription!.status, "skipped");
  assert.match(skipped.transcription!.reason, /not requested/);
  assert.equal(fake.calls, 0);

  // The same source, asked for by name afterwards: nothing about the skip is final.
  auto.startMediaTranscription(id, { mediaIds: [skipped.id], by: "" });
  await settle(id);
  assert.equal(store.readEditor(id).edl.media[0].transcription!.status, "done");
  assert.equal(fake.calls, 1);
  delete process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT;
});

test("the workspace setting decides, a project overrides it, and the environment beats both", async () => {
  await ready();
  settings.saveTranscribeMode(null); settings.saveTranscribeMode(null, "proj");
  delete process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT;
  // Without the env, the default is on-when-there-is-sound.
  const saved = process.env.NODE_TEST_CONTEXT; delete process.env.NODE_TEST_CONTEXT;
  assert.deepEqual(settings.resolveTranscribeMode(), { mode: "audio", scope: "default" });
  settings.saveTranscribeMode("off");
  assert.equal(settings.resolveTranscribeMode().mode, "off");
  settings.saveTranscribeMode("always", "proj");
  assert.deepEqual(settings.resolveTranscribeMode("proj"), { mode: "always", scope: "project" });
  process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT = "off";
  assert.deepEqual(settings.resolveTranscribeMode("proj"), { mode: "off", scope: "env" });
  delete process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT;
  settings.saveTranscribeMode(null); settings.saveTranscribeMode(null, "proj");
  // A test run never starts a model download as a side effect of importing footage.
  process.env.NODE_TEST_CONTEXT = saved ?? "child-v8";
  assert.equal(settings.resolveTranscribeMode().mode, "off");
});

test("a failure keeps its reason on the source, and a retry clears it", async () => {
  await ready();
  const fake = fakeRecogniser();
  transcribeIndex.setDefaultRecogniser(fake.recognise);
  process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT = "off";
  const { id } = await mediaService.createVideoProject("Broken", [{ file: speaking }]);
  const mediaId = store.readEditor(id).edl.media[0].id;
  // The copy in the workspace goes missing: ffmpeg cannot extract audio from it.
  const file = store.readEditor(id).edl.media[0].file;
  const kept = await fs.readFile(file);
  await fs.rm(file);

  await mediaTranscribe.transcribeProjectMedia(id, { mediaIds: [mediaId] });
  const failed = store.readEditor(id).edl.media[0].transcription!;
  assert.equal(failed.status, "failed");
  assert.ok(failed.reason.length, "the reason travels with the failure, like plan.reasons.error");
  assert.equal(mediaState(id)[0].status, "failed");

  await fs.writeFile(file, kept);
  auto.startMediaTranscription(id, { mediaIds: [mediaId] });
  await settle(id);
  assert.equal(store.readEditor(id).edl.media[0].transcription!.status, "done");
  delete process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT;
});

test("a transcript already on disk is reused, and a truncated one is recognised again instead of throwing", async () => {
  await ready();
  const fake = fakeRecogniser();
  transcribeIndex.setDefaultRecogniser(fake.recognise);
  process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT = "off";
  const { id } = await mediaService.createVideoProject("Cache", [{ file: speaking }]);
  const mediaId = store.readEditor(id).edl.media[0].id;

  await mediaTranscribe.transcribeProjectMedia(id, { mediaIds: [mediaId] });
  assert.equal(fake.calls, 1);
  await mediaTranscribe.transcribeProjectMedia(id, { mediaIds: [mediaId] });
  assert.equal(fake.calls, 1, "the second run reads the cache under transcripts/<mediaId>/");

  // What a process killed mid-write used to leave behind.
  const cached = path.join(mediaTranscribe.mediaTranscriptDir(id, mediaId), "transcript.json");
  await fs.writeFile(cached, (await fs.readFile(cached, "utf8")).slice(0, 40));
  const result = await mediaTranscribe.transcribeProjectMedia(id, { mediaIds: [mediaId] });
  assert.equal(result.results[0].status, "done");
  assert.equal(fake.calls, 2, "half a transcript is no transcript");
  delete process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT;
});

test("the glossary still reaches the recogniser on the import path", async () => {
  await ready();
  const fake = fakeRecogniser();
  transcribeIndex.setDefaultRecogniser(fake.recognise);
  process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT = "off";
  const { id } = await mediaService.createVideoProject("Names", [{ file: speaking }]);
  const { saveGlossary } = await import("../../rules/server/glossary");
  await saveGlossary({ terms: [{ term: "Remotion", aliases: ["remoshun"], note: "the renderer" }] }, "project", id);

  auto.startMediaTranscription(id, { mediaIds: [store.readEditor(id).edl.media[0].id] });
  await settle(id);
  assert.match(fake.prompts.at(-1) ?? "", /Remotion/);
  delete process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT;
});

test("both interfaces read one state, and the agent is told a transcript is still coming", async () => {
  await ready();
  const fake = fakeRecogniser();
  transcribeIndex.setDefaultRecogniser(fake.recognise);
  process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT = "off";
  const { id } = await mediaService.createVideoProject("Parity", [{ file: speaking }, { file: mute }]);
  const [spoken, silentOne] = store.readEditor(id).edl.media.map((m) => m.id);
  mediaTranscribe.markQueued(id, [spoken], "import");
  mediaTranscribe.markSkipped(id, silentOne, "this file has no audio track");

  // The panel and the agent ask the same tool and get the same answer.
  const report = await tools.executeEditorTool(id, { tool: "media.transcription" }) as
    { media: Array<{ id: string; status: string; reason: string }>; settings: { effective: { mode: string } } };
  assert.deepEqual(report.media.map((m) => [m.id, m.status]), [[spoken, "queued"], [silentOne, "skipped"]]);
  assert.equal(report.settings.effective.mode, "off");
  assert.deepEqual(report.media, mediaState(id).map((m) => ({ ...m })));
  // A run must not read empty words as "nothing is said in this video".
  const note = mediaTranscribe.transcriptionNote(id);
  assert.match(note, /Still being transcribed/);
  assert.match(note, /do not conclude/);

  // And the switch is writable from either side, through the same tool.
  await tools.executeEditorTool(id, { tool: "media.transcription.set", mode: "always", level: "project" });
  assert.equal(settings.resolveTranscribeMode(id).mode, "off", "the environment still wins");
  assert.equal(settings.storedTranscribeMode(id), "always");
  settings.saveTranscribeMode(null, id);

  await tools.executeEditorTool(id, { tool: "media.transcribe", mediaIds: [spoken], background: true });
  await settle(id);
  assert.equal(store.readEditor(id).edl.media[0].transcription!.status, "done");
  delete process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT;
});

test("a second import joins the run already going instead of starting a second recogniser", async () => {
  await ready();
  const fake = fakeRecogniser();
  transcribeIndex.setDefaultRecogniser(fake.recognise);
  process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT = "off";
  const { id } = await mediaService.createVideoProject("Two", [{ file: speaking }]);
  const first = store.readEditor(id).edl.media[0].id;
  const started = auto.startMediaTranscription(id, { mediaIds: [first] });
  assert.equal(started.started, true);
  const second = auto.startMediaTranscription(id, { mediaIds: [first] });
  assert.equal(second.started, false, "one drain per project");
  assert.equal(second.job?.id, started.job?.id);
  await settle(id);
  assert.equal(fake.calls, 1);
  delete process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT;
});

test("an old EDL neither carries the record nor gains one by being read", async () => {
  await ready();
  const { Edl } = await import("../../editor/types");
  const id = "legacy-media";
  const source = path.join(workspace, "legacy.mp4");
  const edl = Edl.parse({
    projectId: id, source: { file: source, width: 640, height: 360, fps: 30, durationSec: 60 },
    media: [{ id: "m1", name: "Old", file: source, width: 640, height: 360, fps: 30, durationSec: 60 }],
    clips: [], sequences: [],
  });
  assert.equal(edl.media[0].transcription, undefined);
  database.q.insertProject({ id, name: id, source_path: source, created_at: Date.now() });
  database.db.prepare("INSERT INTO projects (id, name, source_path, created_at, edl, revision) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET edl = excluded.edl, revision = 0")
    .run(id, id, source, Date.now(), JSON.stringify(edl));
  const read = store.readEditor(id);
  assert.equal(read.revision, 0, "opening it persists nothing");
  assert.equal(read.edl.media[0].transcription, undefined);
  // It reads as "nobody has listened to this yet", not as a video with no speech.
  assert.equal(mediaState(id)[0].status, "none");
});

test("a transcript is measured against the sound under it, and a shift nobody can see is not one", async () => {
  const { readSync, speechMask } = await import("../lib/sync");
  const step = 0.02;
  // Ten seconds of 20ms windows: speech between 1–2s and 3–4.5s, silence either side.
  const loud = (from: number, to: number) => (index: number) => index * step >= from && index * step < to;
  const spans = [loud(1, 2), loud(3, 4.5)];
  const db = Array.from({ length: 500 }, (_, index) => (spans.some((inside) => inside(index)) ? -20 : -60));
  const mask = speechMask(db);
  assert.equal(mask.filter(Boolean).length, Math.round((1 + 1.5) / step), "the mask is the loud part");

  const onTime = [{ t: 1, d: 1, w: "uno" }, { t: 3, d: 1.5, w: "dos" }];
  const exact = readSync(onTime, mask, step);
  assert.equal(exact.shiftSec, 0, "words on the sound need no shift");
  assert.ok(exact.agreement > 0.99, `${exact.agreement}`);
  assert.ok(Math.abs(exact.wordShare - 0.25) < 0.01);
  assert.ok(Math.abs(exact.speechShare - 0.25) < 0.01);

  // The same words a fifth of a second early: the reading says so, and says which way.
  const early = onTime.map((word) => ({ ...word, t: word.t - 0.2 }));
  const late = readSync(early, mask, step);
  assert.ok(Math.abs(late.shiftSec - 0.2) < 0.021, `expected about +200ms, got ${late.shiftSec}`);
  assert.ok(late.agreement > late.unshifted, "and shifting them agrees better than leaving them");

  // Silence has no ceiling to threshold against, so none of it is called speech.
  assert.deepEqual(speechMask(Array.from({ length: 100 }, () => -60)).filter(Boolean), []);
  assert.deepEqual(speechMask([]), []);
  // Nothing said at all is not a shift either.
  const empty = readSync([], mask, step);
  assert.equal(empty.shiftSec, 0);
  assert.equal(empty.wordShare, 0);
});
