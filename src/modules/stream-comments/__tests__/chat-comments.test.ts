import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { FFMPEG } from "../../../common/server/bin";

/**
 * A stream short opens on the comment it answers. The chat is a real SQLite file in the
 * unified chat's own shape, the recording carries the moment it went live, and the clip
 * says the question out loud — which is how the template knows which message it is.
 */

let workspace: string;
let source: string;
let store: typeof import("../../editor/server/store");
let mediaService: typeof import("../../media/server/media-import");
let tools: typeof import("../../editor/server/tools");
let database: typeof import("../../../common/server/db");
let registry: typeof import("../../templates/server/registry");
let comments: typeof import("../server/comments");

const LIVE = Date.parse("2026-09-21T00:12:45Z");
const CLIP_START = 100;

function speak(text: string, from = 0) {
  return text.split(/\s+/).map((w, i) => ({ t: from + i * 0.4, d: 0.34, w }));
}
const WORDS = [
  ...speak("¿Recomendaciones para primer SaaS? Dice Evan.", 0.2),
  ...speak("Lo que te puedo decir es que pienses primero en el marketing.", 3.4),
];

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-chat-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  const chatFile = path.join(workspace, "chat.db");
  process.env.CHAT_DB_PATH = chatFile;
  const chat = new DatabaseSync(chatFile);
  chat.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, type TEXT NOT NULL,
    external_id TEXT, ts INTEGER NOT NULL, user_id TEXT, handle TEXT, nickname TEXT, avatar TEXT, color TEXT, text TEXT,
    is_bot INTEGER NOT NULL DEFAULT 0, is_moderator INTEGER NOT NULL DEFAULT 0, is_subscriber INTEGER NOT NULL DEFAULT 0,
    is_first INTEGER NOT NULL DEFAULT 0, badges TEXT, meta TEXT, session_id TEXT, created_at INTEGER NOT NULL DEFAULT 0)`);
  const add = chat.prepare("INSERT INTO events (platform, type, ts, handle, nickname, avatar, text, is_bot) VALUES (?, ?, ?, ?, ?, '', ?, ?)");
  const at = (sec: number) => LIVE + sec * 1000;
  add.run("tiktok", "chat", at(CLIP_START - 60), "evvvaaan", "evvvaaan", "Recomendaciones para primer saas?", 0);
  add.run("youtube", "chat", at(CLIP_START - 20), "otro", "@otro", "que estas creando", 0);
  add.run("tiktok", "chat", at(CLIP_START - 10), "bot", "Streamlabs", "Recomendaciones para primer saas? síguenos", 1);
  add.run("tiktok", "like", at(CLIP_START - 5), "fan", "fan", null, 0);
  // Long before the clip: the same words, but not what this clip answers.
  add.run("kick", "chat", at(CLIP_START - 900), "viejo", "viejo", "Recomendaciones para primer saas?", 0);
  chat.close();

  [store, mediaService, tools, database, registry, comments] = await Promise.all([
    import("../../editor/server/store"), import("../../media/server/media-import"), import("../../editor/server/tools"),
    import("../../../common/server/db"), import("../../templates/server/registry"), import("../server/comments"),
  ]);
  const { resetBrandIndex, brandIndex } = await import("../../media/server/search/brand");
  resetBrandIndex();
  await fs.mkdir(path.join(workspace, "cache"), { recursive: true });
  await fs.writeFile(path.join(workspace, "cache", "brands.json"), JSON.stringify([]));
  await brandIndex();
  source = path.join(workspace, "stream.mp4");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=navy:size=864x558:rate=30:duration=115",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=115", "-pix_fmt", "yuv420p", "-shortest", "-c:a", "aac", "-preset", "ultrafast",
    "-metadata", "creation_time=2026-09-21T00:12:45.000000Z", source], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

async function project(words = WORDS) {
  const { id } = await mediaService.createVideoProject("Chat", [{ file: source }]);
  const snapshot = store.readEditor(id);
  const sequence = snapshot.edl.sequences[0];
  store.editProject(id, { expectedRevision: snapshot.revision, operations: [
    { type: "item.patch", sequenceId: sequence.id, itemId: sequence.items[0].id,
      patch: { title: "Corte", hook: "¿Marketing o producto?", start: CLIP_START, end: CLIP_START + 10, words } },
  ] });
  return { id, sequenceId: sequence.id };
}

const layers = (id: string, sequenceId: string) => store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items;
const hookStart = (id: string, sequenceId: string) => {
  const hook = layers(id, sequenceId).find((item) => item.clip.title === "Hook")!;
  return hook.clip.edits.find((edit) => edit.type === "text")!.t;
};

test("the recording says when it went live, and the chat is read on that clock", async () => {
  const { probe } = await import("../../media/server/ffmpeg");
  assert.equal((await probe(source)).recordedAt, LIVE);
  const window = comments.chatWindow({ start: CLIP_START, end: CLIP_START + 10 }, LIVE);
  const found = comments.readComments(process.env.CHAT_DB_PATH!, window.from, window.to);
  assert.deepEqual(found.map((c) => c.name), ["evvvaaan", "@otro"], "chat only, no bots, no likes, nothing from fifteen minutes before");
  const ranked = comments.rankComments(found, { start: CLIP_START, words: WORDS }, LIVE);
  assert.equal(ranked[0].name, "evvvaaan");
  assert.ok(comments.answers(ranked[0]), `read out: ${ranked[0].matched}`);
  assert.ok(!comments.answers(ranked[1]), "a message the clip says nothing from is not the question");
  assert.equal(Math.round(ranked[0].atSec - CLIP_START), -60);
});

test("a template that opens on the comment finds it, draws it, and holds the hook until it goes", { timeout: 180_000 }, async () => {
  await registry.saveTemplate({ id: "chat-open", extends: "stream-short", name: "Chat open", outro: { enabled: false },
    layout: { mode: "crop" }, comment: { enabled: true, seconds: 3 } });
  const { id, sequenceId } = await project();
  const plan = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "chat-open", sequenceId }) as import("../../templates/server/plan").TemplatePlan;
  assert.equal(plan.comment?.name, "evvvaaan", "the dry run says which comment it would open on");

  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "chat-open", sequenceId, expectedRevision: store.readEditor(id).revision });
  const comment = layers(id, sequenceId).find((item) => item.clip.title === "Comment")!;
  assert.ok(comment, "the video opens on a comment layer");
  assert.equal(comment.at, 0);
  assert.equal(comment.clip.end - comment.clip.start, 3);
  assert.equal(comment.keyframes?.length, 4, "it arrives and leaves with keyframes both editors can change");
  const image = comment.clip.edits.find((edit) => edit.type === "image")!;
  const asset = database.q.getAsset(image.type === "image" ? image.src : "")!;
  assert.equal(asset.kind, "image");
  assert.match(asset.tags, /chat:1\b/, "the picture is the chosen message");
  assert.equal(hookStart(id, sequenceId), 3, "the hook comes in when the comment goes");

  // Applying again replaces the template's comment rather than stacking a second.
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "chat-open", sequenceId, expectedRevision: store.readEditor(id).revision });
  assert.equal(layers(id, sequenceId).filter((item) => item.clip.title === "Comment").length, 1);
});

test("a clip nobody asked about opens on its hook, and says why", async () => {
  const { id, sequenceId } = await project(speak("Hoy vamos a hablar de bases de datos y de índices."));
  const result = await tools.executeEditorTool(id, { tool: "template.apply", templateId: "chat-open", sequenceId, expectedRevision: store.readEditor(id).revision }) as { plan: import("../../templates/server/plan").TemplatePlan };
  assert.equal(layers(id, sequenceId).some((item) => item.clip.title === "Comment"), false);
  assert.equal(hookStart(id, sequenceId), 0);
  assert.ok(result.plan.warnings.some((w) => /No comment to open on/.test(w)), result.plan.warnings.join(" | "));
});

test("choosing the comment by hand is the same layer, and a template applied after keeps it", { timeout: 180_000 }, async () => {
  const { id, sequenceId } = await project();
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "chat-open", sequenceId, expectedRevision: store.readEditor(id).revision });

  const listed = await tools.executeEditorTool(id, { tool: "comments.list", sequenceId }) as import("../server/place").CommentChoices;
  assert.equal(listed.comments[0].name, "evvvaaan");
  assert.equal(listed.comments[0].answers, true);
  assert.ok(listed.current, "the panel sees the comment the template placed");

  // None: the comment goes and the hook moves back to the first frame.
  await tools.executeEditorTool(id, { tool: "comments.place", sequenceId, commentId: "none", expectedRevision: store.readEditor(id).revision });
  assert.equal(layers(id, sequenceId).some((item) => item.clip.title === "Comment"), false);
  assert.equal(hookStart(id, sequenceId), 0);

  // Another message, chosen by hand, for four seconds.
  const other = listed.comments.find((c) => c.name === "@otro")!;
  await tools.executeEditorTool(id, { tool: "comments.place", sequenceId, commentId: other.id, seconds: 4, expectedRevision: store.readEditor(id).revision });
  const chosen = layers(id, sequenceId).filter((item) => item.clip.title === "Comment");
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].clip.end - chosen[0].clip.start, 4);
  assert.equal(hookStart(id, sequenceId), 4);

  // A person's choice outlives the template: re-applied, it neither replaces it nor adds one.
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "chat-open", sequenceId, expectedRevision: store.readEditor(id).revision });
  const after = layers(id, sequenceId).filter((item) => item.clip.title === "Comment");
  assert.equal(after.length, 1);
  assert.equal(after[0].id, chosen[0].id);
  assert.equal(hookStart(id, sequenceId), 4, "and the hook still waits for it");
});

// ─── the pop: the comment bursts in while it is read out ─────────────────────

test("the reading is found in the words, and the card is timed to it without eating the opening beat", async () => {
  const { popWindow } = await import("../../templates/lib/comment");
  const { Clip } = await import("../../editor/types");
  const reading = comments.readingSpan(WORDS, "Recomendaciones para primer saas?")!;
  assert.equal(reading.t, 0.2);
  assert.ok(Math.abs(reading.d - 1.54) < 1e-9, "from the first of its words said to the end of the last");
  assert.equal(comments.readingSpan(WORDS, "que estas creando"), null, "never said, never timed");
  // The answer uses the question's words again; that is the answer, not more of the reading.
  const answered = [...speak("¿Pagas Claude? Dice Willman.", 0.6), ...speak("Pago la suscripción de Claude.", 2.6)];
  const pagas = comments.readingSpan(answered, "pagas claude?")!;
  assert.equal(pagas.t, 0.6);
  assert.ok(Math.abs(pagas.t + pagas.d - (1.0 + 0.34)) < 1e-9, `ends on the first "Claude", not the second: ${JSON.stringify(pagas)}`);

  const sequence = { id: "s", title: "S", output: { width: 1080, height: 1920, fps: 30 }, plan: undefined as never,
    items: [{ id: "shot", mediaId: "m", at: 0, layer: 0, clip: Clip.parse({ id: "shot", title: "Shot", start: 0, end: 20 }) }] } as never;
  const look = { delaySec: 0.6, seconds: 2.4, followReading: true };
  const body = { start: 0, end: 20 };
  // Read from the first word: it still waits half a second, and holds at least 2.4 s.
  assert.deepEqual(popWindow(sequence, look, body, { itemId: "shot", t: 0.2, d: 1.5 }), { at: 0.6, end: 3 });
  // Read later and longer: it lands on the first word and leaves just after the last.
  const late = popWindow(sequence, look, body, { itemId: "shot", t: 1.2, d: 3.5 });
  assert.equal(late.at, 1.2);
  assert.ok(Math.abs(late.end - 5) < 1e-9, `${late.end}`);
  // Not read at all: the template's own beat.
  assert.deepEqual(popWindow(sequence, look, body, null), { at: 0.6, end: 3 });
});

test("a pop comment lands over the hook and a blurred frame with its sound, and either editor can switch it", { timeout: 180_000 }, async () => {
  await registry.saveTemplate({ id: "chat-pop", extends: "stream-short", name: "Chat pop", outro: { enabled: false },
    layout: { mode: "crop" }, rhythm: { silence: { enabled: false } },
    comment: { enabled: true, style: "pop", card: "chat", seconds: 2.4, delaySec: 0.6, blur: 24, sound: { enabled: true, starter: "bubble" } } });
  const { id, sequenceId } = await project();
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "chat-pop", sequenceId, expectedRevision: store.readEditor(id).revision });

  const all = layers(id, sequenceId);
  const comment = all.find((item) => item.clip.title === "Comment")!;
  assert.ok(Math.abs((comment.at ?? 0) - 0.6) < 0.01, `lands at ${comment.at}`);
  assert.ok(Math.abs(comment.clip.end - comment.clip.start - 2.4) < 0.01, "held while it is read, at least 2.4 s");
  // It arrives in a tenth of a second from a little to the right, out of focus and half-seen,
  // and leaves into focus lost the same way — at full size throughout.
  const keys = comment.keyframes!;
  assert.equal(keys.length, 4);
  assert.deepEqual([keys[0].x, keys[0].opacity, keys[1].t, keys[1].x, keys[1].opacity], [8, 0.45, 0.1, 0, 1]);
  assert.ok(keys.every((key) => key.width === 100), "a pop never grows in; that is the open style");
  const ramps = comment.clip.edits.filter((edit) => edit.type === "blur").map((edit) => edit.type === "blur" ? [edit.ramp, +edit.t.toFixed(2), +edit.d.toFixed(2)] : null);
  assert.deepEqual(ramps, [["out", 0, 0.1], ["in", 2.3, 0.1]], "sharp by its third frame, blurred away on its last");
  const image = comment.clip.edits.find((edit) => edit.type === "image")!;
  assert.match(database.q.getAsset(image.type === "image" ? image.src : "")!.tags, /look:chat/, "drawn as the dark chat bubble");
  const pop = comment.clip.edits.find((edit) => edit.type === "sfx")!;
  assert.equal(pop.t, 0, "the sound is on the frame it lands");
  assert.equal(database.q.getAsset(pop.type === "sfx" ? pop.src : "")!.name, "Bubble");

  assert.equal(hookStart(id, sequenceId), 0, "the hook is there from the first frame and never waits");
  const blurOf = (title: string) => all.find((item) => item.clip.title === title)!.clip.edits.filter((edit) => edit.type === "blur");
  const footage = all.find((item) => item.mediaId)!;
  const [under] = footage.clip.edits.filter((edit) => edit.type === "blur");
  assert.ok(under && Math.abs(under.t - 0.6) < 0.01 && Math.abs(under.d - 2.4) < 0.01, `the footage blurs under it: ${JSON.stringify(under)}`);
  assert.equal(blurOf("Hook").length, 1, "and so does the hook");
  assert.ok(blurOf("Comment").every((edit) => edit.type === "blur" && edit.ramp !== "hold"), "the card is never held blurred — only its arrival and exit");

  const listed = await tools.executeEditorTool(id, { tool: "comments.list", sequenceId }) as import("../server/place").CommentChoices;
  assert.equal(listed.current?.style, "pop");
  assert.equal(listed.current?.commentId, 1);

  // The panel's other style, on the same message: it opens the video, and the blur goes with the pop.
  await tools.executeEditorTool(id, { tool: "comments.place", sequenceId, commentId: 1, style: "open", expectedRevision: store.readEditor(id).revision });
  const opened = layers(id, sequenceId);
  assert.equal(opened.find((item) => item.clip.title === "Comment")!.keyframes?.length, 4);
  assert.equal(opened.flatMap((item) => item.clip.edits).filter((edit) => edit.type === "blur").length, 0);
  assert.ok(hookStart(id, sequenceId) > 2, "an opening comment holds the hook back");

  // And back, by hand: the same pop the template makes, with its blur and its sound.
  await tools.executeEditorTool(id, { tool: "comments.place", sequenceId, commentId: 1, style: "pop", expectedRevision: store.readEditor(id).revision });
  const popped = layers(id, sequenceId);
  const again = popped.find((item) => item.clip.title === "Comment")!;
  assert.ok(Math.abs((again.at ?? 0) - 0.6) < 0.01);
  assert.equal(again.keyframes?.length, 4);
  assert.ok(again.keyframes!.every((key) => key.width === 100));
  assert.ok(again.clip.edits.some((edit) => edit.type === "sfx"));
  assert.ok(popped.find((item) => item.mediaId)!.clip.edits.some((edit) => edit.type === "blur" && edit.by === "comment"));
  assert.equal(hookStart(id, sequenceId), 0);

  // A template applied after keeps the person's pop, and does not hold the hook for it.
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "chat-pop", sequenceId, expectedRevision: store.readEditor(id).revision });
  const kept = layers(id, sequenceId);
  assert.equal(kept.filter((item) => item.clip.title === "Comment").length, 1);
  assert.equal(kept.find((item) => item.clip.title === "Comment")!.id, again.id);
  assert.equal(kept.filter((item) => item.clip.title === "Hook").length, 1, "one hook, not the old one emptied beside a new one");
  const layerOf = (title: string) => kept.find((item) => item.clip.title === title)!.layer ?? 0;
  assert.ok(layerOf("Comment") > layerOf("Hook"), "the card is read over the hook, not under it");
  assert.equal(hookStart(id, sequenceId), 0);
  const blurs = kept.flatMap((item) => item.clip.edits.map((edit) => ({ title: item.clip.title, edit }))).filter(({ edit }) => edit.type === "blur");
  const held = blurs.filter(({ edit }) => edit.type === "blur" && edit.ramp === "hold");
  assert.deepEqual(held.map(({ title }) => title).sort(), ["Corte", "Hook"], "the blur is still under their card, on the new hook too, once each");
  assert.equal(blurs.filter(({ title }) => title === "Comment").length, 2, "and their card keeps its own arrival and exit");
});

// ─── the chat's own export: its cards, and what the selection agent is shown ─

test("a chat export is a chat, its drawn cards are the comment cards, and the selection sees what was read out", { timeout: 180_000 }, async () => {
  const exportDir = path.join(workspace, "export");
  await fs.mkdir(path.join(exportDir, "cards"), { recursive: true });
  const card = path.join(exportDir, "cards", "001-501.png");
  const drawn = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=c=0x18181b@1:size=900x300,format=rgba", "-frames:v", "1", card], { encoding: "utf8" });
  assert.equal(drawn.status, 0, drawn.stderr);
  const at = (sec: number) => LIVE + sec * 1000;
  const message = (id: number, sec: number, text: string, extra: Record<string, unknown> = {}) => ({
    id, type: "chat", platform: "youtube", text, time: { ts: at(sec) }, image: `cards/001-${id}.png`,
    user: { handle: "@evan", nickname: "Evan", avatar: "", is_bot: false }, ...extra,
  });
  await fs.writeFile(path.join(exportDir, "messages.json"), JSON.stringify({ messages: [
    message(501, CLIP_START - 60, "Recomendaciones para primer saas?"),
    message(502, CLIP_START - 30, "hola a todos"),
    message(503, CLIP_START - 20, "compra ya", { user: { nickname: "bot", is_bot: true } }),
    { id: 504, type: "gift", platform: "tiktok", text: null, time: { ts: at(CLIP_START) } },
  ] }));
  // The panel's and the agent's `chat.setSource` is this function: a folder is accepted like a database.
  comments.saveChatSource(exportDir);
  try {
    const read = comments.readComments(exportDir, at(0), at(200));
    assert.deepEqual(read.map((c) => c.id), [501, 502], "chat from people only: no bot, no gift");

    // The selection agent is shown the chat on the video's clock, read-outs first.
    const { readOuts, chatText } = await import("../server/read-out");
    const words = WORDS.map((w) => ({ ...w, t: w.t + CLIP_START }));
    const chat = readOuts(LIVE, 115, words);
    const evan = chat.find((c) => c.id === 501)!;
    assert.ok(evan.readSec !== null && Math.abs(evan.readSec - (CLIP_START + 0.2)) < 0.01, `read at ${evan.readSec}`);
    assert.equal(chat.find((c) => c.id === 502)!.readSec, null, "a greeting nobody reads out is not a read-out");
    const text = chatText(chat);
    assert.match(text, /# Read out loud on stream \(1\)\n- read at 100\.2s \(sent 40s\) · id 501 · youtube · Evan: Recomendaciones/);
    const { buildSelectPrompt } = await import("../../clipping/lib/prompt");
    const { SelectionSpec } = await import("../../clipping/types");
    const prompt = buildSelectPrompt({ probe: { width: 1920, height: 1080, fps: 30, durationSec: 115 } as never, spec: SelectionSpec.parse({ output: { width: 1080, height: 1920, fps: 30 } }), userBrief: "", hasFrames: false, chunks: [], chat: { read: 1, total: 2 } });
    assert.match(prompt, /chat\.txt/);
    assert.match(prompt, /The chat is where most of the clips are/);

    // And the card the export drew is the card the video shows.
    await registry.saveTemplate({ id: "chat-export", extends: "stream-short", name: "Chat export", outro: { enabled: false }, layout: { mode: "crop" },
      comment: { enabled: true, style: "pop", card: "chat" } });
    const { id, sequenceId } = await project();
    await tools.executeEditorTool(id, { tool: "template.apply", templateId: "chat-export", sequenceId, expectedRevision: store.readEditor(id).revision });
    const layer = layers(id, sequenceId).find((item) => item.clip.title === "Comment")!;
    const image = layer.clip.edits.find((edit) => edit.type === "image")!;
    const asset = database.q.getAsset(image.type === "image" ? image.src : "")!;
    assert.match(asset.tags, /chat:501\b.*look:export/, asset.tags);
    assert.equal(await fs.readFile(path.join(workspace, asset.path)).then((b) => b.length), (await fs.readFile(card)).length, "the export's own picture, byte for byte");
  } finally {
    comments.saveChatSource("");
  }
});
