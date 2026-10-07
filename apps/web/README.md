# @agentcut/web

The hosted half of agentcut: the landing page and the packs marketplace. One Cloudflare
Worker (Hono, server-rendered `hono/jsx`, no client framework), a D1 database for people,
sessions, tokens and pack metadata, and an R2 bucket for pack files. The CSS is Tailwind v4,
compiled at build time into `public/styles.css` and served as a static asset with the fonts,
the icon and the studio screenshot.

The pack schema is not repeated here: uploads are parsed with `PackManifest` from
`@agentcut/core/modules/packs/types`, the same zod schema the studio imports packs with.

```
src/index.tsx        routes: API, registry files, pages, auth
src/lib/             packs (validation, publish, queries), auth, crypto, semver, formats
src/views/           pages and components (layout, landing, packs, pack detail, auth)
src/styles.css       Tailwind input: the studio's palette and glass material
migrations/          D1 schema (wrangler d1 migrations)
scripts/seed-local.mjs  publishes ../../packs/* into the local server
test/api.test.mjs    end-to-end tests against the worker in local workerd
```

## Local development

Everything runs locally in miniflare, D1 and R2 included. Nothing needs a Cloudflare login.

```sh
pnpm install                          # from the repo root
pnpm --filter @agentcut/web dev       # builds CSS, applies migrations locally, serves :8787
pnpm --filter @agentcut/web seed:local   # in a second terminal: publishes packs/news-desk, showcase, stream-shorts
```

`dev` runs `wrangler dev --var DEV_LOGIN:1`, which turns on two things that never exist in
production:

- `/login` shows a username form that signs you in as that user, creating it if needed.
- `POST /api/dev/token { "login": "pasho" }` returns an API token for that user. The seed
  script uses it to publish through the real `POST /api/packs`.

Local state lives in `apps/web/.wrangler/`; delete it to start empty. After changing
classes in `src/`, run `pnpm build:css` (the worker reloads on its own; the CSS does not).

To try GitHub sign-in locally, create `apps/web/.dev.vars` (gitignored) with
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `SESSION_SECRET`, and register
`http://localhost:8787/auth/github/callback` as the OAuth app's callback URL.

## Scripts

| Script | What |
| --- | --- |
| `dev` | `build:css`, `db:migrate:local`, then `wrangler dev --port 8787 --var DEV_LOGIN:1` |
| `build:css` | Tailwind → `public/styles.css` |
| `db:migrate:local` | `wrangler d1 migrations apply DB --local` |
| `seed:local` | Publishes the example packs into `http://localhost:8787` (or the URL given as the first argument) |
| `test` | End-to-end tests with `node:test` and wrangler's `createTestHarness` (local workerd, in-memory D1 and R2, offline, a few seconds) |
| `typecheck` | `tsc --noEmit` |
| `deploy` | `build:css` then `wrangler deploy` |

## API

All JSON. Reads (`GET /api/packs*`, `/r/*`) allow any origin, because the studio fetches
them from localhost.

```ts
type PackListing = {
  name: string;          // manifest.id
  title: string;         // manifest.name
  description: string;
  latest: string;        // highest published version
  author: string;        // manifest.author
  owner: { login: string; avatarUrl: string | null };
  downloads: number;     // fetches of pack.json
  updatedAt: number;     // ms
  source: string;        // `${origin}/r/${name}/${latest}`
  counts: { templates: number; rules: number; assets: number; recipes: number };
};
```

| Route | Answer |
| --- | --- |
| `GET /api/packs?q=&limit=` | `200 { packs: PackListing[] }`, downloads desc then updatedAt desc. `q` matches name, title and description. `limit` 1–100, default 50. |
| `GET /api/packs/:name` | `200 { pack: PackListing & { versions: { version, publishedAt, size }[], manifest } }`, or `404 { error }` |
| `POST /api/packs` | Bearer token. Body `{ files: { path, base64 }[] }` with `pack.json`. `201 { name, version, url, source }`; `400 { error, issues? }` for a bad manifest, a missing referenced file, a bad path or a bad version; `401` without a valid token; `403` when another user owns the name; `409 { error: "version exists" }`; `413` over 50 MB or 2000 files. |
| `GET /r/:name/:version/<path>` | The stored file, with its content type. `:version` may be `latest`. Concrete versions are `cache-control: public, max-age=31536000, immutable`. Fetching `pack.json` counts a download. `404` when missing. |
| `POST /api/auth/device` | `200 { deviceCode, userCode: "ABCD-EFGH", verificationUrl, interval: 2, expiresIn: 600 }` |
| `POST /api/auth/token` `{ deviceCode }` | `200 { token, user: { login, name, avatarUrl } }` once approved (the token is shown once and stored hashed); `428 { error: "authorization_pending" }`; `403 { error: "access_denied" }`; `410 { error: "expired_token" }`; `404` unknown or already used |
| `GET /api/me` | Bearer token. `200 { user: { login, name, avatarUrl } }` or `401` |

What a publish checks: every path is relative, uses forward slashes and has no `.` or `..`
segment; `pack.json` parses with `PackManifest`; the version matches
`^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$`; and every file the manifest points at is in the
upload — `templates/<id>.json`, `rules/<id>.json` and the rule's `then.promptFile`,
`assets[].file`, `examples[].file`, `style`, `review`, `recipes[].file` and `recipeFiles`.
Files land in R2 at `packs/<name>/<version>/<path>`, which is the layout the studio installs
from: it fetches `<source>/pack.json`, then each file at `<source>/<path>`.

Files under `/r/` are somebody else's bytes on this origin, so they are served with
`x-content-type-options: nosniff` and a sandboxing `content-security-policy`, and HTML is
served as plain text.

## Pages

| Path | |
| --- | --- |
| `/` | Landing |
| `/packs`, `/packs?q=` | Marketplace, with search |
| `/packs/:name` | A pack: style guide (rendered from Markdown as escaped JSX, never raw HTML), templates, rules, recipes with the trust warning, assets, versions, install command and source URL |
| `/login`, `POST /logout` | GitHub OAuth when configured; the dev form when `DEV_LOGIN` is `"1"` |
| `/device` | The browser half of `agentcut login`: shows the code, Approve or Deny |
| `/account` | Your packs and API tokens, with revoke |

Sessions are a random token in a signed, HttpOnly, SameSite=Lax cookie; D1 keeps only its
sha256. Form posts are checked for a same-origin `Origin` header.

## Deploy

Nothing here deploys on its own. With a Cloudflare account:

```sh
cd apps/web
npx wrangler login
npx wrangler d1 create agentcut-web          # put the printed database_id in wrangler.jsonc
npx wrangler r2 bucket create agentcut-packs
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET       # e.g. `openssl rand -base64 32`
npx wrangler d1 migrations apply DB --remote
pnpm deploy                                   # build:css + wrangler deploy
```

Keep `DEV_LOGIN` at `"0"` in `wrangler.jsonc`. Add a custom domain under the Worker's
**Settings → Domains & Routes**; the API answers with URLs built from the request's origin,
so the domain needs no configuration in code.

### GitHub OAuth app

GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**:

- Homepage URL: `https://<your domain>`
- Authorization callback URL: `https://<your domain>/auth/github/callback`

Copy the client id and generate a client secret into the two secrets above. The app asks
for `read:user` only: the login, name and avatar.
