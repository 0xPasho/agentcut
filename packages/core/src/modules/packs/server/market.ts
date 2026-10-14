/**
 * The marketplace, from this side: find packs and resolve one to the URL it installs from.
 *
 * Installing is not here on purpose. A listed pack is a URL on raw.githubusercontent, at
 * the commit that version is pinned to, and `packs.inspect` and `packs.import` already
 * read it like any other URL — the same preview, the same untrusted recipes, the same copy
 * into the workspace. Search hands back that URL as `source`.
 *
 * Nothing here signs in. A pack is submitted on the website, by the person whose GitHub
 * account owns the repository, so this machine never holds a marketplace credential.
 *
 * The same functions back `agentcut packs search | install | submit`, the Marketplace
 * panel in Settings → Packs and the agent's `packs.search` tool.
 */
import { MARKET_URL } from "../data";
import { MarketPack, MarketPackDetail } from "../types";

export const marketUrl = () => (process.env.AGENTCUT_MARKET || MARKET_URL).replace(/\/+$/, "");

export class MarketError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "MarketError";
  }
}

async function call<T>(route: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
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
 * listed is refused here, with the ones that were, rather than as a 404 on pack.json.
 */
export async function marketSource(ref: string): Promise<string> {
  const [name, version] = ref.split("@");
  const pack = await marketPack(name);
  if (!version) return pack.source;
  const found = pack.versions.find((v) => v.version === version);
  if (!found) {
    throw new MarketError(`${name} has no version ${version}. Listed: ${pack.versions.map((v) => v.version).join(", ")}`, 404);
  }
  return found.source;
}

/* ---------------------------------------------------------------- submitting */

/**
 * Where somebody submits a pack: the marketplace's own form, which reads the repository
 * and lists it. Submitting needs the GitHub account that owns the repository, so it
 * happens in a browser rather than from a token on this machine.
 */
export function submitUrl(repo?: string): string {
  const url = new URL("/submit", `${marketUrl()}/`);
  if (repo?.trim()) url.searchParams.set("repo", repo.trim());
  return url.toString();
}
