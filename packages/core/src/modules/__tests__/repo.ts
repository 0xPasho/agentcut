/** The repository, for tests that run the CLI or read files beside the code. */
import path from "node:path";

export const REPO = path.resolve(import.meta.dirname, "../../../../..");

/** `agentcut …` from source, exactly as `pnpm agentcut` runs it: node, tsx's loader, the CLI's entry. */
export function agentcut(...args: string[]): [string, string[]] {
  return [process.execPath, ["--import", path.join(REPO, "node_modules", "tsx", "dist", "loader.mjs"), path.join(REPO, "packages", "cli", "src", "bin.ts"), ...args]];
}
