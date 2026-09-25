import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseClock, parseTranscript, segmentsFromWords, wordsAcross } from "../lib/import";
import { spreadOverSpeech } from "../server/align";
import { Transcript } from "../lib/transcript";
import type { Recogniser } from "../server/transcribe";

/**
 * A transcript the person already has is what was said. These pin that every common
 * shape of one reads into the same words, that a file timed only per line still gets
 * words on the speech, and that nothing downstream swaps it for the recogniser's guess.
 */

test("clocks read in every shape subtitles and transcript panels write them", () => {
  assert.equal(parseClock("01:02:03,456"), 3723.456);
  assert.equal(parseClock("1:02:03.5"), 3723.5);
  assert.equal(parseClock("02:03"), 123);
  assert.equal(parseClock("4:05:00"), 14700);
  assert.equal(parseClock("123"), null, "a bare number is not a clock");
  assert.equal(parseClock("1:2:3:4"), null);
});

test("an SRT file becomes lines, with markup gone and a line held across two cues kept as one", () => {
  const parsed = parseTranscript([
    "1", "00:00:01,000 --> 00:00:03,500", "<i>Hola</i> a todos,", "bienvenidos.", "",
    "2", "00:00:03,500 --> 00:00:04,000", "{\\an8}Hola a todos, bienvenidos.", "",
    "3", "01:59:58,000 --> 02:00:01,250", "Y con eso cerramos &amp; nos vamos.", "",
  ].join("\r\n"), { name: "stream.srt" });
  assert.equal(parsed.format, "srt");
  assert.equal(parsed.words.length, 0, "an SRT file times lines, not words");
  assert.deepEqual(parsed.segments.map((s) => [s.start, s.end, s.text]), [
    [1, 4, "Hola a todos, bienvenidos."],
    [7198, 7201.25, "Y con eso cerramos & nos vamos."],
  ]);
});

test("a VTT file keeps its language and its speakers", () => {
  const parsed = parseTranscript([
    "WEBVTT", "Kind: captions", "Language: es", "",
    "NOTE a comment block is not a cue", "",
    "00:01.000 --> 00:02.500 align:start position:0%", "<v Pasho>Arrancamos.", "",
    "00:02.500 --> 00:04.000", "<v.loud Invitado>¿Ya se oye?", "",
  ].join("\n"));
  assert.equal(parsed.format, "vtt");
  assert.equal(parsed.language, "es");
  assert.deepEqual(parsed.segments.map((s) => [s.text, s.speaker]), [["Arrancamos.", "Pasho"], ["¿Ya se oye?", "Invitado"]]);
});

test("YouTube's captions time every word, and the scrolled-up repeat of each line is not read twice", () => {
  const parsed = parseTranscript([
    "WEBVTT", "Kind: captions", "Language: en", "",
    "00:00:00.320 --> 00:00:02.990 align:start position:0%", " ",
    "hello<00:00:00.880><c> everyone</c><00:00:01.439><c> welcome</c>", "",
    "00:00:02.990 --> 00:00:03.000 align:start position:0%", "hello everyone welcome", " ", "",
    "00:00:03.000 --> 00:00:05.000 align:start position:0%", "hello everyone welcome",
    "to<00:00:03.360><c> the</c><00:00:03.600><c> stream</c>", "",
  ].join("\n"));
  assert.deepEqual(parsed.words.map((w) => w.w), ["hello", "everyone", "welcome", "to", "the", "stream"]);
  assert.deepEqual(parsed.words.map((w) => w.t), [0.32, 0.88, 1.439, 3, 3.36, 3.6]);
  assert.ok(parsed.words.every((w, i, all) => i === all.length - 1 || w.t + w.d <= all[i + 1].t + 1e-9), "no word runs into the next");
  assert.ok(parsed.segments.length >= 1, "lines are built from the words");
});

test("recogniser and captioning-service JSON all read into the same words", () => {
  const openai = parseTranscript(JSON.stringify({
    language: "spanish",
    segments: [{ id: 0, start: 0.5, end: 2, text: " Hola mundo." }],
    words: [{ word: "Hola", start: 0.5, end: 0.9 }, { word: "mundo.", start: 1, end: 1.6 }],
  }));
  assert.deepEqual(openai.words.map((w) => [w.w, w.t]), [["Hola", 0.5], ["mundo.", 1]]);
  assert.equal(openai.segments[0].text, "Hola mundo.");

  const deepgram = parseTranscript(JSON.stringify({ results: { channels: [{ detected_language: "es", alternatives: [{
    words: [{ word: "hola", punctuated_word: "Hola,", start: 0.2, end: 0.5, confidence: 0.9, speaker: 0 }],
  }] }] } }));
  assert.deepEqual(deepgram.words.map((w) => [w.w, w.t, w.p]), [["Hola,", 0.2, 0.9]]);
  assert.equal(deepgram.language, "es");

  const assembly = parseTranscript(JSON.stringify({ language_code: "es", audio_duration: 18000,
    words: [{ text: "Hola", start: 17_990_000, end: 17_990_400, confidence: 0.99 }] }));
  assert.equal(assembly.words[0].t, 17990, "milliseconds are read as milliseconds");

  const whisper = parseTranscript(JSON.stringify({ result: { language: "es" },
    transcription: [{ offsets: { from: 1500, to: 4000 }, text: " Buenas tardes" }] }));
  assert.equal(whisper.format, "whisper.cpp");
  assert.deepEqual(whisper.segments.map((s) => [s.start, s.end, s.text]), [[1.5, 4, "Buenas tardes"]]);

  const own = parseTranscript(JSON.stringify(Transcript.parse({ language: "es", engine: "x",
    segments: [{ start: 0, end: 1, text: "uno dos" }], words: [{ t: 0, d: 0.4, w: "uno" }, { t: 0.5, d: 0.4, w: "dos" }] })));
  assert.deepEqual(own.words.map((w) => w.w), ["uno", "dos"]);
});

test("a bare JSON array is lines or words by what its entries hold, and its clock's unit by the video's length", () => {
  const lines = parseTranscript(JSON.stringify([{ start: "00:00:05.000", end: "00:00:08.000", text: "una frase entera" }]));
  assert.deepEqual(lines.segments.map((s) => [s.start, s.end]), [[5, 8]]);
  assert.equal(lines.words.length, 0);

  const words = parseTranscript(JSON.stringify([{ start: 1000, end: 1400, text: "uno" }, { start: 1500, end: 1900, text: "dos" }]), { durationSec: 60 });
  assert.deepEqual(words.words.map((w) => w.t), [1, 1.5], "past the video in seconds, inside it in milliseconds");
});

test("timestamped lines read with the time beside the text or above it, and untimed text is refused", () => {
  const beside = parseTranscript("Stream del martes\n[00:00:10] Arrancamos\n[1:02:03] Ya casi\ncontinúa aquí\n", { durationSec: 4000 });
  assert.equal(beside.format, "lines");
  assert.deepEqual(beside.segments.map((s) => [s.start, s.end, s.text]), [
    // A line lasts what it takes to say, not the hour of silence until the next one.
    [10, 12.5, "Arrancamos"],
    [3723, 3725.5, "Ya casi continúa aquí"],
  ]);
  const above = parseTranscript("0:03\nhola a todos\n0:07\nbienvenidos\n");
  assert.deepEqual(above.segments.map((s) => [s.start, s.text]), [[3, "hola a todos"], [7, "bienvenidos"]]);
  const ranged = parseTranscript("00:01:00 - 00:01:04 una línea con rango");
  assert.deepEqual(ranged.segments.map((s) => [s.start, s.end]), [[60, 64]]);
  assert.throws(() => parseTranscript("Solo texto, sin tiempos."), /no timestamps/);
  assert.throws(() => parseTranscript("   "), /empty/);
  assert.throws(() => parseTranscript("{ nope"), /not valid JSON/);
});

test("a line's words land on the speech inside it, stepping over the pause", () => {
  const seg = { start: 10, end: 16 };
  const runs = [{ start: 10.5, end: 11.5 }, { start: 14, end: 15 }];
  const words = spreadOverSpeech(wordsAcross("uno dos tres cuatro", seg.end - seg.start), seg, runs);
  assert.equal(words.length, 4);
  assert.equal(words[0].t, 10.5, "the first word starts where the speech does, not where the line does");
  for (const w of words) {
    const inside = runs.some((r) => w.t >= r.start - 1e-9 && w.t < r.end);
    assert.ok(inside, `${w.w} at ${w.t} starts inside speech`);
  }
  assert.ok(words[3].t + words[3].d <= 15 + 1e-9);
  const flat = spreadOverSpeech(wordsAcross("sin sonido", 2), { start: 5, end: 7 }, []);
  assert.deepEqual(flat.map((w) => Number(w.t.toFixed(2))), [5, 5.73], "with no sound they share the line by length");
});

test("words that arrived without lines are grouped at pauses and full stops", () => {
  const w = (t: number, text: string) => ({ t, d: 0.3, w: text });
  const lines = segmentsFromWords([w(0, "Hola"), w(0.5, "a"), w(1, "todos"), w(1.8, "otra."), w(2.4, "Nueva"), w(5, "tras"), w(5.4, "pausa")]);
  assert.deepEqual(lines.map((s) => s.text), ["Hola a todos otra.", "Nueva", "tras pausa"]);
});

// ─── the project ─────────────────────────────────────────────────────────────

let workspace: string;
let database: typeof import("../../../common/server/db");
let store: typeof import("../../editor/server/store");
let provided: typeof import("../server/provided");
let transcribeIndex: typeof import("../server/transcribe");
let mediaTranscribe: typeof import("../server/media");
let mediaService: typeof import("../../media/server/media-import");
let tools: typeof import("../../editor/server/tools");
/** Five seconds: silence, sound 1–2 s, silence, sound 3–4 s, silence. */
let talking: string;

function fakeRecogniser() {
  let calls = 0;
  const recognise: Recogniser = async () => {
    calls += 1;
    return Transcript.parse({ engine: "whisper-guess", segments: [{ start: 0, end: 1, text: "guessed" }], words: [{ t: 1, d: 0.5, w: "guessed" }] });
  };
  return { recognise, get calls() { return calls; } };
}

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-provided-test-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT = "off";
  database = await import("../../../common/server/db");
  store = await import("../../editor/server/store");
  provided = await import("../server/provided");
  transcribeIndex = await import("../server/transcribe");
  mediaTranscribe = await import("../server/media");
  mediaService = await import("../../media/server/media-import");
  tools = await import("../../editor/server/tools");
  const { FFMPEG } = await import("../../../common/server/bin");
  talking = path.join(workspace, "talking.mp4");
  const made = spawnSync(FFMPEG, ["-y",
    "-f", "lavfi", "-i", "color=navy:size=160x90:rate=10:duration=5",
    "-f", "lavfi", "-i", "aevalsrc='if(between(t,1,2)+between(t,3,4),0.4*sin(2*PI*300*t),0)':s=16000:d=5",
    "-pix_fmt", "yuv420p", "-shortest", talking], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
});
after(async () => {
  transcribeIndex.setDefaultRecogniser(undefined);
  delete process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT;
  database.db.close();
  await fs.rm(workspace, { recursive: true, force: true });
});

async function sourceProject(id: string) {
  const { Edl } = await import("../../editor/types");
  database.q.insertProject({ id, name: id, source_path: talking, created_at: Date.now() });
  store.publishClips(id, Edl.parse({
    projectId: id,
    source: { file: talking, width: 160, height: 90, fps: 10, durationSec: 5 },
    clips: [{ id: "cut", title: "Cut", start: 0.5, end: 4.5, words: [{ t: 0, d: 0.5, w: "stale" }] }],
  }));
}

const SRT = "1\n00:00:00,800 --> 00:00:02,200\nuno dos\n\n2\n00:00:02,800 --> 00:00:04,200\ntres cuatro\n";

test("a transcript timed per line becomes the source's words, on the speech, and on the clips already cut", async () => {
  await sourceProject("lines");
  const result = await provided.importTranscript("lines", { text: SRT, name: "vod.srt" });
  assert.equal(result.engine, "provided:srt");
  assert.equal(result.timing, "segments");
  assert.equal(result.words, 4);
  assert.equal(result.patched, 1);

  const cut = store.readEditor("lines").edl.clips[0];
  assert.deepEqual(cut.words.map((w) => w.w), ["uno", "dos", "tres", "cuatro"]);
  // Clip-relative: the clip starts at 0.5 s and the speech at 1 s and 3 s.
  assert.ok(Math.abs(cut.words[0].t - 0.5) < 0.06, `uno at ${cut.words[0].t}`);
  assert.ok(Math.abs(cut.words[2].t - 2.5) < 0.06, `tres at ${cut.words[2].t}`);

  const state = mediaTranscribe.transcriptionState("lines").source;
  assert.equal(state.status, "provided");
  assert.equal(state.status === "provided" && state.name, "vod.srt");
  const { projectDir } = await import("../../../common/server/config");
  const kept = await fs.readFile(path.join(projectDir("lines"), "transcript.original.srt"), "utf8");
  assert.equal(kept, SRT, "the file as it was handed over is kept");
});

test("the recogniser never replaces it — not on analysis, not when forced, not when it finishes after the import", async () => {
  await sourceProject("truth");
  const { projectDir } = await import("../../../common/server/config");
  await provided.importTranscript("truth", { text: SRT, name: "vod.srt" });
  const fake = fakeRecogniser();
  const forced = await transcribeIndex.ensureTranscript({ dir: projectDir("truth"), sourcePath: talking, force: true, recognise: fake.recognise });
  assert.equal(fake.calls, 0);
  assert.equal(forced.transcript.engine, "provided:srt");

  const resynced = await (await import("../server/resync")).resyncTranscript("truth");
  assert.equal(resynced.transcript.engine, "provided:srt", "Re-sync captions keeps it too");

  // Discarded, the recogniser runs again...
  await provided.discardTranscript("truth");
  assert.equal(mediaTranscribe.transcriptionState("truth").source.status, "none");
  await transcribeIndex.ensureTranscript({ dir: projectDir("truth"), sourcePath: talking, recognise: fake.recognise });
  assert.equal(fake.calls, 1);
  assert.equal(mediaTranscribe.transcriptionState("truth").source.status, "recognised");
  await assert.rejects(provided.discardTranscript("truth"), /no transcript you provided/);

  // ...and a run that was already listening when the person handed theirs over keeps theirs.
  const slow: Recogniser = async (wav, o) => {
    await provided.writeProvidedTranscript({ text: SRT, name: "late.srt", file: talking, dir: projectDir("truth") });
    return fake.recognise(wav, o);
  };
  const raced = await transcribeIndex.ensureTranscript({ dir: projectDir("truth"), sourcePath: talking, force: true, recognise: slow });
  assert.equal(raced.transcript.engine, "provided:srt");
});

test("a transcript that runs past the end of the video is refused as the wrong one", async () => {
  await sourceProject("wrong");
  await assert.rejects(
    provided.importTranscript("wrong", { text: "1\n01:00:00,000 --> 01:00:02,000\nde otro video\n" }),
    /runs to 1:00:00.00 but the video is 0:05.00 long/,
  );
  assert.equal(mediaTranscribe.transcriptionState("wrong").source.status, "none", "nothing is written");
});

test("imported media takes one through the same tool the panel calls, and a forced transcription keeps it", async () => {
  const fake = fakeRecogniser();
  transcribeIndex.setDefaultRecogniser(fake.recognise);
  const { id } = await mediaService.createVideoProject("Media", [{ file: talking }]);
  const mediaId = store.readEditor(id).edl.media[0].id;
  const file = path.join(workspace, "words.json");
  await fs.writeFile(file, JSON.stringify({ words: [{ word: "uno", start: 1, end: 1.4 }, { word: "dos", start: 3, end: 3.5 }] }));

  const imported = await tools.executeEditorTool(id, { tool: "transcript.import", file, mediaId }) as { timing: string; patched: number; name: string };
  assert.equal(imported.timing, "words");
  assert.equal(imported.name, "words.json");
  assert.equal(imported.patched, 1);

  const after = store.readEditor(id).edl;
  assert.equal(after.media[0].transcription?.engine, "provided:json");
  assert.deepEqual(after.sequences[0].items[0].clip.words.map((w) => [w.w, w.t]), [["uno", 1], ["dos", 3]]);

  await tools.executeEditorTool(id, { tool: "media.transcribe", mediaIds: [mediaId], force: true });
  assert.equal(fake.calls, 0, "Transcribe again keeps the words the person gave");
  assert.match(mediaTranscribe.transcriptionNote(id), /transcript the person provided/);

  await tools.executeEditorTool(id, { tool: "transcript.discard", mediaId });
  assert.equal(store.readEditor(id).edl.media[0].transcription, undefined, "the source reads as not transcribed again");
  assert.deepEqual(store.readEditor(id).edl.sequences[0].items[0].clip.words.map((w) => w.w), ["uno", "dos"], "the words stay until something replaces them");
  await assert.rejects(tools.executeEditorTool(id, { tool: "transcript.import", mediaId }), /file path or as its text/);
});

test("a speaker label after the time is who is speaking, not part of what they said", () => {
  const parsed = parseTranscript("00:00:00 [Speaker 1]\nPues nos vamos al en vivo.\n00:00:24 [Speaker 1]\nMuy bien, ahí está.\n\n04:43:21 [Speaker 2]\nBye.\n", { durationSec: 17006 });
  assert.deepEqual(parsed.segments.map((s) => [s.start, +s.end.toFixed(3), s.speaker, s.text]), [
    [0, 3.6, "Speaker 1", "Pues nos vamos al en vivo."],
    [24, 26.5, "Speaker 1", "Muy bien, ahí está."],
    [17001, 17003.5, "Speaker 2", "Bye."],
  ]);
  // Twenty seconds after seven words is not seven words' worth of line.
  const gap = parseTranscript("00:00:29 A a Instagram y a TikTok ¿Qué onda?\n00:00:49 Hoy es el día 174.");
  assert.ok(Math.abs(gap.segments[0].end - (29 + 8 * 0.6)) < 1e-9, `${gap.segments[0].end}`);
});
