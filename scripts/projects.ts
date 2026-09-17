/** Local workspace management for humans and agents, using the UI's project services. */
import { q } from "../src/lib/db";
import { createVideoProject } from "../src/lib/editor/media";
async function main() {
  const [command, name, ...files] = process.argv.slice(2);
  if (command === "list") console.log(JSON.stringify(q.listProjects().map(p => ({ id: p.id, name: p.name, status: p.status, revision: p.revision })), null, 2));
  // No files is an empty project: the same editor, starting from a blank canvas.
  else if (command === "create" && name) console.log(JSON.stringify(await createVideoProject(name, files.map(file => ({ file }))), null, 2));
  else throw new Error('usage: agentcut projects list | projects create "Project name" [video1.mp4 video2.mp4 ...]');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
