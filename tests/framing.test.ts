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
