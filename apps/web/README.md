# @agentcut/web

The hosted half of agentcut: the landing page and the packs marketplace, live at
[agentcut.studio](https://agentcut.studio). One Hono app (server-rendered `hono/jsx`, no
client framework) and a Postgres database on the owner's server.

It runs where the owner's other sites run: node under pm2 behind nginx, on the box
postgun.ai is on, with the database beside it — see [deploy/](./deploy/). The same app also
runs in workerd, which is what `pnpm dev` and the tests use, so `wrangler.jsonc` and the
`HYPERDRIVE` binding are development tools here, not what production serves.

**A pack is a GitHub repository.** The marketplace stores no pack files: it keeps the
repository, the folder, the branch and the commit each version is pinned to, and hands out
`raw.githubusercontent.com/<owner>/<repo>/<sha>/<folder>` as the pack's `source` — a URL
the studio and the CLI already install from. So there is no upload, no bucket, and no
credential on anybody's machine.

**Signing in is for submitting only.** Accounts are [Clerk](https://clerk.com)'s, and
three writes need one: submit a pack, update it, remove it. Browsing, searching,
installing and reading a pack's page are anonymous. With no Clerk keys configured, every
visitor is a local identity instead, so a checkout never asks anybody to sign in.

The pack schema is not repeated here: what a repository holds is parsed with
`PackManifest` from `@agentcut/core/modules/packs/types`, the same zod schema the studio
imports packs with.

```
src/index.tsx        routes: API, pages, submitting, auth
src/lib/             packs (the registry), github (reading repositories), auth (Clerk), db (Postgres), semver, formats
src/views/           pages and components (layout, landing, packs, pack detail, submit, account)
src/styles.css       Tailwind input: the studio's palette and glass material
migrations/          Postgres schema, applied in name order by scripts/migrate.mjs
scripts/migrate.mjs  the one migration runner: production, the local database and the tests
scripts/local-db.mjs a local Postgres with nothing to install: PGlite behind a socket
scripts/dev.mjs      `pnpm dev`: the local database, then wrangler dev pointed at it
scripts/seed-local.mjs  submits this repository's packs/* to the local server
src/node.ts          production: the same app with node around it instead of workerd
scripts/build-server.mjs  bundles src/node.ts and the migration runner into dist/
deploy/              pm2, nginx, the deploy script and what to do the first time
test/api.test.mjs    end-to-end tests against the worker in local workerd, with GitHub stubbed
```

## Local development

The worker runs in miniflare, and its database is [PGlite](https://pglite.dev) — Postgres
compiled to WebAssembly, an npm dependency — behind a socket on localhost. The worker
reaches it through wrangler's local Hyperdrive, the same binding and the same driver as in
production. Nothing needs a Cloudflare login, a Clerk key or a Postgres install.

```sh
pnpm install                          # from the repo root
pnpm --filter @agentcut/web dev       # builds CSS, starts the local database (migrated), serves :8787
pnpm --filter @agentcut/web seed:local   # in a second terminal: submits packs/news-desk, showcase, stream-shorts
```

`dev` runs `wrangler dev --var DEV_LOGIN:1`, which never happens in production: every
visitor is signed in as a local identity, named by `DEV_GITHUB_LOGIN` (default `local`) or
per request by an `x-dev-login` header. Ownership is still checked, so the identity has to
match the repository's GitHub owner — which is how `seed:local` submits as `0xPasho`.

Seeding reaches GitHub, because a pack is a repository; everything else is local. Local
state lives in `apps/web/.wrangler/` (the database in `.wrangler/pglite`); delete it to
start empty. After changing classes in
`src/`, run `pnpm build:css` (the worker reloads on its own; the CSS does not).

To try the real sign-in locally, create `apps/web/.dev.vars` (gitignored) with
`CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` from a Clerk development instance that has
GitHub as a social connection, and drop `--var DEV_LOGIN:1` from `scripts/dev.mjs`.

## Scripts

| Script | What |
| --- | --- |
| `dev` | `build:css`, then `scripts/dev.mjs`: the local database, migrated, and `wrangler dev --port 8787 --var DEV_LOGIN:1` pointed at it |
| `build:css` | Tailwind → `public/styles.css` |
| `db:migrate` | Applies `migrations/*.sql` that are missing to `DATABASE_URL`, each once and in its own transaction, recorded in `schema_migrations` |
| `seed:local` | Submits this repository's `packs/*` to `http://localhost:8787` (or the URL given as the first argument) |
| `test` | End-to-end tests with `node:test` and wrangler's `createTestHarness` (local workerd, PGlite in memory through the local Hyperdrive, GitHub stubbed by an http server in the test process, offline, a few seconds) |
| `typecheck` | `tsc --noEmit` |
| `deploy` | `build:css` then `wrangler deploy` |

## API

All JSON, and all of it reads. `GET /api/packs*` allows any origin, because the studio
fetches it from localhost.

```ts
type PackListing = {
  name: string;          // manifest.id
  title: string;         // manifest.name
  description: string;
  latest: string;        // highest registered version
  author: string;        // manifest.author
  owner: { login: string; avatarUrl: string | null };
  stars: number;         // the repository's stars on GitHub
  updatedAt: number;     // ms
  source: string;        // raw.githubusercontent.com/<owner>/<repo>/<sha>/<folder>
  cover: string;         // the latest version's cover at that commit, or "" when it has none
  repo: { owner: string; name: string; folder: string; branch: string; url: string };
  counts: { templates: number; rules: number; assets: number; recipes: number };
};
```

| Route | Answer |
| --- | --- |
| `GET /api/packs?q=&limit=` | `200 { packs: PackListing[] }`, stars desc then updatedAt desc. `q` matches name, title and description. `limit` 1–100, default 50. |
| `GET /api/packs/:name` | `200 { pack: PackListing & { versions: { version, publishedAt, size, sha, source }[], manifest } }`, or `404 { error }` |

Writing is the website's own forms, posted from this origin only: `POST /submit`,
`POST /packs/:name/refresh` and `POST /packs/:name/remove`.

## Pages

| Path | |
| --- | --- |
| `/` | Landing |
| `/packs`, `/packs?q=` | Marketplace, with search |
| `/packs/:name` | A pack: its cover and screenshots (straight from GitHub at the pinned commit, each opening full size), style guide (rendered from Markdown as escaped JSX, never raw HTML), templates, rules, recipes with the trust warning, assets, versions with the commit each is pinned to, the repository, the install command and the source URL. Its owner also gets *Check for updates* and *Remove*. |
| `/submit` | Register a repository as a pack |
| `/login`, `POST /logout` | Clerk's hosted sign-in; a message when it is not configured |
| `/account` | Your packs |

What a submission checks: the address is a `github.com/owner/repo` (optionally
`/tree/<branch>/<folder>`); the repository is public and owned by the signed-in GitHub
login; `pack.json` at the head of the branch parses with `PackManifest`; the version
matches `^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$`; and every file the manifest points at is
in that commit's tree — `templates/<id>.json`, `rules/<id>.json` and the rule's
`then.promptFile`, `assets[].file`, `examples[].file`, `style`, `review`, `recipes[].file`,
`recipeFiles`, `cover` and `screenshots`, with each picture at most 5 MB. The commit is then pinned, and a version that is already registered is
never re-pinned: a new version is a bumped `version` in pack.json.

Sessions are Clerk's `__session` cookie, verified on the edge with `@clerk/backend`; a
handshake is a redirect carrying the headers Clerk hands us, so no script is involved.
Form posts are checked for a same-origin `Origin` header.

## Deploy

```sh
apps/web/deploy/deploy.sh     # build, rsync, migrate, pm2 restart, smoke test
```

[deploy/README.md](./deploy/README.md) is the whole story: what lives in `~/agentcut` on
the box, the one-time setup (origin certificate, nginx vhost, pm2 process), and where to
look when a page 502s. In short: the site is `agentcut-web` under pm2 on port 3013, nginx
holds `agentcut.studio` in front of it, and Cloudflare proxies the domain to that machine's
address with SSL mode **Full**, exactly as it does for postgun.ai.

Nothing is installed on the box: `scripts/build-server.mjs` inlines hono, postgres,
`@clerk/backend` and the core pack schema into one file, and node runs it.

### The database

Postgres on the owner's database host (the one postgun uses): database `agentcut`, owned by
the role `agentcut_app` (`CONNECTION LIMIT 20`, so it cannot starve the other apps on that
server), with `CONNECT` revoked from everybody else. The role's password is
`AGENTCUT_APP_PASSWORD` in the credentials file on the deploy box, beside the other apps'
roles; it is never committed or copied into this repository — it reaches production through
`~/agentcut/.env` only. The deploy applies what is missing on every run; by hand it is:

```sh
DATABASE_URL='postgres://agentcut_app:<password>@<db host>:5432/agentcut?sslmode=require' \
  pnpm --filter @agentcut/web db:migrate
```

### Clerk instance

The production instance is the Clerk application **agentcut**, on `agentcut.studio`: its
Frontend API is `clerk.agentcut.studio` and its sign-in page, Clerk's Account Portal,
`accounts.agentcut.studio` — CNAMEs in the Cloudflare zone, DNS only, beside the two for
email (`clkmail`, `clk._domainkey`, `clk2._domainkey`). `/login` sends a visitor there with
Clerk's own redirect (`createRedirect` from `@clerk/backend/internal`), and the session
comes back to this domain through Clerk's handshake, with no script on our pages.

- Sign-in is by **email** (a one-time code) for now. GitHub is a social connection with
  sign-in turned off, so it can only be linked to an account — and it cannot even be
  linked until its production credentials are set (Clerk → SSO connections → GitHub: the
  OAuth App `agentcut` under 0xPasho, callback `https://clerk.agentcut.studio/v1/oauth_callback`,
  needs a client secret generated). A pack is a repository and the GitHub login is how
  ownership is checked, so until then a signed-in account is told to connect GitHub
  before submitting.
- The secret and publishable keys live in `~/agentcut/.env`; after changing them,
  `pm2 restart agentcut-web --update-env`.

Until they are there the site is anonymous: browsing, searching, installing and every pack
page work, and `/login` says sign-in is not configured.

Reading a repository uses the submitter's own GitHub token when Clerk has one for them
(`getUserOauthAccessToken`), and falls back to anonymous reads, which is why GitHub's
unauthenticated rate limit is the one to watch on a cold instance.

### On Cloudflare instead

`pnpm deploy:worker` still deploys the Worker, and it is how this app was first written,
but it is not what serves the domain. It needs a Hyperdrive binding whose connection
string points at the database, Cloudflare told to trust Coolify's CA
(`wrangler cert upload certificate-authority`), `--sslmode verify-ca` and
`--caching-disabled` — Hyperdrive caches reads for up to a minute and does not invalidate
them on a write, so a removed pack would stay listed. Hyperdrive also refuses to connect
once that certificate lapses, while psql carries on as if nothing happened; the app on the
owner's box talks to the database directly and has nothing to renew.
