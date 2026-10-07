import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { Edl } from "../../editor/types";
import { FFMPEG } from "../../../common/server/bin";
import { agentcut } from "../../__tests__/repo";

test("UI, agent and CLI render the same saved revision, ignoring a stale exported EDL", { timeout: 180_000 }, async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-render-parity-"));
  const originals = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-external-source-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  const { q, db } = await import("../../../common/server/db");
  try {
    const source = path.join(originals, "source.mp4");
    const generated = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=1", "-pix_fmt", "yuv420p", source], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const { publishClips, editProject } = await import("../../editor/server/store");
    const { renderProject } = await import("../server/render-project");
    const { executeEditorTool } = await import("../../editor/server/tools");
    const create = (id: string) => {
      q.insertProject({ id, name: id, source_path: source, created_at: Date.now() });
      return publishClips(id, Edl.parse({ projectId: id, source: { file: source, width: 320, height: 180, fps: 10, durationSec: 1 }, output: { width: 180, height: 320, fps: 10 }, clips: ["one", "two", "unselected"].map(clipId => ({ id: clipId, title: clipId, start: 0, end: 1, captions: { preset: "none" }, edits: [] })) }));
    };
    const ui = create("ui"), agent = create("agent");
    const operations = [{ type: "edit.add", clipId: "one", edit: { type: "text", t: 0, d: 1, text: "SHARED", position: "center", style: "card" } }];
    const uiSaved = editProject("ui", { expectedRevision: ui.revision, operations });
    await executeEditorTool("agent", { tool: "project.edit", expectedRevision: agent.revision, operations });
    const uiOutput = await renderProject("ui", { only: ["one", "two"], expectedRevision: uiSaved.revision });
    assert.deepEqual(uiOutput.outputs.map(output => output.clip.id), ["one", "two"]);
    assert.ok(!(await fs.readdir(path.join(workspace, "projects/ui/clips"))).some(file => file.startsWith("unselected-")));
    const hash = (file: string) => {
      const result = spawnSync(FFMPEG, ["-v", "error", "-i", file, "-f", "framemd5", "-"], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr); return result.stdout;
    };
    const expected = hash(uiOutput.outputs[0].file);
    const agentOutput = await executeEditorTool("agent", { tool: "project.render", only: ["one", "two"], expectedRevision: 2 }) as typeof uiOutput;
    assert.deepEqual(agentOutput.outputs.map(output => output.clip.id), ["one", "two"]);
    assert.equal(hash(agentOutput.outputs[1].file), hash(uiOutput.outputs[1].file));
    assert.equal(hash(agentOutput.outputs[0].file), expected);
    await fs.writeFile(path.join(workspace, "projects/ui/edl.json"), "{}", "utf8");
    const cli = spawnSync(...agentcut("render", "ui"), { env: { ...process.env, AGENTCUT_WORKSPACE: workspace }, encoding: "utf8", timeout: 90_000 });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(hash(uiOutput.outputs[0].file), expected);
    const { renderedClips } = await import("../../project/server/clip-files");
    assert.ok((await renderedClips("ui")).one);
    editProject("ui", { expectedRevision: uiSaved.revision, operations: [{ type: "clip.patch", clipId: "one", patch: { title: "Newer revision" } }] });
    // Only the edited video's export goes stale; the others still sign the same (AGENT-FIRST row 155).
    assert.deepEqual(Object.keys(await renderedClips("ui")).sort(), ["two", "unselected"]);
    await assert.rejects(renderProject("ui", { expectedRevision: uiSaved.revision }), /changed elsewhere/);
    await assert.rejects(fs.access(path.join(workspace, "projects/ui/render.lock")));
  } finally { db.close(); await fs.rm(workspace, { recursive: true, force: true }); await fs.rm(originals, { recursive: true, force: true }); }
});
