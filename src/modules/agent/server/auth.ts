import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HarnessId } from "../lib/registry";

/**
 * Per-CLI auth probes: cheap, filesystem-only reads of what each tool writes
 * when you log in.
 *
 * The point is not certainty, it is a decent answer before a 15-minute run. A
 * CLI that is installed but signed out fails deep inside the job with an opaque
 * error; here it says "signed out" next to its name in the picker.
 *
 * Presence checks, not validity checks — an expired token still reads
 * `authenticated`, because the store looks populated. The first real run
 * remains the ground truth.
 *
 * `unknown` counts as signed IN everywhere it is consumed, on purpose. It is
 * what we answer when the credentials live somewhere we deliberately do not
 * look (the macOS keychain, an env var), and those machines are very often
 * working ones. The two mistakes do not cost the same: telling somebody who is
 * already set up that they are not is how a warning becomes something people
 * learn to click past.
 */
export type AuthState = "authenticated" | "unauthenticated" | "unknown";

export type AuthProbe = {
  authState: AuthState;
  /** An email or plan name to show beside the harness, when the store has one. */
  accountLabel?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(file: string): Promise<{ exists: boolean; value?: unknown }> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return { exists: false };
  }
  try {
    return { exists: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { exists: true };
  }
}

function str(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const found = value[key];
  return typeof found === "string" && found ? found : undefined;
}

/**
 * claude — login writes `oauthAccount` into the config JSON everywhere, and
 * `.credentials.json` on Linux/WSL. On macOS the tokens themselves live in the
 * keychain ("Claude Code-credentials"), which we do not query: that entry is
 * not scoped per CLAUDE_CONFIG_DIR, so it cannot answer for one install. The
 * config JSON sits at ~/.claude.json for a default setup — NOT inside ~/.claude.
 */
export async function probeClaude(configDir = process.env.CLAUDE_CONFIG_DIR): Promise<AuthProbe> {
  const dir = configDir ?? path.join(os.homedir(), ".claude");
  const configJson = configDir ? path.join(configDir, ".claude.json") : path.join(os.homedir(), ".claude.json");
  const [credentials, config] = await Promise.all([
    readJson(path.join(dir, ".credentials.json")),
    readJson(configJson),
  ]);
  const oauth = isRecord(credentials.value) ? credentials.value.claudeAiOauth : undefined;
  const account = isRecord(config.value) ? config.value.oauthAccount : undefined;
  if (str(oauth, "accessToken") || isRecord(account)) {
    const label = str(account, "emailAddress") ?? str(oauth, "subscriptionType");
    return { authState: "authenticated", ...(label ? { accountLabel: label } : {}) };
  }
  if (config.exists || credentials.exists) return { authState: "unauthenticated" };
  return { authState: "unknown" };
}

/** codex — `~/.codex/auth.json` holds either ChatGPT OAuth tokens or an API key. */
export async function probeCodex(home = process.env.CODEX_HOME): Promise<AuthProbe> {
  const dir = home ?? path.join(os.homedir(), ".codex");
  const auth = await readJson(path.join(dir, "auth.json"));
  if (!auth.exists) return { authState: "unknown" };
  const tokens = isRecord(auth.value) ? auth.value.tokens : undefined;
  const apiKey = str(auth.value, "OPENAI_API_KEY");
  if (str(tokens, "access_token") || apiKey) {
    const mode = str(auth.value, "auth_mode");
    return { authState: "authenticated", ...(mode ? { accountLabel: mode } : {}) };
  }
  return { authState: "unauthenticated" };
}

/**
 * cursor — `~/.cursor/cli-config.json` carries an `authInfo` block after login.
 * The tokens live in the keychain by default, so a config with no authInfo is
 * `unknown` rather than signed out: a keychain-only login is invisible here.
 */
export async function probeCursor(): Promise<AuthProbe> {
  const config = await readJson(path.join(os.homedir(), ".cursor", "cli-config.json"));
  const info = isRecord(config.value) ? config.value.authInfo : undefined;
  if (isRecord(info)) {
    const label = str(info, "email") ?? str(info, "displayName");
    return { authState: "authenticated", ...(label ? { accountLabel: label } : {}) };
  }
  return { authState: "unknown" };
}

/**
 * opencode — `auth.json` maps provider id → credentials, one entry per
 * `opencode auth login`. Providers can also arrive through env vars and config
 * files this probe cannot see, so a missing file is `unknown`, never signed out.
 */
export async function probeOpencode(): Promise<AuthProbe> {
  const dataDir = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  const auth = await readJson(path.join(dataDir, "opencode", "auth.json"));
  if (!auth.exists || !isRecord(auth.value)) return { authState: "unknown" };
  const providers = Object.keys(auth.value);
  if (!providers.length) return { authState: "unknown" };
  return {
    authState: "authenticated",
    accountLabel: providers.length === 1 ? providers[0] : `${providers.length} providers`,
  };
}

const PROBES: Record<HarnessId, () => Promise<AuthProbe>> = {
  claude: () => probeClaude(),
  codex: () => probeCodex(),
  cursor: probeCursor,
  opencode: probeOpencode,
};

export async function probeAuth(id: HarnessId): Promise<AuthProbe> {
  return PROBES[id]().catch(() => ({ authState: "unknown" }) as AuthProbe);
}

/** Installed, and nothing tells us it is signed out. See the note on `unknown`. */
export function usable(installed: boolean, authState: AuthState): boolean {
  return installed && authState !== "unauthenticated";
}
