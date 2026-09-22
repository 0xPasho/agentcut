import { db } from "./db";

/**
 * Keys for the optional online providers.
 *
 * Until now these only existed as environment variables, which means the only way
 * to give the app a Pexels key was to restart it with the variable set. They belong
 * in settings: they are workspace configuration, like the harness choice next to them.
 *
 * Three rules, and they are the whole design:
 *
 *  - **A secret is never read back.** Nothing here returns a stored value to a caller
 *    that is not about to spend it on an HTTP request. The settings page is told
 *    whether a key is set and where it came from, never what it is. There is no
 *    "reveal" and no masked tail: a key that cannot be shown cannot be shoulder-surfed,
 *    screen-shared or pasted into a bug report.
 *  - **A secret never reaches an agent.** They live in the settings table inside the
 *    workspace database, not in a file beside the run directories an agent reads, and
 *    they are never put into `process.env`, which `spawnStream` copies wholesale into
 *    every harness it starts.
 *  - **A secret is never logged.** No value is passed to `recordActivity`, an event
 *    row or a thrown error message. Failures name the provider, not the credential.
 *
 * The environment still works and still wins nothing: a key saved here takes
 * precedence, and the page says when a variable is what is answering, because
 * "I cleared it and it still works" is otherwise unexplainable.
 */
export type ProviderKeyId = "pexels" | "unsplash" | "google" | "googleCx";

export type ProviderKeyInfo = {
  id: ProviderKeyId;
  label: string;
  /** The environment variable that has always set this, still honoured as a fallback. */
  env: string;
  /** False for identifiers that are not credentials, like a Programmable Search engine id. */
  secret: boolean;
  /** One line of what it unlocks. */
  what: string;
  /** Where to get one. */
  from: string;
  set: boolean;
  source: "workspace" | "environment" | "none";
  /** Only ever present for `secret: false` entries. */
  value?: string;
};

const KEYS: Array<Omit<ProviderKeyInfo, "set" | "source" | "value">> = [
  { id: "pexels", label: "Pexels key", env: "AGENTCUT_PEXELS_KEY", secret: true,
    what: "Stock photography for pictures over the voice.", from: "https://www.pexels.com/api/" },
  { id: "unsplash", label: "Unsplash key", env: "AGENTCUT_UNSPLASH_KEY", secret: true,
    what: "Stock photography, a second source when Pexels has nothing.", from: "https://unsplash.com/developers" },
  { id: "google", label: "Google Programmable Search key", env: "AGENTCUT_GOOGLE_CSE_KEY", secret: true,
    what: "Web image search. Results carry no verified licence, so it stays off by default.", from: "https://developers.google.com/custom-search/v1/overview" },
  { id: "googleCx", label: "Google search engine id", env: "AGENTCUT_GOOGLE_CSE_CX", secret: false,
    what: "Which programmable search engine to ask. Not a credential.", from: "https://programmablesearchengine.google.com/" },
];

const SCOPE = "secret";

db.exec(`CREATE TABLE IF NOT EXISTS settings (
  scope TEXT NOT NULL,
  key   TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (scope, key)
)`);

function stored(id: ProviderKeyId): string {
  const row = db.prepare("SELECT value FROM settings WHERE scope = ? AND key = ?").get(SCOPE, id) as { value: string } | undefined;
  return row?.value ?? "";
}

/**
 * The value to spend on a request. Synchronous because the providers read it in
 * the middle of a search, and an await there would be the only async thing in the
 * function. Callers must not hold on to what they get back.
 */
export function providerKey(id: ProviderKeyId): string {
  return stored(id) || process.env[KEYS.find((k) => k.id === id)!.env] || "";
}

export const isProviderKeyId = (id: string): id is ProviderKeyId => KEYS.some((k) => k.id === id);

/** What the settings page is allowed to know: that a key exists, and who answered. */
export function providerKeys(): ProviderKeyInfo[] {
  return KEYS.map((key) => {
    const own = stored(key.id);
    const env = process.env[key.env] ?? "";
    const source = own ? "workspace" : env ? "environment" : "none";
    return {
      ...key,
      set: !!(own || env),
      source,
      ...(key.secret ? {} : { value: own || env }),
    } as ProviderKeyInfo;
  });
}

/** Save a key, or clear it with an empty string so the environment answers again. */
export function setProviderKey(id: string, value: string): ProviderKeyInfo[] {
  if (!isProviderKeyId(id)) throw new Error(`Unknown provider key: ${id}`);
  const trimmed = value.trim();
  if (!trimmed) db.prepare("DELETE FROM settings WHERE scope = ? AND key = ?").run(SCOPE, id);
  else db.prepare("INSERT INTO settings (scope, key, value) VALUES (?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value").run(SCOPE, id, trimmed);
  return providerKeys();
}
