import fs from "node:fs/promises";
import { executePublicationCommand } from "../src/modules/publishing/server/tools";
import { tick } from "../src/modules/publishing/server/runner";

async function main() {
  const [command, file] = process.argv.slice(2);
  if (command === "tick") return tick();
  if (command === "call" && file) return executePublicationCommand(JSON.parse(await fs.readFile(file, "utf8")), { actor: "human" });
  if (!command || command === "list") return executePublicationCommand({ tool: "publication.overview" });
  throw new Error("Usage: agentcut publishing list | call request.json | tick");
}
main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error((error as Error).message); process.exitCode = 1; });
