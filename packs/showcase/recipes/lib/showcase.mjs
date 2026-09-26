// What the showcase recipes share: reading the project, the ids they own, the layers
// they draw on, and the two plates (the trailer bars and the jump card) drawn with
// ffmpeg. Every change goes through `project.edit`, so it is an ordinary edit.
import fs from "node:fs";
import path from "node:path";
import { loadFont } from "./font.mjs";

/** Items these recipes own. Re-running a recipe replaces its own items and nothing else. */
export const IDS = { shot: "sc-teaser-shot-", bars: "sc-teaser-bars", music: "sc-teaser-music", camera: "sc-camera", jump: "sc-jump" };
export const owned = (id) => id.startsWith("sc-");
export const isTeaserShot = (id) => id.startsWith(IDS.shot);
const YELLOW = { r: 255, g: 214, b: 10 };

export async function read(ctx) {
  return ctx.call({ tool: "project.read" });
}

export function mainSequence(edl, sequenceId) {
  const sequence = sequenceId ? edl.sequences.find((s) => s.id === sequenceId) : edl.sequences[0];
  if (!sequence) throw new Error(sequenceId ? `No sequence ${sequenceId}` : "This project has no video yet");
  return sequence;
}

export async function edit(ctx, operations) {
  if (!operations.length) return null;
  const { revision } = await read(ctx);
  return ctx.call({ tool: "project.edit", expectedRevision: revision, operations });
}

/** The first shot of the video proper: the first main-track item that is not the teaser. */
export function introItem(sequence, id) {
  const item = id ? sequence.items.find((i) => i.id === id) : sequence.items.find((i) => (i.layer ?? 0) === 0 && !owned(i.id));
  if (!item) throw new Error(id ? `No item ${id} in ${sequence.title}` : `${sequence.title} has nothing after the teaser`);
  return item;
}

/** The highest layer anything but these recipes uses; theirs sit above it, one each. */
export function layers(sequence) {
  const base = Math.max(0, ...sequence.items.filter((i) => !owned(i.id)).map((i) => i.layer ?? 0));
  return { bars: base + 1, music: base + 2, camera: base + 3, jump: base + 4 };
}

export const removeOwn = (sequence, test) =>
  sequence.items.filter((i) => test(i.id)).map((i) => ({ type: "item.remove", sequenceId: sequence.id, itemId: i.id }));

/** A still scene holding one picture for its whole length: no fade, it is the shot. */
export const pictureScene = (id, title, layer, at, seconds, src, by) => ({
  id, mediaId: null, layer, at,
  clip: { id, title, start: 0, end: seconds, captions: { preset: "none" }, edits: [
    { type: "image", t: 0, d: seconds, src, y: 0.5, x: null, widthPct: 100, heightPct: 100, style: "plain", by },
  ] },
});

export const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** DIN Condensed Bold where the machine has it, the pack's own Bebas Neue where it does not. */
export function font(ctx) {
  const wanted = ["DIN Condensed Bold.ttf", "DINCondensed-Bold.ttf"];
  const dirs = ctx.fonts.flatMap((d) => [d, path.join(d, "Supplemental")]);
  let file = null;
  for (const dir of dirs) for (const name of wanted) if (!file && fs.existsSync(path.join(dir, name))) file = path.join(dir, name);
  file ??= path.join(ctx.pack.dir, "recipes", "fonts", "BebasNeue-Regular.ttf");
  fs.copyFileSync(file, path.join(ctx.scratch, "font.ttf"));
  return loadFont(path.join(ctx.scratch, "font.ttf"));
}

let texts = 0;
/** One drawtext per character, so the line can be tracked; the baseline is where it sits. */
function line(ctx, face, text, { x, baseline, size, tracking, color }) {
  return face.positions(text, size, x, tracking).filter((p) => p.ch.trim()).map((p) => {
    const name = `t${++texts}.txt`;
    fs.writeFileSync(path.join(ctx.scratch, name), p.ch);
    return `drawtext=fontfile=font.ttf:textfile=${name}:x=${p.x.toFixed(1)}:y=${baseline.toFixed(1)}-ascent:fontsize=${size.toFixed(1)}:fontcolor=${color}`;
  });
}

const hex = ({ r, g, b }) => `0x${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const esc = (expr) => `'${expr.replaceAll(",", "\\,")}'`;

async function render(ctx, { width, height, r, g, b, a, draw, out }) {
  const graph = [`geq=r=${esc(r)}:g=${esc(g)}:b=${esc(b)}:a=${esc(a)}`, ...draw].join(",");
  await ctx.ffmpeg(["-f", "lavfi", "-i", `color=c=black:s=${width}x${height},format=rgba`, "-vf", graph, "-frames:v", "1", out]);
  return out;
}

/** Black bars top and bottom with a tracked label in the bottom one: the teaser reads as a trailer. */
export async function barsPlate(ctx, { width, height, label }) {
  const s = height / 1116;
  const bar = Math.round(124 * s);
  const face = font(ctx);
  const size = 64 * s;
  const baseline = height - bar / 2 + face.capHeight(size) / 2;
  const accent = { x0: Math.round(64 * s), x1: Math.round(72 * s), y0: Math.round(baseline - face.capHeight(size) + 2 * s), y1: Math.round(baseline - 2 * s) };
  const inAccent = `between(X,${accent.x0},${accent.x1})*between(Y,${accent.y0},${accent.y1})`;
  return render(ctx, {
    width, height,
    r: `if(${inAccent},${YELLOW.r},0)`, g: `if(${inAccent},${YELLOW.g},0)`, b: `if(${inAccent},${YELLOW.b},0)`,
    a: `if(lt(Y,${bar})+gte(Y,${height - bar}),255,0)`,
    draw: line(ctx, face, label, { x: 96 * s, baseline, size, tracking: 7 * s, color: "white" }),
    out: "bars.png",
  });
}

/** A lower third: a question, then "jump to" and the time in yellow, on a dark panel with a yellow edge. */
export async function jumpPlate(ctx, { width, height, question, lead, time }) {
  const s = height / 1116;
  const face = font(ctx);
  const q = { size: 34 * s, tracking: 3 * s }, big = { size: 70 * s, tracking: 4 * s };
  const x0 = Math.round(64 * s), y0 = Math.round(842 * s), h = Math.round(146 * s), pad = 38 * s, r = Math.round(14 * s), edge = Math.round(9 * s);
  const w = Math.round(Math.max(face.measure(question, q.size, q.tracking), face.measure(`${lead} ${time}`, big.size, big.tracking)) + 2 * pad);
  const x1 = x0 + w, y1 = y0 + h;
  const inside = `between(X,${x0},${x1})*between(Y,${y0},${y1})`;
  const corner = `gt(X,${x1 - r})*(lt(Y,${y0 + r})*gt(hypot(X-${x1 - r},Y-${y0 + r}),${r})+gt(Y,${y1 - r})*gt(hypot(X-${x1 - r},Y-${y1 - r}),${r}))`;
  const inEdge = `between(X,${x0},${x0 + edge})*between(Y,${y0},${y1})`;
  const leadWidth = face.measure(`${lead} `, big.size, big.tracking) + big.tracking;
  return render(ctx, {
    width, height,
    r: `if(${inEdge},${YELLOW.r},12)`, g: `if(${inEdge},${YELLOW.g},12)`, b: `if(${inEdge},${YELLOW.b},14)`,
    a: `if(${inEdge},255,if(${inside}*not(${corner}),215,0))`,
    draw: [
      ...line(ctx, face, question, { x: x0 + pad, baseline: y0 + 20 * s + face.capHeight(q.size) + 6 * s, ...q, color: "0xC8C8CD" }),
      ...line(ctx, face, lead, { x: x0 + pad, baseline: y1 - 26 * s, ...big, color: "white" }),
      ...line(ctx, face, time, { x: x0 + pad + leadWidth, baseline: y1 - 26 * s, ...big, color: hex(YELLOW) }),
    ],
    out: "jump.png",
  });
}

/** A recipe's own parameters, kept on its item so another recipe can put it back after a change. */
export const remember = (recipe, params) => `showcase:${recipe} ${JSON.stringify(params)}`;
export function recall(item, recipe) {
  const prefix = `showcase:${recipe} `;
  return item?.clip.reason?.startsWith(prefix) ? JSON.parse(item.clip.reason.slice(prefix.length)) : null;
}

/** The fullscreen camera that settles into its corner, over the first shot after the teaser. */
export async function placeCamera(ctx, params) {
  const { edl } = await read(ctx);
  const sequence = mainSequence(edl, params.sequenceId);
  const intro = introItem(sequence, params.item);
  const { output } = sequence;
  const region = params.region;
  const aspect = output.width / output.height;
  // The largest window of the camera's region with the frame's own shape, trimmed at the
  // top by `inset` so the edge of whatever sits above the camera never shows full screen.
  const h = region.h - params.inset;
  const w = Math.min(region.w, Math.round(h * aspect));
  const crop = { x: Math.round(region.x + (region.w - w) / 2), y: region.y + params.inset, w, h: Math.round(w / aspect) };
  // The stream fills the frame, so a share of the source is the same share of the output:
  // the layer lands exactly on the camera it was cut from.
  const source = edl.media.find((m) => m.id === intro.mediaId);
  if (!source) throw new Error(`${intro.clip.title} has no footage to take the camera from`);
  const place = { x: (crop.x / source.width) * 100, y: (crop.y / source.height) * 100, width: (crop.w / source.width) * 100, height: (crop.h / source.height) * 100 };
  const timeline = await ctx.timeline(sequence.id);
  const at = timeline.items.find((i) => i.id === intro.id).from;
  const layer = layers(sequence).camera;
  const operations = [
    ...removeOwn(sequence, (id) => id === IDS.camera),
    { type: "item.add", sequenceId: sequence.id, item: {
      id: IDS.camera, mediaId: intro.mediaId, layer, at, muted: true,
      clip: { ...intro.clip, id: IDS.camera, title: "Cámara a pantalla completa", reason: remember("camera-intro", params), crop: [{ t: 0, ...crop }],
        edits: intro.clip.edits.filter((e) => e.type === "silence") },
      keyframes: [
        { t: 0, x: 0, y: 0, width: 100, height: 100, opacity: 1, ease: "hold" },
        { t: params.hold, x: 0, y: 0, width: 100, height: 100, opacity: 1, ease: "ease" },
        { t: params.hold + params.move, ...place, opacity: 1, ease: "hold" },
        { t: params.hold + params.move + 0.2, ...place, opacity: 0, ease: "hold" },
      ],
    } },
  ];
  await edit(ctx, operations);
  return { at, crop, hold: params.hold };
}

/** The lower third that tells the viewer where the test starts, with the time read off the timeline. */
export async function placeJump(ctx, params) {
  const { edl } = await read(ctx);
  const sequence = mainSequence(edl, params.sequenceId);
  const timeline = await ctx.timeline(sequence.id);
  const target = timeline.items.find((i) => i.id === params.target);
  if (!target) throw new Error(`No item ${params.target} to jump to`);
  // Where the viewer lands is where the target is fully on screen, after its blend in.
  const time = clock(target.from + target.transitionIn);
  await jumpPlate(ctx, { width: sequence.output.width, height: sequence.output.height, question: params.question, lead: params.lead, time });
  const asset = await ctx.upload("jump.png", `showcase-jump-${time.replace(":", "")}.png`);
  const layer = layers(sequence).jump;
  const item = {
    id: IDS.jump, mediaId: null, layer, at: params.at,
    clip: { id: IDS.jump, title: `Bríncate al ${time}`, reason: remember("jump-card", params), start: 0, end: params.duration + 0.6, captions: { preset: "none" }, edits: [
      { type: "image", t: 0.3, d: params.duration, src: asset.id, y: 0.5, x: null, widthPct: 100, heightPct: 100, style: "plain", by: "recipe:showcase/jump-card" },
    ] },
  };
  await edit(ctx, [...removeOwn(sequence, (id) => id === IDS.jump), { type: "item.add", sequenceId: sequence.id, item }]);
  return { time, at: params.at, duration: params.duration };
}

/** After the teaser changes length, the camera and the jump card are put back where they belong. */
export async function resync(ctx, sequenceId) {
  const { edl } = await read(ctx);
  const sequence = mainSequence(edl, sequenceId);
  const done = {};
  const camera = recall(sequence.items.find((i) => i.id === IDS.camera), "camera-intro");
  if (camera) done.camera = await placeCamera(ctx, { ...camera, sequenceId: sequence.id });
  const jump = recall(sequence.items.find((i) => i.id === IDS.jump), "jump-card");
  if (jump) done.jump = await placeJump(ctx, { ...jump, sequenceId: sequence.id });
  return done;
}
