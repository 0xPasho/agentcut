# Releasing

Three npm packages ship at one version, the CLI's (`packages/cli/package.json`):

| Package | What | Size |
|---------|------|------|
| `agentcut` | The CLI: launcher, every command, core bundled with esbuild | ~450 KB packed, ~2 MB installed |
| `@agentcut/render` | The compositions prebuilt by Remotion's bundler, and the renderer's JavaScript | ~7 MB packed |
| `@agentcut/studio` | The studio as a standalone Next server | ~8 MB packed |

The last two are never installed by npm. The CLI fetches them from the registry on first
use, checks them against the registry's sha512 and unpacks them into
`~/.agentcut/runtime/<component>/<version>/` (`packages/core/src/common/server/runtime.ts`).
Their files travel as `payload.tar.gz` inside the package, because npm's packer drops
`node_modules` directories and symlinks. The renderer also fetches Remotion's native
compositor for the machine (`@remotion/compositor-<platform>`) and Remotion's headless
browser. ffmpeg comes from ffmpeg-static's GitHub release `b6.1.1`, one platform's build.

## Build

```sh
pnpm release:build          # all three into .release/ (render, studio) and packages/cli/dist
```

The studio build sets `AGENTCUT_STANDALONE=1` (Next's `output: "standalone"`), writes to
`apps/studio/.next-release` so it never touches a running dev server, and leaves `sharp`
out, which is one platform's native build and unused.

## Rehearse on a local registry

Publishing the same version twice to npm is impossible, so try every release on a local
registry first:

```sh
npx verdaccio@6 --config <a config that allows publishing agentcut and @agentcut/*>
pnpm release:publish --registry http://127.0.0.1:4873/
HOME=$(mktemp -d) NPM_CONFIG_REGISTRY=http://127.0.0.1:4873/ sh -c 'npm i -g agentcut && agentcut'
```

`AGENTCUT_REGISTRY` (or npm's own `registry` setting, including `@agentcut:registry`)
decides where the CLI fetches its components; `AGENTCUT_HOME` moves `~/.agentcut`.

## Publish

```sh
npm login                   # an account with rights to agentcut and the @agentcut scope
pnpm release:publish        # render, then studio, then the CLI
```

The order matters: a published CLI must never point at a component that is not there yet.

## The marketplace

`apps/web` deploys separately; see [apps/web/README.md](../apps/web/README.md). The CLI
and the studio talk to `MARKET_URL` in `packages/core/src/modules/packs/data.ts`
(`https://agentcut.dev`) unless `AGENTCUT_MARKET` says otherwise — point the constant at
the deployed domain before the first release.
