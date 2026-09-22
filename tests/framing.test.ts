import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin";

/**
 * Framing is what a template says about a screen-share stream: the middle of the frame
 * is wallpaper, the person is in a corner, and a centre crop of it is neither. These
 * check the one thing that cannot be seen from a JSON document — that the rectangles a
 * template carries as fractions become the right pixels on whatever was recorded.
 */

let workspace: string;
let source: string;
let store: typeof import("../src/lib/editor/store");
let mediaService: typeof import("../src/lib/editor/media");
let tools: typeof import("../src/lib/editor/tools");
let database: typeof import("../src/lib/db");
let planner: typeof import("../src/lib/templates/plan");
let registry: typeof import("../src/lib/templates/registry");
let schema: typeof import("../src/lib/templates/schema");

function speak(sentences: string[], gap = 0.5) {
  const words: Array<{ t: number; d: number; w: string }> = [];
  let t = 0;
  for (const sentence of sentences) {
    for (const word of sentence.split(/\s+/)) { words.push({ t, d: 0.34, w: word }); t += 0.4; }
    t += gap;
  }
  return words;
}

const SCRIPT = [
  "Hoy vamos a conectar el editor con el agente.",
  "La parte dificil es que los dos escriban lo mismo.",
  "Y eso es lo que vamos a probar ahora.",
];

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-framing-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, mediaService, tools, database, planner, registry, schema] = await Promise.all([
    import("../src/lib/editor/store"), import("../src/lib/editor/media"), import("../src/lib/editor/tools"),
    import("../src/lib/db"), import("../src/lib/templates/plan"), import("../src/lib/templates/registry"),
    import("../src/lib/templates/schema"),
  ]);
  const { brandIndex, resetBrandIndex } = await import("../src/lib/search/brand");
  resetBrandIndex();
  await fs.mkdir(path.join(workspace, "cache"), { recursive: true });
  await fs.writeFile(path.join(workspace, "cache", "brands.json"), JSON.stringify([]));
  await brandIndex();
  // A stream's own shape: wider than tall, and not 16:9 — a window, not a camera.
  source = path.join(workspace, "stream.mp4");
  const result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=navy:size=1728x1116:rate=15:duration=20",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=20", "-pix_fmt", "yuv420p", "-shortest", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

const SPLIT = {
  id: "stream-split", name: "Stream split", extends: "talking-head",
  captions: { preset: "popline", positionY: 0.6, fontSizePct: 5, maxWordsPerLine: 3 },
  layout: {
    mode: "split", cameraPosition: "bottom", cameraPct: 32,
    screen: { x: 0, y: 0, w: 1, h: 0.76 },
    camera: { x: 0.68, y: 0.74, w: 0.32, h: 0.26 },
  },
};

async function project(title = "Framing") {
  const { id } = await mediaService.createVideoProject(title, [{ file: source }]);
  const snapshot = store.readEditor(id);
  const sequence = snapshot.edl.sequences[0];
  store.editProject(id, {
    expectedRevision: snapshot.revision,
    operations: [{ type: "item.patch", sequenceId: sequence.id, itemId: sequence.items[0].id,
      patch: { title: "Stream", hook: "Como conectamos el editor", start: 0, end: 20, words: speak(SCRIPT) } }],
  });
  return { id, sequenceId: sequence.id, itemId: sequence.items[0].id };
}

test("a rectangle given as a share of the frame becomes the pixels of whatever was recorded", () => {
  const template = schema.VideoTemplate.parse(SPLIT);
  const layout = planner.layoutFor(template, { width: 1728, height: 1116 })!;
  assert.equal(layout.type, "split");
  if (layout.type !== "split") return;
  // The camera is at the bottom, so the screen is the top pane and the seam is its share.
  assert.deepEqual(layout.top, { x: 0, y: 0, w: 1728, h: 848 });
  assert.deepEqual(layout.bottom, { x: 1175, y: 826, w: 553, h: 290 });
  assert.equal(layout.topPct, 68);
  assert.equal(layout.camera, "bottom");

  // The same document on a different recording frames the same thing.
  const hd = planner.layoutFor(template, { width: 1920, height: 1080 })!;
  if (hd.type !== "split") return assert.fail("split");
  assert.deepEqual(hd.bottom, { x: 1306, y: 799, w: 614, h: 281 });
  assert.equal(hd.topPct, 68);

  // Camera on top: the panes swap and the seam follows the camera's share.
  const onTop = planner.layoutFor(schema.VideoTemplate.parse({ ...SPLIT, layout: { ...SPLIT.layout, cameraPosition: "top", cameraPct: 40 } }), { width: 1728, height: 1116 })!;
  if (onTop.type !== "split") return assert.fail("split");
  assert.equal(onTop.topPct, 40);
  assert.equal(onTop.camera, "top");
  assert.deepEqual(onTop.top, { x: 1175, y: 826, w: 553, h: 290 });

  // A rectangle that runs off the edge is pulled back inside it rather than cropping to nothing.
  const over = planner.layoutFor(schema.VideoTemplate.parse({ ...SPLIT, layout: { ...SPLIT.layout, camera: { x: 0.9, y: 0.9, w: 0.3, h: 0.3 } } }), { width: 1000, height: 1000 })!;
  if (over.type !== "split") return assert.fail("split");
  assert.deepEqual(over.bottom, { x: 700, y: 700, w: 300, h: 300 });

  // Nothing to say, nothing written: the shot keeps its own framing.
  assert.equal(planner.layoutFor(schema.VideoTemplate.parse({ id: "x", name: "X" }), { width: 1728, height: 1116 }), null);
  assert.deepEqual(planner.layoutFor(schema.VideoTemplate.parse({ id: "x", name: "X", layout: { mode: "crop" } }), { width: 1728, height: 1116 }), { type: "crop" });
  // A canvas scene has no footage to frame.
  assert.equal(planner.layoutFor(template, null), null);
});

test("a split template frames every shot it is applied to, and applying it again changes nothing", async () => {
  await registry.saveTemplate(SPLIT);
  const { id, sequenceId, itemId } = await project();
  const first = await tools.executeEditorTool(id, { tool: "template.apply", templateId: "stream-split", sequenceId, expectedRevision: store.readEditor(id).revision }) as { revision: number; plan: import("../src/lib/templates/plan").TemplatePlan };
  assert.deepEqual(first.plan.framing, { mode: "split", seam: 0.68, camera: "bottom" });
  const framed = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.id === itemId)!;
  assert.equal(framed.clip.layout.type, "split");
  if (framed.clip.layout.type !== "split") return;
  assert.equal(framed.clip.layout.topPct, 68);
  assert.equal(framed.clip.layout.camera, "bottom");
  assert.equal(framed.clip.layout.bottom.w, 553);

  // Convergence: the second apply has nothing to say about framing, so it writes no patch for it.
  const operations = await import("../src/lib/editor/operations");
  const edl = store.readEditor(id).edl;
  const plan = await planner.planTemplate(edl, schema.VideoTemplate.parse(SPLIT), { sequenceId });
  const ops = planner.templateOperations(edl, schema.VideoTemplate.parse(SPLIT), plan, new Map(), (p) => `${p}_again`);
  const patches = ops.filter((op) => op.type === "item.patch" && op.itemId === itemId) as Array<{ patch: Record<string, unknown> }>;
  assert.ok(patches.every((op) => !("layout" in op.patch)), "framing is written once, not on every apply");
  assert.ok(operations.applyOperations(edl, ops), "the rest of the template still applies");
});

test("a shot with no words is still framed, and a scene with no footage is left alone", async () => {
  const { id } = await mediaService.createVideoProject("Silent", [{ file: source }]);
  const snapshot = store.readEditor(id);
  const sequence = snapshot.edl.sequences[0];
  // A title card beside the footage: no media, nothing to frame.
  const added = store.editProject(id, {
    expectedRevision: snapshot.revision,
    operations: [{ type: "item.add", sequenceId: sequence.id, item: { id: "i_card", mediaId: null, layer: 1,
      clip: { id: "i_card", title: "Card", start: 0, end: 2, edits: [{ type: "text", t: 0, d: 2, text: "Hola", position: "center", style: "card", by: "" }] } } }],
  });
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "stream-split", sequenceId: sequence.id, expectedRevision: added.revision });
  const after = store.readEditor(id).edl.sequences[0];
  const footage = after.items.find((i) => i.mediaId)!;
  assert.equal(footage.clip.layout.type, "split", "footage with no transcript is framed anyway");
  assert.equal(after.items.find((i) => i.id === "i_card")!.clip.layout.type, "crop", "a canvas scene keeps the default framing");
});

test("a split with no camera rectangle is refused, and said in the dry run before it is", async () => {
  await registry.saveTemplate({ ...SPLIT, id: "no-camera", layout: { ...SPLIT.layout, camera: { x: 0.1, y: 0.1, w: 0, h: 0 } } });
  const { id, sequenceId } = await project("No camera");
  const dry = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "no-camera", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(dry.warnings.some((w) => w.includes("camera rectangle")), dry.warnings.join(" | "));
  await assert.rejects(
    tools.executeEditorTool(id, { tool: "template.apply", templateId: "no-camera", sequenceId, expectedRevision: store.readEditor(id).revision }),
    /camera rectangle/,
  );
});

test("captions that would be cut in half by the seam are called out before anything is rendered", async () => {
  await registry.saveTemplate({ ...SPLIT, id: "seam-captions", captions: { preset: "karaoke", positionY: 0.6, fontSizePct: 6, maxWordsPerLine: 3 } });
  const { id, sequenceId } = await project("Seam");
  const dry = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "seam-captions", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(dry.warnings.some((w) => w.includes("seam")), dry.warnings.join(" | "));

  const clear = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "stream-split", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(!clear.warnings.some((w) => w.includes("seam")), clear.warnings.join(" | "));
});

test("a template that says nothing about framing leaves a hand-made split exactly as it is", async () => {
  const { id, sequenceId, itemId } = await project("Hand framed");
  const mine = { type: "split" as const, top: { x: 10, y: 20, w: 300, h: 300 }, bottom: { x: 0, y: 0, w: 1728, h: 700 }, topPct: 45, camera: "top" as const };
  const framed = store.editProject(id, { expectedRevision: store.readEditor(id).revision,
    operations: [{ type: "item.patch", sequenceId, itemId, patch: { layout: mine } }] });
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "talking-head", sequenceId, expectedRevision: framed.revision });
  const after = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.id === itemId)!;
  assert.deepEqual(after.clip.layout, mine, "a caption-and-cuts template has no opinion about framing");
});

test("a webcam that would show up inside the screen pane as well is called out", async () => {
  const { VideoTemplate } = schema;
  const output = { width: 1080, height: 1920 };
  const media = { width: 1728, height: 1116 };
  // The whole frame as the screen: the crop keeps its middle, which reaches the camera.
  const whole = VideoTemplate.parse({ ...SPLIT, id: "whole-screen", layout: { ...SPLIT.layout, screen: { x: 0, y: 0, w: 1, h: 1 } } });
  assert.equal(planner.cameraShowsTwice(whole, media, output), true);
  // Stopping the screen where the camera starts is the fix, and it is the built-in's default.
  const narrowed = VideoTemplate.parse({ ...SPLIT, id: "narrow-screen", layout: { ...SPLIT.layout, screen: { x: 0, y: 0, w: 0.694, h: 1 } } });
  assert.equal(planner.cameraShowsTwice(narrowed, media, output), false);
  const builtIn = await registry.getTemplate("stream-short");
  assert.equal(planner.cameraShowsTwice(builtIn, media, output), false, "the shipped template does not fire its own warning");
  // A camera on the far side of a wide frame never reaches the middle either.
  const far = VideoTemplate.parse({ ...SPLIT, id: "far-camera", layout: { ...SPLIT.layout, screen: { x: 0, y: 0, w: 1, h: 1 }, camera: { x: 0, y: 0.8, w: 0.14, h: 0.2 } } });
  assert.equal(planner.cameraShowsTwice(far, media, output), false);

  await registry.saveTemplate({ ...SPLIT, id: "twice", layout: { ...SPLIT.layout, screen: { x: 0, y: 0, w: 1, h: 1 } } });
  const { id, sequenceId } = await project("Twice");
  const dry = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "twice", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(dry.warnings.some((w) => w.includes("appears twice")), dry.warnings.join(" | "));
});

test("every shot is framed against its own footage, whatever each one was recorded at", async () => {
  const second = path.join(workspace, "other.mp4");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=green:size=1920x1080:rate=15:duration=8",
    "-f", "lavfi", "-i", "sine=frequency=200:duration=8", "-pix_fmt", "yuv420p", "-shortest", second], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);

  const { id, sequenceId } = await project("Two sources");
  const imported = await tools.executeEditorTool(id, { tool: "media.import", file: second,
    expectedRevision: store.readEditor(id).revision, place: { sequenceId, at: null, layer: 0 } }) as { revision: number };
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "stream-split", sequenceId, expectedRevision: imported.revision });

  const items = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.filter((i) => i.mediaId);
  assert.equal(items.length, 2);
  const widths = items.map((i) => (i.clip.layout.type === "split" ? i.clip.layout.bottom.w : 0));
  assert.deepEqual(widths, [553, 614], "each shot's camera rectangle is in its own source's pixels");
  assert.ok(items.every((i) => i.clip.layout.type === "split" && i.clip.layout.topPct === 68));
});

test("the camera share has ends, and a rectangle pushed off the frame still has a rectangle", () => {
  const { VideoTemplate } = schema;
  for (const cameraPct of [15, 85]) {
    const layout = planner.layoutFor(VideoTemplate.parse({ ...SPLIT, id: "ends", layout: { ...SPLIT.layout, cameraPct } }), { width: 1728, height: 1116 })!;
    assert.equal(layout.type, "split");
    if (layout.type !== "split") continue;
    assert.equal(layout.topPct, 100 - cameraPct);
  }
  assert.throws(() => VideoTemplate.parse({ ...SPLIT, id: "too-small", layout: { ...SPLIT.layout, cameraPct: 14 } }));
  assert.throws(() => VideoTemplate.parse({ ...SPLIT, id: "too-big", layout: { ...SPLIT.layout, cameraPct: 86 } }));
  assert.throws(() => VideoTemplate.parse({ ...SPLIT, id: "off-frame", layout: { ...SPLIT.layout, camera: { x: 1.2, y: 0, w: 0.3, h: 0.3 } } }));

  // A camera rectangle that fills the frame is legal and stays inside it.
  const whole = planner.layoutFor(VideoTemplate.parse({ ...SPLIT, id: "whole", layout: { ...SPLIT.layout, camera: { x: 0, y: 0, w: 1, h: 1 } } }), { width: 640, height: 360 })!;
  if (whole.type !== "split") return assert.fail("split");
  assert.deepEqual(whole.bottom, { x: 0, y: 0, w: 640, h: 360 });

  // A frame smaller than the rounding: every rectangle keeps at least two pixels.
  const tiny = planner.layoutFor(VideoTemplate.parse({ ...SPLIT, id: "tiny", layout: { ...SPLIT.layout, camera: { x: 0.9, y: 0.9, w: 0.01, h: 0.01 } } }), { width: 100, height: 100 })!;
  if (tiny.type !== "split") return assert.fail("split");
  assert.ok(tiny.bottom.w >= 2 && tiny.bottom.h >= 2, JSON.stringify(tiny.bottom));
  assert.ok(tiny.bottom.x + tiny.bottom.w <= 100 && tiny.bottom.y + tiny.bottom.h <= 100, "and stays inside the frame");
});

test("an aspect variant can reframe: the same template, a different shape, its own split", async () => {
  await registry.saveTemplate({ ...SPLIT, id: "variant-split",
    variants: { "1:1": { layout: { cameraPct: 45 } }, "16:9": { layout: { mode: "crop" } } } });
  const { resolveTemplate } = await import("../src/lib/templates/resolve");
  const template = await registry.getTemplate("variant-split");
  assert.equal(resolveTemplate(template, { aspect: "9:16" }).layout.cameraPct, 32);
  assert.equal(resolveTemplate(template, { aspect: "1:1" }).layout.cameraPct, 45, "a square frame gives the person more of it");
  assert.equal(resolveTemplate(template, { aspect: "16:9" }).layout.mode, "crop", "a wide frame does not need a split at all");
  // The rectangles survive the merge rather than being replaced by the patch's absence.
  assert.equal(resolveTemplate(template, { aspect: "1:1" }).layout.camera.w, SPLIT.layout.camera.w);
});

test("a hook too long for its card is cut where a sentence lets go, not mid-thought", () => {
  const cut = (text: string, max = 10) => planner.shortenHook(text, max);
  // The question is the hook; the line around it is the lead-up.
  assert.equal(cut("Voy en el primer semestre. ¿Aún recomiendas aprender a programar o ya que lo haga la IA?").text,
    "¿Aún recomiendas aprender a programar o ya que lo haga la IA?");
  // A clause boundary, when there is no question to prefer.
  assert.deepEqual(cut("Realmente es difícil, yo que estoy construyendo eso, a veces notar cosas que son IA y cosas que no."),
    { text: "Realmente es difícil, yo que estoy construyendo eso", shortened: true });
  // A line a little over the limit reads fine on a card; mangling it does not.
  assert.deepEqual(cut("¿Notas alguna diferencia entre hacer prompts en inglés y en español?"),
    { text: "¿Notas alguna diferencia entre hacer prompts en inglés y en español?", shortened: false });
  // A line under the limit is left alone, minus a trailing comma.
  assert.deepEqual(cut("¿Qué es un Harness?"), { text: "¿Qué es un Harness?", shortened: false });
  assert.deepEqual(cut("Una cosa muy buena,"), { text: "Una cosa muy buena", shortened: false });
  // Nothing to cut at, and far too long: the word, with a mark saying so.
  const long = cut("uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis");
  assert.equal(long.text, "uno dos tres cuatro cinco seis siete ocho nueve diez…");
  assert.equal(long.shortened, true);
  // A first clause that gives back one word is not a hook; the rest of the rules decide.
  assert.equal(cut("Mira, te voy a dar el contexto de cómo eligen a alguien en Big Tech.").text,
    "Mira, te voy a dar el contexto de cómo eligen a alguien en Big Tech");
  assert.deepEqual(cut(""), { text: "", shortened: false });
  assert.deepEqual(cut("   uno   dos   tres  ", 1), { text: "uno…", shortened: true });
  // One word over a one-word limit still reads on a card, so it is left whole.
  assert.deepEqual(cut("uno dos", 1), { text: "uno dos", shortened: false });
});

test("the dry run says when the hook it will draw is not the hook that was written", async () => {
  const { id, sequenceId, itemId } = await project("Long hook");
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "item.patch", sequenceId, itemId, patch: { hook: "Realmente es difícil, yo que estoy construyendo eso, a veces notar cosas que son de IA y cosas que no." } },
  ] });
  const dry = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "stream-split", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(dry.hook?.shortened, true);
  assert.equal(dry.hook?.text, "Realmente es difícil, yo que estoy construyendo eso");
  assert.ok(dry.warnings.some((w) => w.includes("longer than the")), dry.warnings.join(" | "));

  const short = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "stream-split", sequenceId, hookText: "¿Y si no era IA?" }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(short.hook?.shortened, false);
  assert.ok(!short.warnings.some((w) => w.includes("longer than the")));
});

test("a template replaces the draft the clip selection made, and leaves a hand edit alone", async () => {
  const { id, sequenceId, itemId } = await project("Draft");
  const mine = { type: "text" as const, t: 1, d: 2, text: "Mía", position: "bottom" as const, x: null, y: null, style: "plain" as const, by: "" };
  const theirs = [
    { type: "text" as const, t: 0.4, d: 2.6, text: "Entrar a Big Tech", position: "top" as const, x: null, y: null, style: "card" as const, by: "select" },
    { type: "punch" as const, t: 3, d: 1.2, scale: 1.2, by: "select" },
    { type: "silence" as const, t: 6, d: 0.8, by: "select" },
  ];
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "item.patch", sequenceId, itemId, patch: { edits: [...theirs, mine] } },
  ] });

  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "stream-split", sequenceId, expectedRevision: store.readEditor(id).revision });
  const shot = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.id === itemId)!;
  const byAuthor = shot.clip.edits.reduce((acc: Record<string, number>, e) => ({ ...acc, [e.by || "hand"]: (acc[e.by || "hand"] ?? 0) + 1 }), {});
  assert.equal(byAuthor.select, undefined, "the selection's first draft is gone, not stacked under the template's");
  assert.equal(byAuthor.hand, 1, "the title someone placed by hand survives");
  const kept = shot.clip.edits.find((e) => e.by === "");
  assert.ok(kept && kept.type === "text" && kept.text === "Mía");
  assert.ok((byAuthor["template:stream-split"] ?? 0) > 1, "and the template wrote its own");
  // Exactly one title on screen: the hook, on its own layer.
  const titles = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items
    .flatMap((i) => i.clip.edits.filter((e) => e.type === "text" && e.position === "top"));
  assert.equal(titles.length, 1, "the hook is the only card at the top");
  const { describeAuthor } = await import("../src/lib/editor/authorship");
  assert.match(describeAuthor("select"), /cut out of the recording/);
});

test("the pace of a finished video is measurable, and the settings that reproduce it are findable", async () => {
  const pace = await import("../src/lib/templates/pace");
  // A finished video that keeps its pauses: four of them over a third of a second.
  const finished = [
    ...["una", "cosa", "que", "nadie", "dice"].map((w, i) => ({ t: i * 0.4, d: 0.3, w })),
    ...["es", "que", "esto", "tarda"].map((w, i) => ({ t: 2.6 + i * 0.4, d: 0.3, w })),
    ...["muchisimo", "mas", "de", "lo", "que", "crees"].map((w, i) => ({ t: 5 + i * 0.4, d: 0.3, w })),
    ...["y", "eso", "cambia", "todo"].map((w, i) => ({ t: 8.2 + i * 0.4, d: 0.3, w })),
  ];
  const target = pace.gapProfile(finished);
  assert.ok(Math.abs(target.median - 0.1) < 0.02, `word spacing is the median, not the pauses: ${target.median}`);
  assert.ok(target.p95 > 0.5, `the pauses are in the tail: ${target.p95}`);
  assert.ok(target.perMinute > 15, `${target.perMinute.toFixed(1)} pauses a minute`);
  assert.equal(pace.gapProfile([]).perMinute, 0, "nothing said is no pace at all");
  assert.equal(pace.gapProfile([{ t: 0, d: 0.3, w: "sola" }]).spanSec, 0);

  // The same speech with three seconds of thinking in the middle of it.
  const raw = finished.map((w, i) => (i < 9 ? w : { ...w, t: w.t + 3 }));
  const material = [{ words: raw, durationSec: 16 }];
  const wide = pace.profileAfterCuts(raw, { enabled: true, minGapSec: 5, keepSec: 0.3, maxGapSec: 30 }, 16);
  assert.ok(wide.p95 > 2, "a threshold nothing reaches leaves the thinking in");
  const tight = pace.profileAfterCuts(raw, { enabled: true, minGapSec: 0.3, keepSec: 0.1, maxGapSec: 30 }, 16);
  assert.ok(tight.perMinute === 0, "and a threshold everything reaches leaves no pause at all");

  const fit = pace.fitSilence(target, material);
  assert.ok(fit.minGapSec >= 0.8 && fit.minGapSec <= 2, `the three-second hole is what it should cut: ${fit.minGapSec}`);
  assert.ok(fit.profile.perMinute > 0, "and the pauses the finished video keeps survive it");
  assert.ok(fit.distance < pace.fitSilence(target, material).distance + 0.001, "the search is deterministic");
});
