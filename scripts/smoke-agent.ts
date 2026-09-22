import { availableProviders, resolveProvider, extractJson } from "../src/modules/agent/server/providers";
import { ensureWorkspace, projectDir } from "../src/common/server/config";

async function main() {
  ensureWorkspace();
  console.log("providers:", await availableProviders());

  const provider = await resolveProvider(process.env.AGENT_PROVIDER);
  const cwd = projectDir("smoke");
  console.log(`\n→ running ${provider.label} in ${cwd}\n`);

  const res = await provider.run({
    cwd,
    timeoutMs: 180_000,
    allowedTools: ["Read", "Glob", "Grep"],
    prompt:
      "Reply with ONLY a JSON object, no prose, no code fence: " +
      '{"ok": true, "clips": [{"title": "test", "start": 0, "end": 3}]}',
    onEvent: (e) => {
      if (e.kind === "tool") console.log(`  [tool] ${e.name}: ${e.text}`);
      else if (e.kind === "error") console.log(`  [error] ${e.text}`);
    },
  });

  console.log("raw text:", JSON.stringify(res.text).slice(0, 300));
  console.log("parsed:", extractJson(res.text));
  console.log(`duration: ${(res.durationMs / 1000).toFixed(1)}s  cost: ${res.costUsd ?? "n/a"}`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
