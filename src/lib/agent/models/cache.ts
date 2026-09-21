import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACE, ensureWorkspace } from "../../config";
import { HARNESS_IDS, type HarnessId } from "../registry";
import { curatedCatalog, mergeCatalog, CURATED, type HarnessCatalog, type ModelInfo } from "./catalog";
import { discoverModels } from "./discover";

/**
 * The model catalog on disk, so opening the picker never waits on a CLI.
 *
 * Discovery spawns a process per harness and can take seconds. Putting that in
 * front of a popover would make the picker feel broken on exactly the machines
 * that have the most harnesses installed. So: the cached answer is served
 * immediately, a stale one triggers a background refresh that lands on the next
 * open, and the Refresh button forces the round trip when the user knows
 * something changed.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

function cacheFile(): string {
  ensureWorkspace();
  return path.join(WORKSPACE, "model-catalog.json");
}

type CacheFile = Partial<Record<HarnessId, { models: ModelInfo[]; fetchedAt: number }>>;

let memory: CacheFile | null = null;
/** One refresh per harness at a time; a second caller joins the first. */
const inflight = new Map<HarnessId, Promise<HarnessCatalog>>();

async function readCache(): Promise<CacheFile> {
  if (memory) return memory;
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(), "utf8")) as unknown;
    memory = typeof parsed === "object" && parsed !== null ? (parsed as CacheFile) : {};
  } catch {
    memory = {};
  }
  return memory;
}

async function writeCache(next: CacheFile): Promise<void> {
  memory = next;
  // Best effort: a catalog we could not persist still works for this process,
  // and failing a picker open over a cache write would be the wrong trade.
  await fs.writeFile(cacheFile(), JSON.stringify(next, null, 2)).catch(() => {});
}

/** Drop the cache — used by tests and by a workspace switch. */
export function resetCatalogCache(): void {
  memory = null;
  inflight.clear();
}

/**
 * The catalog for one harness, without ever blocking on a CLI.
 *
 * Returns whatever is cached (or curated, on a cold machine) and kicks off a
 * refresh when the entry is missing or past its TTL. The refresh's result is
 * NOT awaited on purpose — that is the whole point of the cache.
 */
export async function catalogFor(id: HarnessId, options: { installed?: boolean } = {}): Promise<HarnessCatalog> {
  const cache = await readCache();
  const entry = cache[id];
  const fresh = entry && Date.now() - entry.fetchedAt < TTL_MS;
  if (options.installed !== false && !fresh) void refreshCatalog(id).catch(() => {});
  if (!entry) return curatedCatalog(id);
  return { models: mergeCatalog(CURATED[id] ?? [], entry.models), source: "cli", fetchedAt: entry.fetchedAt };
}

/** Run discovery now and store the result. Rejects if the CLI does not answer. */
export async function refreshCatalog(id: HarnessId): Promise<HarnessCatalog> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const task = (async () => {
    const models = await discoverModels(id);
    // An empty answer is not a catalog. A CLI that returns nothing — signed
    // out, misconfigured — must not wipe the rows the user was choosing from.
    if (!models.length) throw new Error(`${id} returned no models`);
    const fetchedAt = Date.now();
    const cache = await readCache();
    await writeCache({ ...cache, [id]: { models, fetchedAt } });
    return { models: mergeCatalog(CURATED[id] ?? [], models), source: "cli" as const, fetchedAt };
  })();
  inflight.set(id, task);
  try {
    return await task;
  } finally {
    inflight.delete(id);
  }
}

/** Refresh every installed harness, reporting per-harness failures instead of throwing. */
export async function refreshAll(installed: readonly HarnessId[] = HARNESS_IDS): Promise<
  Array<{ id: HarnessId; ok: boolean; error?: string; count: number }>
> {
  return Promise.all(
    installed.map(async (id) => {
      try {
        const catalog = await refreshCatalog(id);
        return { id, ok: true, count: catalog.models.length };
      } catch (error) {
        return { id, ok: false, error: (error as Error).message, count: 0 };
      }
    }),
  );
}
