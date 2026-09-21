import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin";

let workspace: string;
let database: typeof import("../src/lib/db");
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-templates-render-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  database = await import("../src/lib/db");
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

function ffmpeg(args: string[]) {
  const result = spawnSync(FFMPEG, ["-v", "error", ...args]);
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
/** One averaged pixel, so a single antialiased edge cannot flip an assertion. */
function pixel(file: string, sec: number, x: number, y: number) {
  return [...ffmpeg(["-ss", String(sec), "-i", file, "-frames:v", "1", "-vf", `crop=8:8:${x}:${y},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])];
}
const near = (actual: number[], expected: number[], tolerance = 40) =>
  actual.length === 3 && actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);

const SCRIPT = [
  "Google changed how ranking works this year.",
  "That is the part everyone keeps getting wrong.",
  "Facebook rebuilt its feed around the same idea.",
  "It took them about four years to ship it.",
  "Nvidia sells the hardware underneath all of it.",
  "And that is why the numbers look the way they do.",
];
function speak(sentences: string[], gap = 0.9) {
  const words: Array<{ t: number; d: number; w: string }> = [];
  let t = 0;
  for (const sentence of sentences) {
    for (const word of sentence.split(/\s+/)) { words.push({ t, d: 0.34, w: word }); t += 0.42; }
    t += gap;
  }
  return words;
}

test("a template renders its pictures, in pool order, only on the beats it planned", { timeout: 300_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { executeEditorTool } = await import("../src/lib/editor/tools");
  const { renderProject } = await import("../src/lib/editor/render");
  const { buildTimeMap, srcToOut } = await import("../src/lib/timeline");

  const source = path.join(workspace, "source.mp4");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=0x101820:size=360x640:rate=12:duration=30",
    "-f", "lavfi", "-i", "sine=frequency=220:duration=30", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);

  // Solid colours, so which picture landed where is decidable from the exported frames.
  const pool = path.join(workspace, "pool");
  await fs.mkdir(pool, { recursive: true });
  const colours: Array<[string, number[]]> = [["0xE6194B", [230, 25, 75]], ["0x3CB44B", [60, 180, 75]], ["0x4363D8", [67, 99, 216]]];
  // The third is a tall portrait crop: at 76% of a 1080px frame it would be 1960px
  // high in a 1920px frame, so it proves the height bound rather than the width one.
  const shapes = ["400x400", "400x400", "900x1900"];
  colours.forEach(([hex], index) =>
    ffmpeg(["-y", "-f", "lavfi", "-i", `color=${hex}:size=${shapes[index]}`, "-frames:v", "1", path.join(pool, `shot-${index + 1}.png`)]));

  const logo = path.join(workspace, "logo.png");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=0xF032E6:size=256x256", "-frames:v", "1", logo]);

  const { id } = await createVideoProject("Template render", [{ file: source }]);
  let snapshot = readEditor(id);
  const sequenceId = snapshot.edl.sequences[0].id;
  const itemId = snapshot.edl.sequences[0].items[0].id;
  const words = speak(SCRIPT);
  snapshot = editProject(id, { expectedRevision: snapshot.revision, operations: [{
    type: "item.patch", sequenceId, itemId,
    patch: { title: "Ranking", hook: "How ranking works", start: 0, end: Math.min(29, words.at(-1)!.t + 1), words },
  }] });

  const mark = await executeEditorTool(id, { tool: "assets.importLocal", file: logo }) as { id: string };
  await executeEditorTool(id, {
    tool: "template.apply", templateId: "explainer-broll", sequenceId, expectedRevision: snapshot.revision,
    slots: { screenshots: { folder: pool }, logo: { assetId: mark.id } },
    // Pool only: this test must not depend on a logo CDN or an image search being reachable.
    overrides: { images: { sources: ["slot"], durationSec: 2.2, y: 0.32, widthPct: 76, style: "plain" } },
  });

  const saved = readEditor(id);
  const sequence = saved.edl.sequences.find(s => s.id === sequenceId)!;
  const shot = sequence.items.find(i => i.id === itemId)!;
  const images = shot.clip.edits.filter((e): e is Extract<typeof e, { type: "image" }> => e.type === "image");
  assert.ok(images.length >= 2, "the template placed pictures");
  assert.equal(images.length, new Set(images.map(i => i.src)).size, "each beat used the next picture in the folder");

  const map = buildTimeMap(shot.clip);
  const { outputs } = await renderProject(id, { only: [sequenceId] });
  const file = outputs[0].file;

  const { q } = await import("../src/lib/db");
  // Imported copies are uuid-named on disk; the asset keeps the original filename.
  const order = images.map(image => q.getAsset(image.src)!.name);
  const expected = order.map(name => colours[Number(/shot-(\d)/.exec(name)![1]) - 1][1]);
  assert.deepEqual(order, order.toSorted(), "the folder's own order is the order they appear in");

  images.forEach((image, index) => {
    const at = srcToOut(map, image.t + image.d / 2);
    assert.ok(near(pixel(file, at, 540, 614), expected[index]),
      `picture ${index + 1} should fill the overlay at ${at.toFixed(2)}s`);
    // Whatever its shape, an overlay stays inside the frame and out of the hook's band.
    assert.ok(!near(pixel(file, at, 540, 40), expected[index]),
      `picture ${index + 1} ran off the top of the frame`);
    assert.ok(!near(pixel(file, at, 540, 1880), expected[index]),
      `picture ${index + 1} ran off the bottom of the frame`);
  });

  // A gap between two planned beats stays bare — this is the whole point of the cadence.
  const first = srcToOut(map, images[0].t + images[0].d);
  const second = srcToOut(map, images[1].t);
  assert.ok(second - first > 0.6, "the planner left a real gap between pictures");
  const bare = pixel(file, (first + second) / 2, 540, 614);
  assert.ok(!expected.some(colour => near(bare, colour)), `nothing should be shown between beats, saw ${bare}`);

  // The hook is a layer of its own, so it survives every cut underneath it.
  const duration = shot.clip.end - shot.clip.start;
  const top = [0.4, map.duration / 2, Math.max(0.2, map.duration - 0.4)].map(t => pixel(file, t, 500, 200));
  assert.ok(top.every(colour => colour[0] > 150 && colour[1] > 150 && colour[2] > 150),
    `the hook card should be on screen for the whole video, saw ${JSON.stringify(top)}`);
  assert.ok(map.duration < duration - 0.5, "dead air was actually removed from the finished video");

  // The logo is held in its corner for the whole video, over every cut and every picture.
  // Bottom right of 1080x1920: centre x 0.90, y 0.926, so the mark covers (972, 1778).
  for (const at of [0.4, map.duration / 2, Math.max(0.2, map.duration - 0.4)]) {
    assert.ok(near(pixel(file, at, 968, 1774), [240, 50, 230], 50), `the logo should be in the corner at ${at.toFixed(2)}s, saw ${pixel(file, at, 968, 1774)}`);
  }
  assert.ok(!near(pixel(file, map.duration / 2, 120, 1774), [240, 50, 230], 50), "it belongs in one corner, not across the bottom");
  assert.ok(!near(pixel(file, map.duration / 2, 968, 137), [240, 50, 230], 50), "and not in the corner the sticky hook uses");
});
