import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin";

let workspace: string;
let source: string;
let sting: string;
let store: typeof import("../src/lib/editor/store");
let mediaService: typeof import("../src/lib/editor/media");
let tools: typeof import("../src/lib/editor/tools");
let database: typeof import("../src/lib/db");
let assets: typeof import("../src/lib/assets");
let registry: typeof import("../src/lib/templates/registry");

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-libvideo-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, mediaService, tools, database, assets, registry] = await Promise.all([
    import("../src/lib/editor/store"), import("../src/lib/editor/media"), import("../src/lib/editor/tools"), import("../src/lib/db"), import("../src/lib/assets"), import("../src/lib/templates/registry"),
  ]);
  const { resetBrandIndex, brandIndex } = await import("../src/lib/search/brand");
  resetBrandIndex();
  await fs.mkdir(path.join(workspace, "cache"), { recursive: true });
  await fs.writeFile(path.join(workspace, "cache", "brands.json"), JSON.stringify([]));
  await brandIndex();
  const make = (file: string, colour: string, seconds: number) => {
    const r = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", `color=${colour}:size=320x180:rate=15:duration=${seconds}`, "-f", "lavfi", "-i", `sine=frequency=300:duration=${seconds}`, "-pix_fmt", "yuv420p", "-shortest", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  source = path.join(workspace, "source.mp4"); make(source, "navy", 10);
  sting = path.join(workspace, "sting.mp4"); make(sting, "orange", 2);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

test("the library holds video: uploaded, scanned from the folder, listed by kind, with its duration", async () => {
  const uploaded = await assets.uploadLibraryAsset("sting.mp4", await fs.readFile(sting));
  assert.equal(uploaded.kind, "video");
  assert.equal(uploaded.scope, "library");
  assert.ok(uploaded.duration_sec && Math.abs(uploaded.duration_sec - 2) < 0.2, `duration ${uploaded.duration_sec}`);
  assert.equal(uploaded.width, 320);
  assert.ok(assets.toAbs(uploaded.path).startsWith(path.join(workspace, "library", "video")), uploaded.path);
  await fs.copyFile(source, path.join(workspace, "library", "video", "dropped.mp4"));
  assert.equal(await assets.scanLibrary(), 1);
  const listed = database.q.listAssets("video");
  assert.deepEqual(listed.map((a) => a.name).sort(), ["dropped.mp4", "sting.mp4"]);
  assert.equal(assets.kindFor("x.MOV"), "video");
  assert.equal(assets.kindFor("x.txt"), null);
});

test("media.import takes a library video by asset id and can place it as a shot in the same revision, without duplicating media", async () => {
  const { id } = await mediaService.createVideoProject("Uses library", [{ file: source }]);
  const start = store.readEditor(id);
  const sequenceId = start.edl.sequences[0].id;
  const stingAsset = database.q.listAssets("video").find((a) => a.name === "sting.mp4")!;
  const placed = await tools.executeEditorTool(id, { tool: "media.import", file: stingAsset.id, expectedRevision: start.revision, place: { sequenceId, at: null, layer: 0 } }) as { revision: number; edl: typeof start.edl };
  assert.equal(placed.edl.media.length, 2, "the library video is project media now");
  const media = placed.edl.media[1];
  assert.equal(media.file, assets.toAbs(stingAsset.path), "referenced in the workspace, not copied again");
  const items = placed.edl.sequences[0].items;
  assert.equal(items.length, 2);
  assert.equal(items[1].mediaId, media.id);
  assert.ok(Math.abs(items[1].clip.end - 2) < 0.2);
  const again = await tools.executeEditorTool(id, { tool: "media.import", file: stingAsset.id, expectedRevision: placed.revision, place: { sequenceId, at: 0, layer: 1 } }) as { edl: typeof start.edl };
  assert.equal(again.edl.media.length, 2, "the same library video used twice is one media entry");
  assert.equal(again.edl.sequences[0].items.length, 3);
  await assert.rejects(tools.executeEditorTool(id, { tool: "media.import", file: "a_nope", expectedRevision: placed.revision + 1 }), /not found|ENOENT|no such/i);
});

test("a template outro can be a library video: it becomes media and a shot at the end, marked as the template's, and converges", async () => {
  const { id } = await mediaService.createVideoProject("Outro", [{ file: source }]);
  const start = store.readEditor(id);
  const sequenceId = start.edl.sequences[0].id;
  const stingAsset = database.q.listAssets("video").find((a) => a.name === "sting.mp4")!;
  await registry.saveTemplate({ id: "stung", extends: "talking-head", name: "Stung", outro: { enabled: true, assetId: stingAsset.id } });
  const first = await tools.executeEditorTool(id, { tool: "template.apply", templateId: "stung", sequenceId, expectedRevision: start.revision }) as { revision: number };
  let edl = store.readEditor(id).edl;
  assert.equal(edl.media.length, 2);
  const outro = edl.sequences[0].items.find((i) => i.clip.title === "Outro")!;
  assert.ok(outro, "an outro shot exists");
  assert.equal(outro.mediaId, edl.media[1].id);
  assert.equal(outro.clip.reason, "template:stung");
  assert.ok(Math.abs(outro.clip.end - 2) < 0.2, "a video outro plays whole");
  const main = edl.sequences[0].items.filter((i) => (i.layer ?? 0) === 0).map((i) => i.clip.title);
  assert.deepEqual(main, ["source.mp4", "Outro"]);
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "stung", sequenceId, expectedRevision: first.revision });
  edl = store.readEditor(id).edl;
  assert.equal(edl.sequences[0].items.filter((i) => i.clip.title === "Outro").length, 1, "re-applying replaces the outro rather than stacking it");
  assert.equal(edl.media.length, 2, "and adds no second media entry");
  // A rule can ask for the same thing through overrides: the "add an asset at the end" action is an outro.
  const { saveRule } = await import("../src/lib/rules/registry");
  await saveRule({ id: "stream-sting", name: "Stream sting", when: "the clip is from a stream", then: { overrides: { outro: { enabled: true, assetId: stingAsset.id } } } });
  const { applyRules } = await import("../src/lib/rules/apply");
  const { id: other } = await mediaService.createVideoProject("Ruled", [{ file: source }]);
  const result = await applyRules(other, { ruleIds: ["stream-sting"], sequenceId: store.readEditor(other).edl.sequences[0].id, templateId: "talking-head" }, store.readEditor(other).revision);
  assert.ok(result.applied);
  assert.ok(store.readEditor(other).edl.sequences[0].items.some((i) => i.clip.title === "Outro" && i.mediaId), "the rule placed the sting");
});
