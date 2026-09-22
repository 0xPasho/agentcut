/**
 * Read a finished video back out of its own pixels and check it against what the
 * template said it would be.
 *
 *   tsx scripts/style-audit.ts <projectId> [sequenceId]
 *
 * The same reading the `style.audit` tool returns, printed. Every video must have been
 * rendered — `rendered.json` is what it reads.
 */
import { auditStyle } from "../src/modules/render/server/style-check";

async function main() {
  const [projectId, only] = process.argv.slice(2);
  if (!projectId) throw new Error("usage: style-audit.ts <projectId> [sequenceId]");
  const audits = await auditStyle(projectId, only);
  let checks = 0;
  let failed = 0;
  for (const audit of audits) {
    if (audit.skipped) { console.log(`${audit.sequenceId}: ${audit.skipped}`); continue; }
    console.log(`${audit.sequenceId} "${audit.title}"`);
    if (audit.stale) console.log(`  ${audit.stale} — if this video is one of the things that changed, render it again`);
    for (const check of audit.checks) {
      checks += 1;
      if (!check.ok) failed += 1;
      console.log(`  ${check.detail} ${check.ok ? "✓" : "✗"}`);
    }
  }
  console.log(failed ? `\n${failed} of ${checks} checks failed` : `\nall ${checks} checks passed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
