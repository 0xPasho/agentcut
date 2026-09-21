/** Local workspace management for humans and agents, using the UI's project services. */
import { q } from "../src/lib/db";
import { createVideoProject } from "../src/lib/editor/media";
const USAGE = 'usage: agentcut projects list | projects create "Project name" [video1.mp4 ...] | projects batch "Set name" [--brief "..."] video1.mp4 video2.mp4 ...';
async function main() {
  const [command, name, ...rest] = process.argv.slice(2);
  if (command === "list") console.log(JSON.stringify(q.listProjects().map(p => ({ id: p.id, name: p.name, status: p.status, revision: p.revision })), null, 2));
  // No files is an empty project: the same editor, starting from a blank canvas.
  else if (command === "create" && name) console.log(JSON.stringify(await createVideoProject(name, rest.map(file => ({ file }))), null, 2));
  else if (command === "batch" && name) {
    let brief = "";
    const files: string[] = [];
    for (let i = 0; i < rest.length; i++) { if (rest[i] === "--brief") brief = rest[++i] ?? ""; else files.push(rest[i]); }
    if (!files.length) throw new Error(USAGE);
    const project = await createVideoProject(name, files.map(file => ({ file })), { layout: "separate" });
    console.error(`project ${project.id}: ${files.length} videos, running the batch…`);
    const { runBatch } = await import("../src/lib/batch");
    const result = await runBatch(project.id, { brief, onStage: (s) => console.error(s), onLog: (kind, text) => console.error(`${kind}: ${text}`) });
    console.log(JSON.stringify({ ...project, ...result }, null, 2));
  }
  else throw new Error(USAGE);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
