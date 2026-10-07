import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../../../common/server/bin";

let workspace: string;
let database: typeof import("../../../common/server/db");
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-templates-render-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  database = await import("../../../common/server/db");
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

function ffmpeg(args: string[]) {
  // A whole band of a 1080-wide frame is megabytes of raw pixels, which is past the
  // default a child process may hand back.
  const result = spawnSync(FFMPEG, ["-v", "error", ...args], { maxBuffer: 1 << 28 });
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
  const { createVideoProject } = await import("../../media/server/media-import");
  const { readEditor, editProject } = await import("../../editor/server/store");
  const { executeEditorTool } = await import("../../editor/server/tools");
  const { renderProject } = await import("../../render/server/render-project");
  const { buildTimeMap, srcToOut } = await import("../../editor/lib/timeline");

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

  const { q } = await import("../../../common/server/db");
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

test("a split template puts the screen above the person, and pushes in on the person only", { timeout: 300_000 }, async () => {
  const { createVideoProject } = await import("../../media/server/media-import");
  const { readEditor, editProject } = await import("../../editor/server/store");
  const { executeEditorTool } = await import("../../editor/server/tools");
  const { renderProject } = await import("../../render/server/render-project");
  const { saveTemplate } = await import("../server/registry");

  // A stream's own shape, with the two things a split is about drawn into it: a band
  // across the top of the screen, and a webcam in the bottom-right corner with a band
  // across the top of *it*. Where each band lands in the output is the whole test.
  const source = path.join(workspace, "stream.mp4");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=0x102040:size=1728x1116:rate=12:duration=12",
    "-f", "lavfi", "-i", "sine=frequency=220:duration=12", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-vf", "drawbox=x=0:y=0:w=1728:h=279:color=0x8020A0@1:t=fill,drawbox=x=1200:y=806:w=528:h=310:color=0xE08020@1:t=fill,drawbox=x=1200:y=806:w=528:h=78:color=0x20A040@1:t=fill",
    source]);

  await saveTemplate({
    id: "render-split", name: "Render split", captions: { preset: "none" }, hook: { mode: "off" },
    images: { mode: "off" }, rhythm: { silence: { enabled: false }, punch: { enabled: false } },
    output: { width: 1080, height: 1920, fps: 12 },
    layout: { mode: "split", cameraPosition: "bottom", cameraPct: 32,
      screen: { x: 0, y: 0, w: 1, h: 1 }, camera: { x: 1200 / 1728, y: 806 / 1116, w: 528 / 1728, h: 310 / 1116 } },
  });

  const { id } = await createVideoProject("Split render", [{ file: source }]);
  const start = readEditor(id);
  const sequenceId = start.edl.sequences[0].id;
  const itemId = start.edl.sequences[0].items[0].id;
  await executeEditorTool(id, { tool: "template.apply", templateId: "render-split", sequenceId, expectedRevision: start.revision });

  // A push-in beat placed by hand, so the test does not depend on what the planner
  // would pick: the question is which pane moves, not which second it moves on.
  const framed = readEditor(id);
  editProject(id, { expectedRevision: framed.revision, operations: [{ type: "item.patch", sequenceId, itemId,
    patch: { edits: [{ type: "punch", t: 6, d: 2, scale: 1.3, by: "" }] } }] });

  const { outputs } = await renderProject(id, { only: [sequenceId] });
  const file = outputs[0].file;

  // Seam at 68% of 1920 = 1306. Above it the screen, below it the camera.
  assert.ok(near(pixel(file, 2, 540, 150), [128, 32, 160]), `the screen's own top band belongs at the top, saw ${pixel(file, 2, 540, 150)}`);
  assert.ok(near(pixel(file, 2, 540, 800), [16, 32, 64]), `the screen fills the rest of the top pane, saw ${pixel(file, 2, 540, 800)}`);
  assert.ok(near(pixel(file, 2, 540, 1380), [32, 160, 64]), `the camera's band sits just under the seam, saw ${pixel(file, 2, 540, 1380)}`);
  assert.ok(near(pixel(file, 2, 540, 1700), [224, 128, 32]), `the person fills the bottom pane, saw ${pixel(file, 2, 540, 1700)}`);
  // The seam itself: one row either side of 1306 is a different pane.
  assert.ok(near(pixel(file, 2, 540, 1290), [16, 32, 64]), "the last rows above the seam are still the screen");
  assert.ok(near(pixel(file, 2, 540, 1312), [32, 160, 64]), "and the first rows below it are already the camera");

  /** Where the green band ends, in output rows, inside a pane. */
  const bandEnds = (sec: number, from: number, to: number) => {
    let last = from;
    for (let y = from; y < to; y += 4) if (near(pixel(file, sec, 540, y), [32, 160, 64])) last = y;
    return last;
  };
  const still = bandEnds(2, 1310, 1600);
  const pushed = bandEnds(7, 1310, 1600);
  assert.ok(pushed < still - 20, `the push-in should be a move on the person: band ended at ${still} still, ${pushed} pushed`);

  // And the screen must hold: zooming the shared content lurches on every beat.
  const screenBand = (sec: number) => {
    let last = 0;
    for (let y = 4; y < 900; y += 4) if (near(pixel(file, sec, 540, y), [128, 32, 160])) last = y;
    return last;
  };
  assert.ok(Math.abs(screenBand(7) - screenBand(2)) <= 8, `the screen pane should not move, saw ${screenBand(2)} then ${screenBand(7)}`);
});

test("the whole stream look, read back out of the pixels: hook, the sentence being said, seam, and a clean end card", { timeout: 420_000 }, async () => {
  const { createVideoProject } = await import("../../media/server/media-import");
  const { readEditor, editProject } = await import("../../editor/server/store");
  const { executeEditorTool } = await import("../../editor/server/tools");
  const { renderProject } = await import("../../render/server/render-project");
  const { uploadLibraryAsset } = await import("../../media/server/assets");
  const { buildTimeMap, srcToOut } = await import("../../editor/lib/timeline");

  // A scene shaped like a stream: dark screen, webcam in the bottom-right corner.
  const source = path.join(workspace, "look-stream.mp4");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=0x102040:size=1728x1116:rate=12:duration=24",
    "-f", "lavfi", "-i", "sine=frequency=220:duration=24", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-vf", "drawbox=x=1200:y=806:w=528:h=310:color=0xE08020@1:t=fill", source]);
  // The card this channel ends on: its own shape, its own colour, its own sound.
  const cardFile = path.join(workspace, "look-card.mp4");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=0x1E9E4A:size=480x854:rate=12:duration=4",
    "-f", "lavfi", "-i", "sine=frequency=500:duration=4", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", cardFile]);
  const card = await uploadLibraryAsset("look-card.mp4", await fs.readFile(cardFile));

  const { id } = await createVideoProject("Stream look", [{ file: source }]);
  let snapshot = readEditor(id);
  const sequenceId = snapshot.edl.sequences[0].id;
  const itemId = snapshot.edl.sequences[0].items[0].id;
  // Words with a real pause in the middle: the pause is cut, and the silence either
  // side of a word is where a caption must not be.
  const words = [
    ...["hoy", "vamos", "a", "conectar", "el", "editor"].map((w, i) => ({ t: 1 + i * 0.6, d: 0.45, w })),
    ...["con", "el", "agente", "y", "eso", "es", "todo"].map((w, i) => ({ t: 9 + i * 0.6, d: 0.45, w })),
  ];
  snapshot = editProject(id, { expectedRevision: snapshot.revision, operations: [{
    type: "item.patch", sequenceId, itemId,
    patch: { title: "Stream", hook: "¿Y si el editor y el agente fueran el mismo?", start: 0, end: 20, words },
  }] });

  await executeEditorTool(id, {
    tool: "template.apply", templateId: "stream-short", sequenceId, expectedRevision: snapshot.revision,
    slots: { endcard: { assetId: card.id } },
    overrides: { output: { width: 1080, height: 1920, fps: 12 },
      layout: { camera: { x: 1200 / 1728, y: 806 / 1116, w: 528 / 1728, h: 310 / 1116 }, screen: { x: 0, y: 0, w: 1200 / 1728, h: 1 } } },
  });

  const saved = readEditor(id);
  const sequence = saved.edl.sequences.find((s) => s.id === sequenceId)!;
  const shot = sequence.items.find((i) => i.id === itemId)!;
  const map = buildTimeMap(shot.clip);
  const { sequenceFrames } = await import("../../editor/lib/sequences");
  const frames = sequenceFrames(sequence);
  const fps = sequence.output.fps;
  const outro = frames.items.find((e) => e.item.clip.title === "Outro")!;
  const body = outro.from / fps;
  const total = frames.duration / fps;
  assert.ok(Math.abs(total - body - 4) < 0.2, `the end card plays whole at the end: body ${body}, total ${total}`);

  const { outputs } = await renderProject(id, { only: [sequenceId] });
  const file = outputs[0].file;

  // The hook holds from the first frame of the body to its last, and is gone on the card.
  for (const at of [0.3, body / 2, body - 0.3]) {
    const seen = pixel(file, at, 540, 200);
    assert.ok(seen.every((c) => c > 200), `the hook card should be at the top at ${at.toFixed(2)}s, saw ${seen}`);
  }
  assert.ok(!pixel(file, body + 2, 540, 200).every((c) => c > 200), "and not over the end card");
  assert.ok(near(pixel(file, body + 2, 540, 960), [30, 158, 74], 45), `the end card fills the frame, saw ${pixel(file, body + 2, 540, 960)}`);
  assert.ok(near(pixel(file, body + 2, 540, 1700), [30, 158, 74], 45), "including where the camera pane was");

  // The seam: screen above, person below, at 68% of the frame. Sampled off-centre,
  // because the middle of those rows is where the caption is.
  assert.ok(near(pixel(file, 1, 120, 1200), [16, 32, 64]), `screen above the seam, saw ${pixel(file, 1, 120, 1200)}`);
  assert.ok(near(pixel(file, 1, 120, 1400), [224, 128, 32]), `person below it, saw ${pixel(file, 1, 120, 1400)}`);
  assert.ok(near(pixel(file, 1, 120, 1290), [16, 32, 64]), "the last rows above the seam are still the screen");
  assert.ok(near(pixel(file, 1, 120, 1320), [224, 128, 32]), "and the first rows below it are already the person");
  // The screen half stops where the webcam starts, so the person is not in it twice.
  for (const y of [300, 700, 1100]) {
    assert.ok(!near(pixel(file, 1, 900, y), [224, 128, 32], 60), `the webcam should not show through the screen half at y=${y}`);
  }

  /** How bright the caption band is: a white word on dark footage lifts it. */
  const band = (sec: number) => {
    const rgbv = [...ffmpeg(["-ss", String(sec), "-i", file, "-frames:v", "1", "-vf", "crop=1080:150:0:1160,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])];
    return (rgbv[0] + rgbv[1] + rgbv[2]) / 3;
  };
  const spoken = srcToOut(map, words[3].t + 0.2);
  const quiet = srcToOut(map, words[0].t - 0.6);
  assert.ok(band(spoken) > band(quiet) + 6, `a spoken word belongs in the caption band: ${band(spoken)} vs ${band(quiet)} when nobody is talking`);
  // The end card is brighter than the footage, so brightness says nothing there: what
  // says it is that the whole band is the card's own colour, with no white in it.
  for (const x of [200, 400, 540, 700, 880]) {
    assert.ok(near(pixel(file, body + 2, x, 1200), [30, 158, 74], 45),
      `the end card carries no captions, saw ${pixel(file, body + 2, x, 1200)} at x=${x}`);
  }

  // The pause between the two runs of words was cut out of the video.
  assert.ok(map.duration < 19, `dead air was removed: ${map.duration}s of 20`);
});

test("a word too long for the frame is drawn smaller, not drawn outside it", { timeout: 420_000 }, async () => {
  const { createVideoProject } = await import("../../media/server/media-import");
  const { readEditor, editProject } = await import("../../editor/server/store");
  const { executeEditorTool } = await import("../../editor/server/tools");
  const { renderProject } = await import("../../render/server/render-project");
  const { saveTemplate } = await import("../server/registry");

  // Black footage, so every bright pixel in the frame is something that was drawn on it.
  const source = path.join(workspace, "long-words.mp4");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=black:size=1728x1116:rate=12:duration=12",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=12", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);

  // Words a real transcript produces: a twenty-letter Spanish one, a spoken URL, and a
  // Japanese phrase that arrives as a single token.
  const words = [
    { t: 0.0, d: 1.2, w: "internacionalización" },
    { t: 1.4, d: 1.2, w: "https://github.com/pashoai/deska" },
    { t: 2.8, d: 1.2, w: "電気通信事業者協会" },
    { t: 4.2, d: 1.2, w: "corto" },
  ];
  const { id } = await createVideoProject("Long words", [{ file: source }]);
  const snapshot = readEditor(id);
  const sequenceId = snapshot.edl.sequences[0].id;
  const saved = editProject(id, { expectedRevision: snapshot.revision, operations: [{
    type: "item.patch", sequenceId, itemId: snapshot.edl.sequences[0].items[0].id,
    patch: { title: "Palabras largas", hook: "https://github.com/pashoai/deska", start: 0, end: 8, words },
  }] });
  await saveTemplate({ id: "long-words", extends: "stream-short", name: "Long words", outro: { enabled: false },
    output: { width: 1080, height: 1920, fps: 12 },
    layout: { camera: { x: 0.69, y: 0.72, w: 0.31, h: 0.28 }, screen: { x: 0, y: 0, w: 0.69, h: 1 } } });
  await executeEditorTool(id, { tool: "template.apply", templateId: "long-words", sequenceId, expectedRevision: saved.revision });
  await renderProject(id, { only: [sequenceId] });
  const rendered = JSON.parse(await fs.readFile(path.join(workspace, "projects", id, "rendered.json"), "utf8"));
  const file = path.join(workspace, "projects", id, "clips", rendered[sequenceId].file);

  /** The leftmost and rightmost drawn pixel inside a band of the frame. */
  const ink = (sec: number, top: number, bottom: number) => {
    const W = 1080, height = bottom - top;
    const data = ffmpeg(["-ss", String(sec), "-i", file, "-frames:v", "1",
      "-vf", `crop=${W}:${height}:0:${top}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    let left = W, right = -1, first = -1, last = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < W; x++) {
        const i = (W * y + x) * 3;
        if (data[i] > 140 && data[i + 1] > 140 && data[i + 2] > 140) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (first < 0) first = y;
          last = y;
        }
      }
    }
    return { left, right, top: top + first, bottom: top + last, tall: last - first };
  };

  // The caption block starts at 54.5% of the frame; the seam is at 68% of it, and the look
  // asks for letters 4.8% of the height tall, two rows of them at most.
  const seam = Math.round(1920 * 0.68);
  const lineHeight = 1920 * 0.048;
  for (const word of words) {
    const band = ink(word.t + word.d / 2, 1000, 1920);
    assert.ok(band.right >= 0, `${word.w}: nothing was drawn at all`);
    // Inside the frame, and inside the margin the look asks for rather than at its edge.
    assert.ok(band.left > 40 && band.right < 1040,
      `${word.w}: drawn from ${band.left} to ${band.right} of 1080`);
    // A sentence is two rows at most, whatever is in it: a third row, or a word broken
    // inside itself, is letters reaching down towards the speaker's face, which is what
    // shrinking the line buys over letting it wrap.
    assert.ok(band.tall < lineHeight * 1.22 * 2 + lineHeight * 0.35,
      `${word.w}: its letters span ${band.tall}px, more than the two rows of ${Math.round(lineHeight)}px it asked for`);
    assert.ok(band.bottom < seam, `${word.w}: it reaches ${band.bottom}, past the seam at ${seam}`);
  }

  // The hook card holds the same URL and stays inside the frame too.
  const hook = ink(2, 120, 520);
  assert.ok(hook.left > 40 && hook.right < 1040, `the hook card runs from ${hook.left} to ${hook.right} of 1080`);

});

test("a square derive is its own video: its own seam, its own captions, the same hook", { timeout: 420_000 }, async () => {
  // A variant is a promise about a shape the author never renders: they cut vertical and
  // the square is derived later, so a seam or a caption band that moved with the frame
  // and not with the other is invisible until somebody publishes it.
  const { createVideoProject } = await import("../../media/server/media-import");
  const { readEditor, editProject } = await import("../../editor/server/store");
  const { executeEditorTool } = await import("../../editor/server/tools");
  const { renderProject } = await import("../../render/server/render-project");

  const source = path.join(workspace, "square-stream.mp4");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=0x102040:size=1728x1116:rate=12:duration=16",
    "-f", "lavfi", "-i", "sine=frequency=220:duration=16", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-vf", "drawbox=x=1200:y=806:w=528:h=310:color=0xE08020@1:t=fill", source]);

  const { id } = await createVideoProject("Square derive", [{ file: source }]);
  let snapshot = readEditor(id);
  const sequenceId = snapshot.edl.sequences[0].id;
  const words = ["hoy", "vamos", "a", "conectar", "el", "editor", "con", "el", "agente"]
    .map((w, i) => ({ t: 1 + i * 0.6, d: 0.45, w }));
  snapshot = editProject(id, { expectedRevision: snapshot.revision, operations: [{
    type: "item.patch", sequenceId, itemId: snapshot.edl.sequences[0].items[0].id,
    patch: { title: "Stream", hook: "¿Y si el editor y el agente fueran el mismo?", start: 0, end: 14, words },
  }] });

  const framing = { camera: { x: 1200 / 1728, y: 806 / 1116, w: 528 / 1728, h: 310 / 1116 }, screen: { x: 0, y: 0, w: 1200 / 1728, h: 1 } };
  await executeEditorTool(id, {
    tool: "template.apply", templateId: "stream-short", sequenceId, expectedRevision: snapshot.revision,
    overrides: { output: { width: 1080, height: 1920, fps: 12 }, outro: { enabled: false }, layout: framing },
  });
  const derived = await executeEditorTool(id, {
    tool: "sequence.derive", sequenceId, aspect: "1:1", expectedRevision: readEditor(id).revision,
  }) as { sequenceId: string };
  await executeEditorTool(id, {
    tool: "template.apply", templateId: "stream-short", sequenceId: derived.sequenceId,
    expectedRevision: readEditor(id).revision, overrides: { outro: { enabled: false }, layout: framing },
  });

  const square = readEditor(id).edl.sequences.find((s) => s.id === derived.sequenceId)!;
  assert.deepEqual({ w: square.output.width, h: square.output.height }, { w: 1080, h: 1080 },
    "the derive keeps the shape it was derived into");
  const shot = square.items.find((i) => i.mediaId)!;
  assert.equal(shot.clip.layout.type, "split");
  if (shot.clip.layout.type !== "split") return;
  // The 1:1 variant gives the person more of a shorter frame than the 9:16 one does.
  const seam = Math.round((square.output.height * shot.clip.layout.topPct) / 100);
  assert.ok(shot.clip.layout.topPct < 68, `the square variant moved the seam: ${shot.clip.layout.topPct}%`);

  const { outputs } = await renderProject(id, { only: [derived.sequenceId] });
  const file = outputs[0].file;
  const at = 2;

  // Screen above the seam, person below it, in the square's own pixels.
  assert.ok(near(pixel(file, at, 120, seam - 60), [16, 32, 64]), `screen above the seam, saw ${pixel(file, at, 120, seam - 60)}`);
  assert.ok(near(pixel(file, at, 120, seam + 60), [224, 128, 32]), `person below it, saw ${pixel(file, at, 120, seam + 60)}`);
  // And the webcam does not show through the screen half as well.
  for (const y of [120, seam - 120]) {
    assert.ok(!near(pixel(file, at, 900, y), [224, 128, 32], 60), `the webcam shows through the screen half at y=${y}`);
  }

  // The hook is still at the top of the square, held across the body.
  for (const t of [0.4, 6, 12]) {
    const seen = pixel(file, t, 540, Math.round(1080 * 0.11));
    assert.ok(seen.every((c) => c > 200), `the hook holds at ${t}s, saw ${seen}`);
  }

  // The captions are inside the screen half, not over the person's face.
  const captions = { ...shot.clip.captions };
  const top = captions.positionY * square.output.height;
  assert.ok(top + square.output.height * 0.054 * 1.25 < seam,
    `the caption band ends at ${(top + square.output.height * 0.054 * 1.25).toFixed(0)} and the seam is at ${seam}`);
  const band = (sec: number, y: number) => {
    const rgbv = [...ffmpeg(["-ss", String(sec), "-i", file, "-frames:v", "1",
      "-vf", `crop=1080:90:0:${Math.round(y)},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])];
    return (rgbv[0] + rgbv[1] + rgbv[2]) / 3;
  };
  assert.ok(band(words[3].t + 0.2, top) > band(0.2, top) + 6,
    `a spoken word lights the square's own caption band: ${band(words[3].t + 0.2, top)} against ${band(0.2, top)}`);

  // The vertical original is untouched by any of it.
  const tall = readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!;
  assert.deepEqual({ w: tall.output.width, h: tall.output.height }, { w: 1080, h: 1920 });
});

test("a video made of two shots with a blend between them holds one hook across all of it", { timeout: 420_000 }, async () => {
  // The hook is the thing this look is for: it stays up for the whole video. A video is
  // not always one shot, and a hook that spanned the first one and stopped would look
  // right in the panel — the layer is there, the text is right — and be wrong in the
  // export, which is the only place anybody watches it.
  const { createVideoProject } = await import("../../media/server/media-import");
  const { readEditor, editProject } = await import("../../editor/server/store");
  const { executeEditorTool } = await import("../../editor/server/tools");
  const { renderProject } = await import("../../render/server/render-project");
  const { uploadLibraryAsset } = await import("../../media/server/assets");

  // Two scenes shaped like a stream, in different colours, so which one is on screen is
  // a pixel rather than a guess.
  const shots = [
    { file: path.join(workspace, "two-a.mp4"), screen: "0x102040", camera: "0xE08020" },
    { file: path.join(workspace, "two-b.mp4"), screen: "0x401020", camera: "0x20A0E0" },
  ];
  for (const shot of shots) {
    ffmpeg(["-y", "-f", "lavfi", "-i", `color=${shot.screen}:size=1728x1116:rate=12:duration=14`,
      "-f", "lavfi", "-i", "sine=frequency=220:duration=14", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac",
      "-vf", `drawbox=x=1200:y=806:w=528:h=310:color=${shot.camera}@1:t=fill`, shot.file]);
  }
  const cardFile = path.join(workspace, "two-card.mp4");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=0x1E9E4A:size=480x854:rate=12:duration=3",
    "-f", "lavfi", "-i", "sine=frequency=500:duration=3", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", cardFile]);
  const card = await uploadLibraryAsset("two-card.mp4", await fs.readFile(cardFile));

  const { id } = await createVideoProject("Two shots", shots.map((shot) => ({ file: shot.file })));
  let snapshot = readEditor(id);
  const sequenceId = snapshot.edl.sequences[0].id;
  const [one, two] = snapshot.edl.sequences[0].items;
  assert.ok(two, `two sources make two shots: ${snapshot.edl.sequences[0].items.length}`);
  const words = (from: number) => ["hoy", "vamos", "a", "conectar", "el", "editor"].map((w, i) => ({ t: from + i * 0.6, d: 0.45, w }));
  snapshot = editProject(id, { expectedRevision: snapshot.revision, operations: [
    { type: "item.patch", sequenceId, itemId: one.id, patch: { title: "Uno", hook: "¿Y si el editor y el agente fueran el mismo?", start: 0, end: 8, words: words(1) } },
    { type: "item.patch", sequenceId, itemId: two.id, patch: { title: "Dos", start: 0, end: 8, words: words(1) } },
    // And a blend between them, which is a place a layer can end early without anybody noticing.
    { type: "item.transition", sequenceId, itemId: two.id, transition: { kind: "dissolve", durationSec: 0.8 } },
  ] });

  await executeEditorTool(id, {
    tool: "template.apply", templateId: "stream-short", sequenceId, expectedRevision: snapshot.revision,
    slots: { endcard: { assetId: card.id } },
    overrides: { output: { width: 1080, height: 1920, fps: 12 },
      layout: { camera: { x: 1200 / 1728, y: 806 / 1116, w: 528 / 1728, h: 310 / 1116 }, screen: { x: 0, y: 0, w: 1200 / 1728, h: 1 } } },
  });

  const saved = readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!;
  const { sequenceFrames } = await import("../../editor/lib/sequences");
  const frames = sequenceFrames(saved);
  const fps = saved.output.fps;
  const outro = frames.items.find((e) => e.item.clip.title === "Outro")!;
  const hook = frames.items.find((e) => e.item.clip.title === "Hook")!;
  const body = outro.from / fps;
  assert.ok(Math.abs((hook.from + hook.duration) / fps - body) < 0.1,
    `the hook layer spans the whole body: ${(hook.from / fps).toFixed(2)}..${((hook.from + hook.duration) / fps).toFixed(2)} of ${body.toFixed(2)}s`);

  const { outputs } = await renderProject(id, { only: [sequenceId] });
  const file = outputs[0].file;

  // Both shots are framed, and which one is on screen changes where it should.
  const seam = Math.round(1920 * 0.68);
  const shotTwoStarts = frames.items.find((e) => e.item.id === two.id)!.from / fps;
  assert.ok(near(pixel(file, 1, 120, seam + 60), [224, 128, 32]), `the first speaker, saw ${pixel(file, 1, 120, seam + 60)}`);
  assert.ok(near(pixel(file, shotTwoStarts + 1.5, 120, seam + 60), [32, 160, 224]),
    `the second speaker after the blend, saw ${pixel(file, shotTwoStarts + 1.5, 120, seam + 60)}`);
  assert.ok(near(pixel(file, shotTwoStarts + 1.5, 120, seam - 60), [64, 16, 32]), "and the second screen above the seam");

  // The hook is on screen throughout: in the first shot, across the blend, in the second,
  // and at the last frame before the card.
  for (const at of [0.3, shotTwoStarts - 0.2, shotTwoStarts + 0.1, shotTwoStarts + 2, body - 0.3]) {
    const seen = pixel(file, at, 540, 200);
    assert.ok(seen.every((c) => c > 200), `the hook card should be up at ${at.toFixed(2)}s, saw ${seen}`);
  }
  assert.ok(!pixel(file, body + 1.5, 540, 200).every((c) => c > 200), "and gone on the end card");
  assert.ok(near(pixel(file, body + 1.5, 540, 960), [30, 158, 74], 45), "which is the card itself");
});
