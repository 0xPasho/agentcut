// Teaser: a few seconds of what is coming, cut from later in the video, opened before
// the greeting as a trailer — black bars with a tracked label, and a dramatic bed that
// stops dead on the cut into the video. Re-running it replaces the teaser it made.
import { IDS, barsPlate, edit, introItem, isTeaserShot, layers, mainSequence, pictureScene, read, removeOwn, resync } from "./lib/showcase.mjs";

export default async function teaser(ctx) {
  const { moments, label, music, gain, dissolve, sequenceId } = ctx.params;
  if (!Array.isArray(moments) || !moments.length) throw new Error("moments: give at least one { start, end } from the source");
  let { edl } = await read(ctx);
  let sequence = mainSequence(edl, sequenceId);
  const intro = introItem(sequence);
  const mediaId = intro.mediaId;
  const operations = removeOwn(sequence, (id) => isTeaserShot(id) || id === IDS.bars || id === IDS.music);
  moments.forEach((m, i) => {
    if (!(m.end > m.start)) throw new Error(`moment ${i + 1}: end must be after start`);
    const id = `${IDS.shot}${i + 1}`;
    operations.push({ type: "item.add", sequenceId: sequence.id, index: i, item: {
      id, mediaId: m.mediaId ?? mediaId,
      ...(i ? { transition: { kind: "dissolve", durationSec: dissolve, color: "#000000", direction: "left", by: "recipe:showcase/teaser" } } : {}),
      clip: {
        id, title: m.title ?? `Teaser ${i + 1}`, start: m.start, end: m.end, captions: { preset: "none" },
        crop: m.crop ? [{ t: 0, ...m.crop }] : [],
        edits: (m.cuts ?? []).map(([a, b]) => ({ type: "silence", t: a - m.start, d: b - a, by: "recipe:showcase/teaser" })),
      },
    } });
  });
  // The video proper opens on a hard cut: the trailer stops, the greeting starts.
  if (intro.transition) operations.push({ type: "item.transition", sequenceId: sequence.id, itemId: intro.id, transition: null });
  await edit(ctx, operations);

  ({ edl } = await read(ctx));
  sequence = mainSequence(edl, sequenceId);
  const timeline = await ctx.timeline(sequence.id);
  const end = timeline.items.find((i) => i.id === intro.id).from;
  await barsPlate(ctx, { width: sequence.output.width, height: sequence.output.height, label });
  const bars = await ctx.upload("bars.png", "showcase-teaser-bars.png");
  const place = layers(sequence);
  const src = ctx.pack.assets[music] ?? music;
  await edit(ctx, [
    { type: "item.add", sequenceId: sequence.id, item: pictureScene(IDS.bars, `Teaser: ${label}`, place.bars, 0, end, bars.id, "recipe:showcase/teaser") },
    { type: "item.add", sequenceId: sequence.id, item: {
      id: IDS.music, mediaId: null, layer: place.music, at: 0,
      clip: { id: IDS.music, title: "Teaser: música", start: 0, end, captions: { preset: "none" }, edits: [
        { type: "music", t: 0, d: end, src, gain, duck: false, loop: false, by: "recipe:showcase/teaser" },
      ] },
    } },
  ]);
  ctx.log(`teaser: ${moments.length} shots, ${end.toFixed(1)} s, the video opens at ${end.toFixed(1)} s`);
  return { seconds: end, shots: moments.length, ...(await resync(ctx, sequence.id)) };
}
