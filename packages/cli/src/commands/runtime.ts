/** `agentcut runtime`: what the CLI has downloaded on first use, fetched ahead of time or cleared. */
import { HOME, IS_CHECKOUT, RUNTIME } from "@agentcut/core/common/server/config";
import { ensureFfmpeg, ensureRender, ensureStudio, pruneRuntime, runtimeStatus, VERSION } from "@agentcut/core/common/server/runtime";

const USAGE = "usage: agentcut runtime [status | install <ffmpeg|render|studio|all> | prune | path]";
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const WHAT = { ffmpeg: "ffmpeg + ffprobe (media)", render: "renderer (first export)", studio: "studio (visual editor)" } as const;

async function main() {
  const [command = "status", ...rest] = process.argv.slice(2);
  if (command === "path") return console.log(RUNTIME);
  if (command === "status") {
    if (process.argv.includes("--json")) return console.log(JSON.stringify(await runtimeStatus(), null, 2));
    console.log(`AgentCut ${VERSION}${IS_CHECKOUT ? " — source checkout: everything comes from node_modules, nothing is downloaded" : ""}`);
    console.log(`Home    ${HOME}\nRuntime ${RUNTIME}\n`);
    for (const s of await runtimeStatus()) {
      const state = s.installed ? `✓ ${s.version ?? ""}`.padEnd(14) + mb(s.bytes) : "· not downloaded yet";
      console.log(`  ${s.component.padEnd(8)} ${state.padEnd(30)} ${WHAT[s.component]}${s.other.length ? `  (+ old: ${s.other.join(", ")})` : ""}`);
    }
    return;
  }
  if (command === "install") {
    if (IS_CHECKOUT) return console.log("A source checkout has every component in node_modules already.");
    const which = rest[0] ?? "all";
    if (!["ffmpeg", "render", "studio", "all"].includes(which)) throw new Error(USAGE);
    if (which === "ffmpeg" || which === "all") await ensureFfmpeg();
    if (which === "render" || which === "all") await ensureRender();
    if (which === "studio" || which === "all") await ensureStudio();
    return console.log("Ready.");
  }
  if (command === "prune") return console.log(`Freed ${mb(await pruneRuntime())}.`);
  throw new Error(USAGE);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
