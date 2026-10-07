/** Render an EDL to mp4 clips: agentcut render <projectId|edl.json> [--only id,id] */
import fs from "node:fs/promises";
import path from "node:path";
import { renderProject } from "@agentcut/core/modules/render/server/render-project";
import { readEditor } from "@agentcut/core/modules/editor/server/store";
import { Edl } from "@agentcut/core/modules/editor/types";
import { projectDir } from "@agentcut/core/common/server/config";
import { renderClips } from "@agentcut/core/modules/render/server/render";
import { loadRenderer, rendererReady } from "@agentcut/core/modules/render/server/remotion";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const target = process.argv[2];
  if (!target) throw new Error("usage: agentcut render <projectId|path/to/edl.json>");

  const snapshot = target.endsWith(".json");
  const dir = snapshot ? path.dirname(path.resolve(target)) : projectDir(target);
  const edl = snapshot ? Edl.parse(JSON.parse(await fs.readFile(path.resolve(target), "utf8"))) : readEditor(target).edl;

  // First export on an installed CLI: fetch the renderer here, with a progress bar, rather than inside the render.
  if (!rendererReady()) {
    console.error("The first export needs the renderer. Downloading it once:");
    await loadRenderer();
  }
  const videos = edl.sequences.length || edl.clips.length;
  console.log(`rendering ${videos} video${videos === 1 ? "" : "s"}`);
  let lastLine = "";

  const options: Parameters<typeof renderClips>[2] = {
    only: arg("only")?.split(","),
    onProgress: (p) => {
      if (p.stage === "bundling") return console.log("bundling composition…");
      const line = `  [${p.index + 1}/${p.total}] ${p.title.slice(0, 40)} ${Math.round(p.progress * 100)}%`;
      if (line !== lastLine) {
        process.stdout.write(`\r${line.padEnd(80)}`);
        lastLine = line;
      }
      if (p.stage === "done") process.stdout.write("\n");
    },
  };
  const outputs = snapshot ? await renderClips(edl, dir, options) : (await renderProject(target, options)).outputs;

  console.log("");
  for (const o of outputs) {
    const { size } = await fs.stat(o.file);
    const shown = path.relative(process.cwd(), o.file);
    console.log(`  ${(size / 1e6).toFixed(1)}MB  ${shown.startsWith("..") ? o.file : shown}`);
  }
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}`);
  process.exit(1);
});
