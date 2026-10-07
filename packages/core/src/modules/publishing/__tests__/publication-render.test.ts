import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../../../common/server/bin";

test("publication pins actual rendered pixels under the render lock and preserves them across a later export", { timeout: 180_000 }, async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-publication-render-")); process.env.AGENTCUT_WORKSPACE = workspace;
  const source = path.join(workspace, "source.mp4");
  const result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=c=0x23354f:size=180x320:rate=10:duration=1", "-pix_fmt", "yuv420p", source], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr);
  const { db } = await import("../../../common/server/db");
  try {
    const { createVideoProject } = await import("../../media/server/media-import");
    const { readEditor, editProject } = await import("../../editor/server/store");
    const { prepare, approveVideo, pin } = await import("../server/service");
    const { artifactFile, verifyArtifact } = await import("../server/artifacts");
    const { renderProject } = await import("../../render/server/render-project");
    const { id } = await createVideoProject("Publishing render", [{ file: source }], { transcribe: false });
    let snapshot = readEditor(id), sequence = snapshot.edl.sequences[0];
    snapshot = editProject(id, { expectedRevision: snapshot.revision, operations: [{ type: "item.patch", sequenceId: sequence.id, itemId: sequence.items[0].id, patch: { edits: [{ type: "text", t: 0, d: 1, text: "APPROVED", position: "center", style: "card" }] } }] });
    let p = prepare(id, sequence.id, []); p = approveVideo(p.id, snapshot.revision);
    p = await pin(p.id, p.revision, true); assert.ok(p.artifactId);
    const artifact = await verifyArtifact(p.artifactId);
    const frame = spawnSync(FFMPEG, ["-y", "-i", artifactFile(artifact.id), "-frames:v", "1", "/tmp/agentcut-publication-approved.png"], { encoding: "utf8" }); assert.equal(frame.status, 0, frame.stderr);
    snapshot = readEditor(id); sequence = snapshot.edl.sequences[0];
    editProject(id, { expectedRevision: snapshot.revision, operations: [{ type: "item.patch", sequenceId: sequence.id, itemId: sequence.items[0].id, patch: { edits: [{ type: "text", t: 0, d: 1, text: "NEW EDIT", position: "center", style: "card" }] } }] });
    await renderProject(id, { only: [sequence.id] });
    assert.equal((await verifyArtifact(artifact.id)).sha256, artifact.sha256);
    const { detail } = await import("../server/service"); const { publication } = await import("../server/store");
    assert.equal(detail(publication(p.id)).newerEdit, true);
    assert.notEqual(detail(publication(p.id)).status, "published");
  } finally { db.close(); await fs.rm(workspace, { recursive: true, force: true }); }
});
