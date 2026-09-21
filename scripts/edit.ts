/** Headless interface to the SAME editor as the UI. No web server required. */
import fs from "node:fs/promises";
import { executeEditorTool } from "../src/lib/editor/tools";
import { sendMessage } from "../src/lib/editor/conversation";
async function main() {
  const [id, mode, ...rest] = process.argv.slice(2);
  if (!id) throw new Error("usage: tsx scripts/edit.ts <projectId> [read | call request.json | ask instruction]");
  if (mode === "ask") console.log((await sendMessage(id, rest.join(" "), { source: "cli" })).reply.text);
  else console.log(JSON.stringify(await executeEditorTool(id, mode === "call" ? JSON.parse(await fs.readFile(rest[0], "utf8")) : { tool: "project.read" }), null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
