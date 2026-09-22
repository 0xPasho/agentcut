import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { FFMPEG } from "../src/lib/bin";

/**
 * A stream short opens on the comment it answers. The chat is a real SQLite file in the
 * unified chat's own shape, the recording carries the moment it went live, and the clip
 * says the question out loud — which is how the template knows which message it is.
 */

let workspace: string;
let source: string;
let store: typeof import("../src/lib/editor/store");
let mediaService: typeof import("../src/lib/editor/media");
let tools: typeof import("../src/lib/editor/tools");
let database: typeof import("../src/lib/db");
let registry: typeof import("../src/lib/templates/registry");
let comments: typeof import("../src/lib/chat/comments");

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
    import("../src/lib/editor/store"), import("../src/lib/editor/media"), import("../src/lib/editor/tools"),
    import("../src/lib/db"), import("../src/lib/templates/registry"), import("../src/lib/chat/comments"),
  ]);
  const { resetBrandIndex, brandIndex } = await import("../src/lib/search/brand");
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
  const { probe } = await import("../src/lib/media");
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
  const plan = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "chat-open", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
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
  const result = await tools.executeEditorTool(id, { tool: "template.apply", templateId: "chat-open", sequenceId, expectedRevision: store.readEditor(id).revision }) as { plan: import("../src/lib/templates/plan").TemplatePlan };
  assert.equal(layers(id, sequenceId).some((item) => item.clip.title === "Comment"), false);
  assert.equal(hookStart(id, sequenceId), 0);
  assert.ok(result.plan.warnings.some((w) => /No comment to open on/.test(w)), result.plan.warnings.join(" | "));
});

test("choosing the comment by hand is the same layer, and a template applied after keeps it", { timeout: 180_000 }, async () => {
  const { id, sequenceId } = await project();
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "chat-open", sequenceId, expectedRevision: store.readEditor(id).revision });

  const listed = await tools.executeEditorTool(id, { tool: "comments.list", sequenceId }) as import("../src/lib/chat/place").CommentChoices;
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
