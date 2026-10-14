/**
 * The website on the owner's server: the same Hono app the Worker serves (`src/index.tsx`),
 * with node around it instead of workerd. Only the surroundings differ — Postgres is a TCP
 * connection beside the app rather than a Hyperdrive binding, the files in `public/` are
 * served by this process rather than by Cloudflare's asset runtime, and nginx terminates
 * TLS in front of it. The routes, the views and the registry are one implementation.
 *
 * Production runs the esbuild bundle (`scripts/build-server.mjs`) under pm2 as
 * `agentcut-web`; `deploy/` holds the pm2, nginx and deploy configuration. Locally:
 * `node --experimental-strip-types src/node.ts` with DATABASE_URL set, or `pnpm dev`
 * for the workerd copy.
 *
 * Read from the environment, or from a `.env` beside this file's directory root:
 *   DATABASE_URL           postgres://agentcut_app:…@<db host>:5432/agentcut?sslmode=require
 *   PORT                   the port nginx proxies to (default 3013)
 *   CLERK_SECRET_KEY       accounts; without the pair, nobody can sign in and submitting
 *   CLERK_PUBLISHABLE_KEY  a pack is the only thing that needs an account
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type ExecutionContext } from "hono";
import app from "./index";
import type { AppEnv, Bindings } from "./env";

/** The deploy folder: `public/`, `migrations/` and `.env` sit beside `dist/` there, as they do here. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const envFile = path.join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Set DATABASE_URL to the marketplace's Postgres. See deploy/env.example.");
  process.exit(1);
}

/** The bindings the app reads, filled from the environment instead of from wrangler. */
const env = {
  // `lib/db.ts` only ever reads the connection string off it.
  HYPERDRIVE: { connectionString: databaseUrl } as Bindings["HYPERDRIVE"],
  DEV_LOGIN: process.env.DEV_LOGIN === "1" ? "1" : "0",
  DEV_GITHUB_LOGIN: process.env.DEV_GITHUB_LOGIN,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
} satisfies Bindings;

// The static files first, as Cloudflare's asset runtime does in front of the Worker; what
// is not a file there falls through to the app. serveStatic resolves its root against the
// working directory, so the path is relative to wherever pm2 started us.
const publicDir = path.relative(process.cwd(), path.join(root, "public")) || ".";
const site = new Hono<AppEnv>();
site.use(
  "/*",
  serveStatic({
    root: publicDir,
    // The fonts never change, and styles.css and login.js are linked with a hash of their
    // contents (lib/assets.ts), so those URLs never change what they hold either. Anything
    // asked for without the hash may only be held for a while.
    onFound: (file, c) =>
      void c.header(
        "cache-control",
        file.includes("/fonts/") || c.req.query("v") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      ),
  }),
);
site.route("/", app);

/**
 * The request as the browser made it. nginx speaks http to this process, but the app
 * builds canonical URLs and checks a form's `Origin` against the request's own origin, so
 * the scheme has to be the one the browser used, not the one of the hop behind the proxy.
 */
function asTheBrowserSentIt(request: Request) {
  const proto = request.headers.get("x-forwarded-proto");
  if (!proto || proto === "http") return request;
  const url = new URL(request.url);
  if (url.protocol === `${proto}:`) return request;
  url.protocol = `${proto}:`;
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body,
    // Required by fetch for a streaming body, and missing from the DOM types.
    ...(body ? { duplex: "half" } : {}),
    redirect: request.redirect,
  } as RequestInit);
}

/** workerd's `waitUntil`, which the app uses to close its database client after the response. */
const executionCtx = {
  waitUntil: (promise: Promise<unknown>) => void Promise.resolve(promise).catch((error) => console.error(error)),
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const port = Number(process.env.PORT ?? 3013);
const server = serve(
  {
    fetch: (request: Request) => site.fetch(asTheBrowserSentIt(request), env, executionCtx),
    port,
    // nginx is the only thing in front of us, and it is on this machine.
    hostname: "127.0.0.1",
  },
  (info) => console.log(`agentcut web on http://127.0.0.1:${info.port}`),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
