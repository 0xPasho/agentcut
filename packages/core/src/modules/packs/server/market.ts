/**
 * The marketplace, from this side: find packs, sign in, publish one.
 *
 * Installing is not here on purpose. A marketplace pack is a URL (`/r/<name>/<version>`)
 * that `packs.inspect` and `packs.import` already read like any other — the same preview,
 * the same untrusted recipes, the same copy into the workspace. Search hands back that
 * URL as `source`, and everything after it is the path a pack typed by hand takes.
 *
 * The same functions back `agentcut packs search | install | publish`, `agentcut login`,
 * the Marketplace panel in Settings → Packs and the agent's `packs.search` tool.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HOME } from "../../../common/server/root";
import { MARKET_URL, PUBLISH_LIMITS } from "../data";
import { DeviceLogin, MarketCredentials, MarketPack, MarketPackDetail, MarketUser, PackManifest, type PublishedPack } from "../types";

export const marketUrl = () => (process.env.AGENTCUT_MARKET || MARKET_URL).replace(/\/+$/, "");
const CREDENTIALS = () => path.join(HOME, "credentials.json");

export class MarketError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "MarketError";
  }
}

async function call<T>(route: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  let res: Response;
  try {
    res = await fetch(`${marketUrl()}${route}`, { ...init, headers });
  } catch (error) {
    throw new MarketError(`Cannot reach the marketplace at ${marketUrl()} (${(error as Error).message})`, 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: unknown };
  if (!res.ok) {
    const detail = body.issues ? `: ${JSON.stringify(body.issues)}` : "";
    throw new MarketError(`${body.error ?? `The marketplace answered ${res.status}`}${detail}`, res.status);
  }
  return body as T;
}

/* ------------------------------------------------------------------ browsing */

export async function searchPacks(query = "", limit = 20): Promise<MarketPack[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query.trim()) params.set("q", query.trim());
  const { packs } = await call<{ packs: unknown[] }>(`/api/packs?${params}`);
  return packs.map((p) => MarketPack.parse(p));
}

export async function marketPack(name: string): Promise<MarketPackDetail> {
  const { pack } = await call<{ pack: unknown }>(`/api/packs/${encodeURIComponent(name)}`);
  return MarketPackDetail.parse(pack);
}

/**
 * `name` or `name@version` to the URL `importPack` reads. A version that was never
 * published is refused here, with the ones that were, rather than as a 404 on pack.json.
 */
export async function marketSource(ref: string): Promise<string> {
  const [name, version] = ref.split("@");
  const pack = await marketPack(name);
  if (!version) return pack.source;
  if (!pack.versions.some((v) => v.version === version)) {
    throw new MarketError(`${name} has no version ${version}. Published: ${pack.versions.map((v) => v.version).join(", ")}`, 404);
  }
  return `${marketUrl()}/r/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
}

/* ------------------------------------------------------------------ account */

async function readAll(): Promise<MarketCredentials> {
  const text = await fs.readFile(CREDENTIALS(), "utf8").catch(() => "{}");
  const parsed = MarketCredentials.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : {};
}

async function writeAll(all: MarketCredentials) {
  await fs.mkdir(HOME, { recursive: true });
  // The token publishes under your name: readable by you alone.
  await fs.writeFile(CREDENTIALS(), JSON.stringify(all, null, 2), { mode: 0o600 });
  await fs.chmod(CREDENTIALS(), 0o600).catch(() => {});
}

/** The signed-in account for the current marketplace, or null. */
export async function signedIn(): Promise<{ token: string; user: MarketUser } | null> {
  return (await readAll())[marketUrl()] ?? null;
}

/** Step one of `agentcut login`: a code for the person to confirm in the browser. */
export async function startLogin(): Promise<DeviceLogin> {
  return DeviceLogin.parse(await call("/api/auth/device", { method: "POST", body: "{}" }));
}

/** Step two: wait for the confirmation, then remember the token for this marketplace. */
export async function finishLogin(login: DeviceLogin, options: { signal?: AbortSignal; sleep?: (ms: number) => Promise<void> } = {}): Promise<MarketUser> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + login.expiresIn * 1000;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new MarketError("Login cancelled", 0);
    try {
      const { token, user } = await call<{ token: string; user: unknown }>("/api/auth/token", { method: "POST", body: JSON.stringify({ deviceCode: login.deviceCode }) });
      const parsed = MarketUser.parse(user);
      await writeAll({ ...(await readAll()), [marketUrl()]: { token, user: parsed, at: Date.now() } });
      return parsed;
    } catch (error) {
      if (!(error instanceof MarketError) || error.status !== 428) throw error;
    }
    await sleep(login.interval * 1000);
  }
  throw new MarketError("The login code expired before it was confirmed. Run agentcut login again.", 410);
}

export async function logout(): Promise<boolean> {
  const all = await readAll();
  if (!all[marketUrl()]) return false;
  delete all[marketUrl()];
  await writeAll(all);
  return true;
}

/** Who the marketplace says the stored token belongs to; null when signed out or the token was revoked. */
export async function whoami(): Promise<MarketUser | null> {
  const account = await signedIn();
  if (!account) return null;
  try {
    const { user } = await call<{ user: unknown }>("/api/me", { token: account.token });
    return MarketUser.parse(user);
  } catch (error) {
    if (error instanceof MarketError && error.status === 401) return null;
    throw error;
  }
}

/* ------------------------------------------------------------------ publishing */

async function filesIn(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    // Hidden files and dependencies are never part of a pack.
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesIn(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/** What a publish would send, checked locally first: the manifest parses, nothing it names is missing, and it fits. */
export async function packForPublish(dirText: string) {
  const dir = path.resolve(dirText.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  const raw = await fs.readFile(path.join(dir, "pack.json"), "utf8").catch(() => null);
  if (raw === null) throw new MarketError(`No pack.json in ${dir}. Export a pack from Settings → Packs, or point at its folder.`, 400);
  const manifest = PackManifest.parse(JSON.parse(raw));
  const files = await filesIn(dir);
  const named = [
    ...manifest.templates.map((id) => `templates/${id}.json`), ...manifest.rules.map((id) => `rules/${id}.json`),
    ...manifest.assets.map((a) => a.file), ...manifest.recipes.map((r) => r.file), ...manifest.recipeFiles,
    ...[manifest.style, manifest.review].filter(Boolean),
  ];
  const missing = named.filter((file) => !files.includes(file));
  if (missing.length) throw new MarketError(`pack.json names files that are not in ${dir}: ${missing.join(", ")}`, 400);
  if (files.length > PUBLISH_LIMITS.files) throw new MarketError(`A pack holds at most ${PUBLISH_LIMITS.files} files; this one has ${files.length}`, 400);
  let bytes = 0;
  for (const file of files) bytes += (await fs.stat(path.join(dir, file))).size;
  if (bytes > PUBLISH_LIMITS.bytes) throw new MarketError(`A pack is at most ${PUBLISH_LIMITS.bytes / 1024 / 1024} MB; this one is ${(bytes / 1024 / 1024).toFixed(1)} MB`, 400);
  return { dir, manifest, files, bytes };
}

export async function publishPack(dirText: string): Promise<PublishedPack> {
  const account = await signedIn();
  if (!account) throw new MarketError(`Not signed in to ${marketUrl()}. Run agentcut login first.`, 401);
  const { dir, files } = await packForPublish(dirText);
  const body = { files: await Promise.all(files.map(async (file) => ({ path: file, base64: (await fs.readFile(path.join(dir, file))).toString("base64") }))) };
  return call<PublishedPack>("/api/packs", { method: "POST", token: account.token, body: JSON.stringify(body) });
}
