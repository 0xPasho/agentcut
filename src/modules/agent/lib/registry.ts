/**
 * The agent CLIs this app can drive, and what we know about each one without
 * touching the machine.
 *
 * `driver` says whether we can actually RUN it, which is a separate question
 * from whether it is installed. Both get shown: a harness with no driver
 * renders disabled with its reason, because hiding it reads as "not installed",
 * which is a different and wrong story.
 */
export type HarnessId = "claude" | "codex" | "cursor" | "opencode";

export type Harness = {
  id: HarnessId;
  label: string;
  /** Binary name as it appears on PATH. */
  bin: string;
  /** Env var that overrides the binary path, for a CLI installed somewhere odd. */
  binEnv: string;
  /** How the CLI spells a "use the account default" model. Empty means omit the flag. */
  inheritLabel: string;
};

export const HARNESSES: Harness[] = [
  { id: "claude", label: "Claude Code", bin: "claude", binEnv: "AGENTCUT_CLAUDE_BIN", inheritLabel: "The CLI's default model" },
  { id: "codex", label: "Codex", bin: "codex", binEnv: "AGENTCUT_CODEX_BIN", inheritLabel: "The CLI's default model" },
  // The binary is `cursor-agent`, not `cursor` — `cursor` is the editor, and on a
  // machine with both, spawning the wrong one opens a window instead of answering.
  { id: "cursor", label: "Cursor", bin: "cursor-agent", binEnv: "AGENTCUT_CURSOR_BIN", inheritLabel: "Auto (Cursor picks)" },
  { id: "opencode", label: "OpenCode", bin: "opencode", binEnv: "AGENTCUT_OPENCODE_BIN", inheritLabel: "The configured default" },
];

export const HARNESS_IDS = HARNESSES.map((h) => h.id);

export function harness(id: string): Harness | undefined {
  return HARNESSES.find((h) => h.id === id);
}

/** Order the picker shows them in, and the order `resolveProvider` falls back through. */
export function orderedHarnesses(preferred?: string): Harness[] {
  const first = preferred ? harness(preferred) : undefined;
  return first ? [first, ...HARNESSES.filter((h) => h.id !== first.id)] : [...HARNESSES];
}
