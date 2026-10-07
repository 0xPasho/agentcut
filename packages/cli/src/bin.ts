/**
 * `agentcut`: one small command that is the whole product from a terminal.
 *
 *   agentcut                      open the studio (downloaded the first time)
 *   agentcut <command> [args…]    run one of the commands below
 *
 * Every command runs in its own process, as it always has: from TypeScript through tsx
 * in a checkout, from the bundled dist/commands when installed. That keeps a crash in a
 * render from taking the launcher with it, and keeps each command's argv its own.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { cliCommand, IS_CHECKOUT, ROOT } from "@agentcut/core/common/server/config";
import { VERSION } from "@agentcut/core/common/server/runtime";
import { COMMANDS, isCommand, usage } from "./commands-table";
import { planArgs } from "./args";
import { studio } from "./studio";

const WIN = process.platform === "win32";

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run") || process.env.AGENTCUT_DRY_RUN === "1";
  const words = argv.filter((arg) => arg !== "--dry-run");
  // `agentcut --port 8000` is the studio with a flag, not a command called --port.
  const STUDIO_FLAGS = /^--(port|no-open)(=|$)/;
  const [command = "studio", ...rest] = words[0] && STUDIO_FLAGS.test(words[0]) ? ["studio", ...words] : words;

  if (command === "--version" || command === "-v" || command === "version") return console.log(VERSION);
  if (command === "--help" || command === "-h" || command === "help") return console.log(usage());
  if (!isCommand(command)) {
    console.error(`unknown command: ${command}\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  const spec = COMMANDS[command];
  if (spec.kind === "studio") return studio(command as "studio" | "dev" | "start", rest, { dryRun });

  const { command: bin, args } = cliCommand(spec.entry);
  const resolved = { command: bin, args: [...args, ...planArgs(command, rest, process.cwd())], cwd: ROOT };
  const env = {
    ...process.env,
    AGENTCUT_ROOT: ROOT,
    AGENTCUT_VERSION: VERSION,
    ...(process.env.AGENTCUT_WORKSPACE ? { AGENTCUT_WORKSPACE: path.resolve(process.env.AGENTCUT_WORKSPACE) } : {}),
  };

  if (dryRun) {
    const { WORKSPACE } = await import("@agentcut/core/common/server/config");
    console.log(JSON.stringify({ ...resolved, root: ROOT, checkout: IS_CHECKOUT, workspace: env.AGENTCUT_WORKSPACE ?? WORKSPACE }));
    return;
  }
  if (IS_CHECKOUT && !fs.existsSync(path.join(ROOT, "node_modules", "tsx"))) throw new Error(`tsx not found — run "pnpm install" in ${ROOT}`);

  const child = spawn(resolved.command, resolved.args, { cwd: resolved.cwd, env, stdio: "inherit", shell: WIN });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
