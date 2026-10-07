import { executeSnapshotCommand } from "@agentcut/core/modules/settings/server/snapshots";
import type { SnapshotPreview } from "@agentcut/core/modules/settings/types";

async function main() {
  const [command, file, confirmation] = process.argv.slice(2);
  if (command === "export") return executeSnapshotCommand({ tool: "workspace.snapshot.export", destination: file });
  if (command === "preview" && file) return executeSnapshotCommand({ tool: "workspace.snapshot.preview", file });
  if (command === "restore" && file && confirmation === "--replace") {
    const preview = await executeSnapshotCommand({ tool: "workspace.snapshot.preview", file }) as SnapshotPreview;
    return executeSnapshotCommand({ tool: "workspace.snapshot.restore", file, fingerprint: preview.fingerprint, confirm: "replace-workspace-data" });
  }
  throw new Error("Usage: agentcut workspace export [output.agentcut.gz] | preview file.agentcut.gz | restore file.agentcut.gz --replace");
}
main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error((error as Error).message); process.exitCode = 1; });
