/**
 * The one place that finds Remotion. Every render, still and sampled frame goes
 * through here, so a checkout and an installed CLI differ in exactly one file:
 *
 * - a checkout loads `@remotion/*` from its node_modules and bundles the compositions
 *   in packages/render from source, as it always has;
 * - an installed CLI fetches `@agentcut/render` on the first render: the compositions
 *   already bundled at release time, and the renderer that plays them.
 *
 * The requires are built at run time on purpose. A literal `import("@remotion/renderer")`
 * is something the CLI bundler and the studio's file trace would both follow, and the
 * renderer is what keeps both of them small by not being in them.
 */
import { createRequire } from "node:module";
import path from "node:path";
import type * as RendererModule from "@remotion/renderer";
import { IS_CHECKOUT, ROOT } from "../../../common/server/root";
import { readFileSync, rmSync } from "node:fs";
import { BROWSER_FILE, componentDir, ensureRemotionBrowser, ensureRender, isInstalled, terminalProgress, type ProgressSink } from "../../../common/server/runtime";

export type Renderer = typeof RendererModule;

const checkoutRequire = () => createRequire(path.join(ROOT, "packages", "core", "package.json"));

let installing: Promise<string> | null = null;

/** Fetch the renderer once per process, however many callers ask at the same moment. */
function installed(onProgress?: ProgressSink): Promise<string> {
  installing ??= ensureRender(onProgress ?? terminalProgress()).catch((error) => { installing = null; throw error; });
  return installing;
}

/** True when a render can start without downloading anything first. */
export function rendererReady(): boolean {
  return IS_CHECKOUT || isInstalled("render");
}

/** Start the download without waiting for it, for callers that would rather say "not yet" than block. */
export function prepareRenderer(): void {
  if (!rendererReady()) installed().catch(() => {});
}

/**
 * Every call that opens a browser, told which one. Remotion would otherwise look for its
 * download beside whatever directory the process was started in — the studio's, the
 * CLI's install — and fetch a second hundred megabytes into each.
 */
const PINNED = ["renderMedia", "renderStill", "renderFrames", "selectComposition", "getCompositions", "ensureBrowser", "openBrowser"] as const;
function pinBrowser(renderer: Renderer, executable: string): Renderer {
  const pinned: Record<string, unknown> = { ...renderer };
  for (const name of PINNED) {
    const original = renderer[name] as unknown as (options?: Record<string, unknown>, ...rest: unknown[]) => unknown;
    if (typeof original !== "function") continue;
    pinned[name] = (options: Record<string, unknown> = {}, ...rest: unknown[]) => original({ browserExecutable: executable, ...options }, ...rest);
  }
  return pinned as Renderer;
}

let checkoutBrowser: Promise<string> | null = null;

export async function loadRenderer(onProgress?: ProgressSink): Promise<Renderer> {
  if (IS_CHECKOUT) {
    const renderer = checkoutRequire()("@remotion/renderer") as Renderer;
    // One browser per checkout, at its root, where it has always been.
    checkoutBrowser ??= ensureRemotionBrowser(ROOT, path.join(ROOT, "packages", "core", "package.json"), onProgress ?? terminalProgress())
      .catch((error) => { checkoutBrowser = null; throw error; });
    return pinBrowser(renderer, await checkoutBrowser);
  }
  const dir = await installed(onProgress);
  const renderer = createRequire(path.join(dir, "package.json"))("@remotion/renderer") as Renderer;
  const { executable } = JSON.parse(readFileSync(path.join(dir, BROWSER_FILE), "utf8")) as { executable: string };
  return pinBrowser(renderer, path.join(dir, executable));
}

/**
 * The bundle is written to a fresh temporary directory and nobody was removing it.
 *
 * One per process that renders anything — the server, the CLI, a test — about thirty
 * megabytes each, kept until the operating system decides to sweep its temp folder,
 * which on a Mac can be never. A day of restarting a dev server and running the render
 * tests left three hundred and fifty of them on this machine: ten gigabytes of webpack
 * output for a bundle that is rebuilt every time anyway.
 *
 * Removed when this process ends. Best effort by nature — a process that is killed
 * outright leaves its directory behind — and safe because the directory belongs to this
 * process alone, which is the whole reason `enableCaching` is off.
 */
function removeWhenThisProcessEnds(dir: string) {
  const sweep = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* the temp folder is not ours to insist on */ } };
  process.once("exit", sweep);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { sweep(); process.exit(0); });
}

let cachedBundle: Promise<string> | null = null;

/** Where the compositions are served from: a fresh webpack bundle in a checkout, the release's prebuilt one when installed. */
export function getBundle(onProgress?: ProgressSink): Promise<string> {
  if (cachedBundle) return cachedBundle;
  cachedBundle = (IS_CHECKOUT ? bundleFromSource() : installed(onProgress).then((dir) => path.join(dir, "bundle")))
    .catch((error) => { cachedBundle = null; throw error; });
  return cachedBundle;
}

async function bundleFromSource(): Promise<string> {
  const load = checkoutRequire();
  const { bundle } = load("@remotion/bundler") as typeof import("@remotion/bundler");
  const { enableTailwind } = load("@remotion/tailwind-v4") as typeof import("@remotion/tailwind-v4");
  const dir = await bundle({
    entryPoint: path.join(ROOT, "packages", "render", "src", "index.ts"),
    publicDir: null,
    // CLI and web processes may bundle concurrently. Reuse the finished in-process
    // bundle, but do not let independent renderers share a mutable disk cache.
    enableCaching: false,
    webpackOverride: enableTailwind,
  });
  removeWhenThisProcessEnds(dir);
  return dir;
}

/** The installed renderer's directory, for diagnostics; null in a checkout. */
export const renderRuntimeDir = () => (IS_CHECKOUT ? null : componentDir("render"));
