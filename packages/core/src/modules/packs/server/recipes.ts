import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { IS_CHECKOUT, ROOT } from "../../../common/server/config";
import { FFMPEG, ensureBinaries } from "../../../common/server/bin";
import { listPacks, packFolder, packsDir } from "./packs";
import { resolveRecipeParams } from "../lib/recipes";
import { RECIPE_SCRATCH, RECIPE_TIMEOUT_MS, RECIPE_TOOLS } from "../data";
import type { InstalledPack, RecipeChildMessage, RecipeHostMessage, RecipeRunResult, RecipeView } from "../types";

/**
 * Pack recipes (decision 143): the code a pack may carry. A recipe is an edit-time
 * program, never a render-time one — it edits the project through the same tools a
 * person and an agent use, so its result is ordinary EDL that renders offline and can
 * be changed by hand afterwards.
 *
 * Three walls, in the order they are met:
 * 1. **Trust.** Nothing runs until the owner has trusted this pack's exact code, by
 *    hash, from the pack's page or the terminal. No tool trusts; an agent cannot.
 * 2. **A process of its own**, started with Node's permission model: it reads only the
 *    pack's folder and its scratch folder, writes only the scratch folder, and has no
 *    network, no child processes, no workers and no environment.
 * 3. **A closed door back.** What it asks the host for is a short list of editor tools
 *    (`RECIPE_TOOLS`), the timeline, an upload from its scratch folder and ffmpeg run
 *    inside that folder. Every edit is a `project.edit`, logged like any other.
 */

/** Plain JavaScript on purpose: it runs untrusted recipes with nothing loaded but node. The CLI build copies it into dist/. */
const RUNNER = IS_CHECKOUT ? path.join(ROOT, "packages", "core", "src", "modules", "packs", "server", "recipe-runner.mjs") : path.join(ROOT, "dist", "recipe-runner.mjs");

/**
 * Fonts are the one thing outside its pack a recipe may read, so a card can be set in
 * a typeface this machine already has; a pack ships its own as the fallback.
 */
const FONT_DIRS = process.platform === "darwin"
  ? ["/System/Library/Fonts", "/Library/Fonts", path.join(os.homedir(), "Library", "Fonts")]
  : process.platform === "win32" ? [path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts")]
  : ["/usr/share/fonts", "/usr/local/share/fonts", path.join(os.homedir(), ".fonts")];

export async function listRecipes(): Promise<RecipeView[]> {
  return (await listPacks()).flatMap((pack) => pack.recipes.map((recipe) => ({ ...recipe, pack: pack.id, packName: pack.name, trusted: isTrusted(pack) })));
}

export const isTrusted = (pack: InstalledPack) => !!pack.recipesHash && pack.trustedRecipesHash === pack.recipesHash;

/** Only a person calls this: the workspace route behind the pack's page, and the terminal. */
export async function trustRecipes(id: string, trust: boolean): Promise<InstalledPack> {
  const pack = (await listPacks()).find((p) => p.id === id);
  if (!pack) throw new Error(`No installed pack named ${id}`);
  if (trust && !pack.recipes.length) throw new Error(`${pack.name} has no recipes to trust`);
  const next = { ...pack, trustedRecipesHash: trust ? pack.recipesHash : null };
  await fs.writeFile(path.join(packsDir(), `${id}.json`), JSON.stringify(next, null, 2));
  return next;
}

/** The installed code, file by file, for the owner to read before trusting it. Binary files are listed, not shown. */
export async function recipeSources(id: string): Promise<Array<{ file: string; bytes: number; text: string | null }>> {
  const pack = (await listPacks()).find((p) => p.id === id);
  if (!pack) throw new Error(`No installed pack named ${id}`);
  const out = [];
  for (const file of [...new Set([...pack.recipes.map((r) => r.file), ...pack.recipeFiles])]) {
    const bytes = await fs.readFile(path.join(packFolder(pack.id), file));
    out.push({ file, bytes: bytes.length, text: /\.(m?js|json|md|txt)$/i.test(file) ? bytes.toString("utf8") : null });
  }
  return out;
}

export type RecipeRunRequest = { pack: string; recipe: string; params?: Record<string, unknown> };
type Activity = (e: { kind: string; name?: string; text: string }) => void;

export async function runRecipe(projectId: string, request: RecipeRunRequest, onActivity?: Activity): Promise<RecipeRunResult> {
  const pack = (await listPacks()).find((p) => p.id === request.pack);
  if (!pack) throw new Error(`No installed pack named ${request.pack}`);
  const recipe = pack.recipes.find((r) => r.id === request.recipe);
  if (!recipe) throw new Error(`${pack.name} has no recipe named ${request.recipe}`);
  if (!isTrusted(pack))
    throw new Error(`${pack.name}'s recipes are not trusted on this machine. The owner trusts them after reading the code: Settings → Packs → ${pack.name} → Recipes.`);
  const params = resolveRecipeParams(recipe, request.params ?? {});
  // Node's permission model compares real paths: /var/folders is /private/var/folders on macOS.
  const dir = await fs.realpath(packFolder(pack.id));
  const file = path.resolve(dir, recipe.file);
  if (!file.startsWith(dir + path.sep)) throw new Error(`Recipe file escapes the pack: ${recipe.file}`);

  const run = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `agentcut-recipe-${pack.id}-`)));
  const scratch = path.join(run, RECIPE_SCRATCH);
  await fs.mkdir(scratch, { recursive: true });
  const logs: string[] = [];
  const label = `recipe:${pack.id}/${recipe.id}`;
  const log = (text: string) => { logs.push(text); onActivity?.({ kind: "log", name: label, text }); };
  try {
    const fonts = (await Promise.all(FONT_DIRS.map((d) => fs.realpath(/*turbopackIgnore: true*/ d).catch(() => null)))).filter((d): d is string => !!d);
    const runner = await fs.realpath(RUNNER);
    const child = spawn(process.execPath, [
      "--permission", `--allow-fs-read=${dir}`, `--allow-fs-read=${run}`, `--allow-fs-read=${runner}`, ...fonts.map((d) => `--allow-fs-read=${d}`), `--allow-fs-write=${scratch}`,
      runner,
    ], { cwd: scratch, env: {} as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.stdout?.on("data", (chunk) => log(String(chunk).trim()));
    const send = (message: RecipeHostMessage) => { if (child.connected) child.send(message); };

    const result = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${recipe.label} did not finish in ${RECIPE_TIMEOUT_MS / 60_000} minutes; what it edited before that stays.`)); }, RECIPE_TIMEOUT_MS);
      let settled = false;
      const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
      child.on("message", async (raw) => {
        const message = raw as RecipeChildMessage;
        if (message.type === "log") return log(message.text);
        if (message.type === "done") return settle(() => resolve(message.result));
        if (message.type === "failed") return settle(() => reject(new Error(`${recipe.label}: ${message.error}`)));
        if (message.type !== "request") return;
        try {
          send({ type: "reply", id: message.id, ok: true, value: await answer(projectId, message.method, message.payload, scratch) });
        } catch (error) {
          send({ type: "reply", id: message.id, ok: false, error: (error as Error).message });
        }
      });
      child.on("error", (error) => settle(() => reject(error)));
      child.on("exit", (code) => settle(() => reject(new Error(`${recipe.label} stopped (exit ${code})${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`))));
      send({ type: "start", file, params, projectId, scratch, fonts, pack: { id: pack.id, dir, assets: pack.assets } });
    });
    const { readEditor } = await import("../../editor/server/store");
    return { pack: pack.id, recipe: recipe.id, result, logs, revision: readEditor(projectId).revision };
  } finally {
    await fs.rm(run, { recursive: true, force: true });
  }
}

/** Everything a recipe can ask the host for. Anything else is refused. */
async function answer(projectId: string, method: string, payload: unknown, scratch: string): Promise<unknown> {
  const { runReportedTool } = await import("../../project/server/activity-log");
  if (method === "call") {
    const tool = (payload as { tool?: unknown })?.tool;
    if (typeof tool !== "string" || !(RECIPE_TOOLS as readonly string[]).includes(tool))
      throw new Error(`A recipe may call ${RECIPE_TOOLS.join(", ")}; not ${String(tool)}`);
    return runReportedTool(projectId, payload, { via: "recipe" });
  }
  if (method === "timeline") return timeline(projectId, (payload as { sequenceId?: string })?.sequenceId);
  if (method === "upload") {
    const { file, name } = payload as { file: string; name?: string };
    const target = inside(scratch, file);
    const base64 = (await fs.readFile(target)).toString("base64");
    return runReportedTool(projectId, { tool: "assets.upload", name: name || path.basename(target), base64 }, { via: "recipe" });
  }
  if (method === "ffmpeg") {
    const args = (payload as { args?: unknown })?.args;
    if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) throw new Error("ffmpeg takes a list of strings");
    // Names inside the scratch folder only: a slash would let it read or write anywhere.
    // A backslash is how a filtergraph escapes a comma, and a separator only on Windows.
    const outside = args.find((a) => a.includes("/") || a.includes("..") || (process.platform === "win32" && a.includes("\\")));
    if (outside) throw new Error(`ffmpeg arguments name files in the scratch folder only, without slashes: ${outside}`);
    await ensureBinaries();
    return new Promise((resolve, reject) => {
      const child = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: scratch, env: {} as NodeJS.ProcessEnv });
      let err = "";
      child.stderr.on("data", (chunk) => { err = (err + chunk).slice(-2000); });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve({ ok: true }) : reject(new Error(`ffmpeg failed: ${err.trim()}`))));
    });
  }
  throw new Error(`Unknown request: ${method}`);
}

function inside(scratch: string, file: string) {
  const target = path.resolve(scratch, file);
  if (!target.startsWith(scratch + path.sep)) throw new Error(`Only files in the recipe's scratch folder can be uploaded: ${file}`);
  return target;
}

/** The sequence as the renderer places it, in output seconds: the one timing a recipe may build on. */
async function timeline(projectId: string, sequenceId?: string) {
  const { readEditor } = await import("../../editor/server/store");
  const { sequenceFrames } = await import("../../editor/lib/sequences");
  const { edl, revision } = readEditor(projectId);
  const sequence = sequenceId ? edl.sequences.find((s) => s.id === sequenceId) : edl.sequences[0];
  if (!sequence) throw new Error(sequenceId ? `No sequence ${sequenceId}` : "This project has no video yet");
  const fps = sequence.output.fps;
  const resolved = sequenceFrames(sequence);
  return {
    revision, sequenceId: sequence.id, fps, output: sequence.output, duration: resolved.duration / fps,
    items: resolved.items.map((r) => ({
      id: r.item.id, layer: r.item.layer ?? 0, mediaId: r.item.mediaId, title: r.item.clip.title,
      from: r.from / fps, duration: r.duration / fps, transitionIn: r.transition ? r.transition.frames / fps : 0,
    })),
  };
}
