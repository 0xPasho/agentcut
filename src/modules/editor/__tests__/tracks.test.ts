import { test } from "node:test";
import assert from "node:assert/strict";
import { Clip, Edl, VideoSequence } from "../types";
import { applyOperations } from "../lib/operations";
import { audioLayer, audioOnly, laneLabels, routeLayer, titleLayer, trackLanes } from "../lib/tracks";

const clip = (id: string, seconds: number, edits: unknown[] = []) =>
  Clip.parse({ id, title: id, start: 0, end: seconds, captions: { preset: "none" }, edits });
const music = (seconds: number) => [{ type: "music", t: 0, d: seconds, src: "a_music", gain: .3, duck: true, loop: true }];
const sequence = (items: unknown[]) => VideoSequence.parse({ id: "s", title: "S", output: { width: 640, height: 360, fps: 10 }, items });

/** A shot, a title over it, a music bed, and the shot's own sound lifted off it. */
const fixture = () => sequence([
  { id: "shot", mediaId: "source", clip: clip("shot", 6) },
  { id: "title", mediaId: null, layer: 1, at: 0, clip: clip("title", 3, [{ type: "text", t: 0, d: 3, text: "Hello" }]) },
  { id: "bed", mediaId: null, layer: 2, at: 0, clip: clip("bed", 6, music(6)) },
  { id: "lifted", mediaId: "source", layer: 3, at: 0, hidden: true, clip: clip("lifted", 6) },
]);

test("sound is read as sound wherever it sits, and a scene that is seen is not", () => {
  const items = Object.fromEntries(fixture().items.map(item => [item.id, item]));
  assert.equal(audioOnly(items.bed), true);
  assert.equal(audioOnly(items.lifted), true);
  assert.equal(audioOnly(items.shot), false);
  assert.equal(audioOnly(items.title), false);
  // An empty canvas scene is not yet sound; it is a scene waiting for whatever goes on it.
  assert.equal(audioOnly({ mediaId: null, clip: clip("blank", 5) }), false);
});

test("tracks are drawn picture first and sound underneath, named by what is on screen", () => {
  const lanes = trackLanes(fixture());
  assert.deepEqual(lanes, [{ layer: 1, kind: "video" }, { layer: 0, kind: "video" }, { layer: 2, kind: "audio" }, { layer: 3, kind: "audio" }]);
  assert.deepEqual([...laneLabels(lanes)], [[0, "Main"], [1, "Track 2"], [2, "Audio"], [3, "Audio 2"]]);
  // Main carries the picture's running order even when nothing is on it yet.
  assert.deepEqual(trackLanes(sequence([{ id: "bed", mediaId: null, layer: 4, at: 0, clip: clip("bed", 6, music(6)) }])),
    [{ layer: 0, kind: "video" }, { layer: 4, kind: "audio" }]);
  // One thing you can see makes the whole track a picture track, whatever else is on it.
  const mixed = sequence([
    { id: "bed", mediaId: null, layer: 1, at: 0, clip: clip("bed", 6, music(6)) },
    { id: "card", mediaId: null, layer: 1, at: 6, clip: clip("card", 2, [{ type: "text", t: 0, d: 2, text: "End" }]) },
  ]);
  assert.deepEqual(trackLanes(mixed), [{ layer: 1, kind: "video" }, { layer: 0, kind: "video" }]);
});

test("a new sound takes the first audio track with room, and a new one when they are all sounding", () => {
  const seq = fixture();
  // Both audio tracks are busy from 0 to 6, so a sound landing there needs one of its own.
  assert.equal(audioLayer(seq, 0, 4), 4);
  // Past the end of both, the first of them is free again.
  assert.equal(audioLayer(seq, 6, 4), 2);
  assert.equal(audioLayer(seq, 3, 4), 4);
  assert.equal(audioLayer(sequence([{ id: "shot", mediaId: "source", clip: clip("shot", 6) }]), 0, 4), 1);
});

test("a gesture that aims a sound at the picture lands in the audio region, and the reverse", () => {
  const seq = fixture();
  assert.equal(routeLayer(seq, { layer: 0, kind: "video" }, true, 6, 4), 2);
  assert.equal(routeLayer(seq, { layer: 1, kind: "video" }, true, 0, 4), 4);
  // Aiming a sound at a sound track leaves it exactly where it was aimed.
  assert.equal(routeLayer(seq, { layer: 3, kind: "audio" }, true, 0, 4), 3);
  // A picture dropped in the audio region goes to a new track above everything.
  assert.equal(routeLayer(seq, { layer: 2, kind: "audio" }, false, 0, 4), 4);
  assert.equal(routeLayer(seq, { layer: 0, kind: "video" }, false, 0, 4), 0);
});

test("separating a shot's sound puts it on the audio track for the agent and the UI alike", () => {
  const edl = Edl.parse({
    projectId: "test", source: null,
    media: [{ id: "source", name: "Source", file: "/tmp/source.mp4", width: 640, height: 360, fps: 10, durationSec: 20 }],
    clips: [],
    sequences: [{
      id: "s", title: "S", output: { width: 640, height: 360, fps: 10 }, items: [
        { id: "shot", mediaId: "source", clip: clip("shot", 6) },
        { id: "over", mediaId: "source", layer: 1, at: 0, clip: clip("over", 2) },
        { id: "bed", mediaId: null, layer: 2, at: 8, clip: clip("bed", 6, music(6)) },
      ],
    }],
  });
  const next = applyOperations(edl, [{ type: "item.detachAudio", sequenceId: "s", itemId: "shot", newItemId: "sound" }]);
  const lifted = next.sequences[0].items.find(item => item.id === "sound")!;
  // The music bed is free until 8s, so the shot's sound joins it rather than climbing
  // onto a picture track above the overlay.
  assert.equal(lifted.layer, 2);
  assert.equal(audioOnly(lifted), true);
  assert.deepEqual(trackLanes(next.sequences[0]).at(-1), { layer: 2, kind: "audio" });
  // A second one cannot share that track at the same moment, so it gets its own.
  const again = applyOperations(next, [{ type: "item.detachAudio", sequenceId: "s", itemId: "over", newItemId: "sound2" }]);
  assert.equal(again.sequences[0].items.find(item => item.id === "sound2")!.layer, 3);
});

test("separating a shot's sound can be undone, both the new track and the silence it left", async () => {
  const { invertOperations } = await import("../lib/history");
  const edl = Edl.parse({
    projectId: "test", source: null,
    media: [{ id: "source", name: "Source", file: "/tmp/source.mp4", width: 640, height: 360, fps: 10, durationSec: 20 }],
    clips: [],
    sequences: [{ id: "s", title: "S", output: { width: 640, height: 360, fps: 10 }, items: [{ id: "shot", mediaId: "source", clip: clip("shot", 6) }] }],
  });
  const detach = [{ type: "item.detachAudio" as const, sequenceId: "s", itemId: "shot", newItemId: "sound" }];
  const next = applyOperations(edl, detach);
  assert.equal(next.sequences[0].items.find(item => item.id === "shot")!.muted, true);
  const back = applyOperations(next, invertOperations(edl, detach)).sequences[0].items;
  // The lifted track is gone and the picture can be heard again: undoing only the first
  // would leave a silent shot with nothing left to hear it from.
  assert.deepEqual(back.map(item => item.id), ["shot"]);
  assert.equal(back[0].muted, false);
  assert.deepEqual(back[0].clip, edl.sequences[0].items[0].clip);
});

test("titles share a track with the titles already there, and never with anything else", () => {
  const base = fixture();
  // The track the first title is on is free after it, so the second one joins it.
  assert.equal(titleLayer(base, 3, 2), 1);
  // Over the top of it, there is nowhere on that track to stand.
  assert.equal(titleLayer(base, 1, 2), 4);
  // A track carrying a picture is not a titles track, however much text is also on it.
  const withFootage = sequence([
    { id: "shot", mediaId: "source", clip: clip("shot", 6) },
    { id: "over", mediaId: "source", layer: 1, at: 0, clip: clip("over", 6) },
  ]);
  assert.equal(titleLayer(withFootage, 0, 2), 2);
  // Neither is the audio region, and neither is Main, where a transparent scene would
  // hold black frames for as long as the title lasts.
  const soundOnly = sequence([{ id: "bed", mediaId: null, layer: 1, at: 0, clip: clip("bed", 6, music(6)) }]);
  assert.equal(titleLayer(soundOnly, 0, 2), 2);
  assert.equal(titleLayer(sequence([]), 0, 2), 1);
});

test("several titles land on one track instead of one track each", () => {
  let seq = sequence([]);
  for (const [index, at] of [0, 3, 6].entries()) {
    const id = `t${index}`;
    const layer = titleLayer(seq, at, 2);
    seq = VideoSequence.parse({ ...seq, items: [...seq.items, { id, mediaId: null, layer, at, clip: clip(id, 2, [{ type: "text", t: 0, d: 2, text: id }]) }] });
  }
  assert.deepEqual(seq.items.map(item => item.layer), [1, 1, 1]);
});
