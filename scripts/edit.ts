/** Headless interface to the SAME editor as the UI. No web server required. */
import fs from "node:fs/promises";
import { runReportedTool, recordActivity } from "../src/lib/activity-log";
import { formatActivity } from "../src/lib/activity";
import { sendMessage } from "../src/lib/editor/conversation";
async function main() {
  const [id, mode, ...rest] = process.argv.slice(2);
  if (!id) throw new Error("usage: tsx scripts/edit.ts <projectId> [read | call request.json | ask instruction]");
  // Progress goes to stderr as it happens, so a run that takes minutes is legible
  // while it runs and stdout stays the result alone. The same lines reach the web.
  const trace = (e: { kind: string; name?: string | null; text: string }) => {
    if (e.kind === "log" && !e.name) return;
    process.stderr.write(`${formatActivity({ ...e, at: Date.now() })}\n`);
  };
  if (mode === "ask") {
    const { reply } = await sendMessage(id, rest.join(" "), { source: "cli", onEvent: (e) => { trace(e); recordActivity(id, e, "cli"); } });
    console.log(reply.text);
  } else {
    const request = mode === "call" ? JSON.parse(await fs.readFile(rest[0], "utf8")) : { tool: "project.read" };
    console.log(JSON.stringify(await runReportedTool(id, request, { via: "cli", onActivity: trace }), null, 2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
