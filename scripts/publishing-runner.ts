import { randomUUID } from "node:crypto";
import { tick } from "../src/modules/publishing/server/runner";
import { runPhoneAgent } from "../src/modules/publishing/server/phone/agent";

async function main() {
  const index = process.argv.indexOf("--phone");
  if (index >= 0) { await runPhoneAgent(process.argv[index + 1]); return; }
  const owner = randomUUID();
  for (;;) { const result = await tick(owner); if (result.busy || !result.pending) return; await new Promise(resolve => setTimeout(resolve, 5000)); }
}
main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
