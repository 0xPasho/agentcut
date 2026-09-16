/** Render an EDL to mp4 clips: npx tsx scripts/render.ts <projectId|edl.json> [--only id,id] */
import fs from "node:fs/promises";
import path from "node:path";
import { Edl } from "../src/lib/edl";
import { projectDir } from "../src/lib/config";
import { renderClips } from "../src/lib/render";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const target = process.argv[2];
  if (!target) throw new Error("usage: tsx scripts/render.ts <projectId|path/to/edl.json>");

  const edlPath = target.endsWith(".json") ? path.resolve(target) : path.join(projectDir(target), "edl.json");
  const dir = path.dirname(edlPath);
  const edl = Edl.parse(JSON.parse(await fs.readFile(edlPath, "utf8")));

  console.log(`rendering ${edl.clips.length} clips at ${edl.output.width}x${edl.output.height}`);
  let lastLine = "";

  const outputs = await renderClips(edl, dir, {
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
  });

  console.log("");
  for (const o of outputs) {
    const { size } = await fs.stat(o.file);
    console.log(`  ${(size / 1e6).toFixed(1)}MB  ${path.relative(process.cwd(), o.file)}`);
  }
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}`);
  process.exit(1);
});
