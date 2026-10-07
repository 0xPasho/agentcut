<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Architecture: a workspace of apps and packages, domain modules inside

One pnpm workspace ([SPEC.md S11](./SPEC.md#decided)). What is deployed lives in `apps/`;
what is installed on somebody's machine lives in `packages/`. Inside core and the studio,
every feature is one domain module, as in postgun's web app (`~/Projects/postgun/CLAUDE.md`).

```
apps/
  studio/                 @agentcut/studio — the visual editor (Next.js), local
    src/app/              routes only: a page loads with a server loader and renders a view;
                          an API route parses the request and calls core's server code
    src/common/           ui/ (shadcn primitives), components/, hooks/, lib/utils.ts (cn)
    src/modules/<module>/ the module's face: components/, <name>-view.tsx, hooks, and a
                          data.ts for icon tables; route-level tests in __tests__/
  web/                    @agentcut/web — the landing page and the packs marketplace
                          (Cloudflare Workers, D1, R2); see apps/web/README.md
packages/
  core/                   @agentcut/core — the editor without a face, shared by everything
    src/common/           lib/ (pure), api/ (the HTTP client and its response types),
                          server/ (config, root, db, bin, runtime, file server, secrets)
    src/modules/<module>/
      types.ts            zod schemas and types — the module's model
      data.ts             constants and config tables
      lib.ts | lib/       pure functions: no React, no node — safe in the browser and in Remotion
      server/             node-only services: fs, SQLite, ffmpeg, spawning agents
      __tests__/          the module's tests (node:test through tsx)
    assets/               files read at run time: sound effects, the phone helper's source
  render/                 @agentcut/render — the Remotion compositions (the bundle's entry)
  cli/                    agentcut — the npm package: launcher, commands, release bundle
scripts/                  dev tools (pace, clip, style-audit…) and scripts/release/
```

Core is imported as `@agentcut/core/<path under src>` (`@agentcut/core/modules/editor/lib/operations`),
the compositions as `@agentcut/render/<file>`. Both are TypeScript source: the studio
transpiles them, tsx runs them, esbuild bundles them into the CLI.

**What ships.** `npm i -g agentcut` installs only `packages/cli` (about 2 MB). The rest is
fetched on first use into `~/.agentcut/runtime` by `common/server/runtime.ts`: ffmpeg and
ffprobe (any command that probes media), `@agentcut/render` with Remotion's compositor and
browser (the first export), `@agentcut/studio` (the first `agentcut`). A source checkout
never downloads; everything comes from node_modules and the workspace stays in `workspace/`.
An install keeps its workspace in `~/.agentcut/workspace`. Releasing: [docs/RELEASING.md](./docs/RELEASING.md).

| Module | Owns |
|--------|------|
| `project` | Projects, jobs and their lock, ingest, batches, the home and project views, page loaders |
| `editor` | The EDL (`types.ts`), operations, history, the timeline math, persistence (`server/store.ts`), the tool surface both interfaces call (`server/tools.ts`), the editor views |
| `media` | Probing and ffmpeg, the asset library, local files, peaks, image and audio search |
| `transcription` | Recognition, alignment, polishing, the transcript |
| `clipping` | Choosing clips from a recording: signals, the selection agent, boundaries |
| `templates` | Templates, looks, planning and applying them |
| `rules` | Rules, glossary, preferences and the observation bank |
| `plan` | Project and sequence plans |
| `packs` | Import and export of packs, and the marketplace client (`server/market.ts`) |
| `agent` | Harness drivers, selection, the chat and editing agents, MCP |
| `onboarding` | The setup interview |
| `render` | Rendering, output frames, the style audit, the one Remotion loader (`server/remotion.ts`) |
| `review` | The standard a pack holds its videos to: criteria, the gate, waivers |
| `stream-comments` | The stream chat and the comment a clip opens on |
| `settings` | The workspace settings pages |
| `publishing` | Publications, accounts, the calendar and the publishing worker |

### Rules

1. **Types** go in core's `module/types.ts`, not inline in views, components or hooks.
   Component `Props` are the only types allowed inline.
2. **Constants** go in `module/data.ts` — core's, or the studio module's for tables of icons.
3. **Pure functions** go in `module/lib.ts` (or `lib/<topic>.ts` in a large module).
4. **Hooks** go in the studio module's `hooks.ts` (or `hooks/<topic>.ts`).
5. **Node-only code** goes in `module/server/`. Nothing outside `server/`, the studio's
   `src/app/api`, the CLI, scripts and tests may import from a `server/` folder at runtime;
   `import type` is fine. `lib/`, `types.ts` and `data.ts` stay free of node, because
   Remotion and the browser bundle them.
6. **Core has no face.** Nothing in `packages/core` is a `.tsx` or imports React, Next,
   icons or anything in `apps/`; the CLI has no browser. The CLI imports core only.
7. **Pages are thin.** A page calls a loader from `module/server/pages.ts` (or the module's
   own server code) and renders one view. No SQL, no parsing, no JSX layout in `src/app`.
8. **The heavy runtime is loaded in one place.** `@remotion/renderer`, `@remotion/bundler`
   and the ffmpeg packages are reached only through `render/server/remotion.ts` and
   `common/server/bin.ts`, never imported outright, so they stay out of the CLI bundle and
   the studio's trace.
9. **`.ts` files in core and everything in `packages/render` import core relatively or as
   `@agentcut/core/…`**, never through `@/`, which only the studio resolves.
10. Early returns over nested `if/else`; no nested ternaries in JSX.

`packages/core/src/modules/__tests__/architecture.test.ts` enforces rules 1, 5, 6, 7 and 8
and the layout, as part of `pnpm test`.

## Working in this repo

- Work on `main`; never create a branch, even with several agents on the same checkout.
  One tree, one history, nothing to merge.
- Commit by paths, never `git add -A`: another session may be editing the same tree, and
  a blind add commits its half-written files.
- Parallel agents get disjoint file scopes. Each feature runs `pnpm test`,
  `pnpm test:render` and `pnpm exec tsc --noEmit` green and commits before the next
  starts; a red tree blocks everyone sharing it. `package.json` pins `pnpm@11.9.0`
  (`packageManager`) and has no separate typecheck script; those three are the commands.
  `pnpm test` runs core, the studio, the CLI and the web app's suites in turn.
- Features land whole, not in phases. A half-shipped feature is a parity gap with a name.
- In autonomous loops the grill-me skill's answers are the source of truth; the owner is
  not asked again.
- Docs and ADRs are written in English, whatever language the conversation is in. ADRs
  are the numbered Decided tables: [AGENT-FIRST.md](./AGENT-FIRST.md) (1–…),
  [SPEC.md](./SPEC.md) (S1–S11, the founding stack and its distribution) and [HARNESS.md](./HARNESS.md)
  (H1–H10). There is no `docs/adr/`. A design decision updates the docs and the table in
  the same commit; a shipped feature amends the row that promised it.

Two engineering rules from the same loops:

- Never a second implementation of a rule. Anything that predicts what a function will do
  calls that function (`templates.suggest` runs `planTemplate`; the panel sends overrides
  and the server merges). Two models of one rule drift silently.
- A change to what renders is verified by reading exported frames, not only by numeric
  tests. Composition faults show in pixels while every number passes.

And the bar for done: a capability is not done until it is reachable in the editor where
the work happens. A quick-view-only control does not count.

## Shared-editor requirement

Read [SPEC.md — One editor, two interfaces](./SPEC.md#core-requirement-one-editor-two-interfaces)
before changing editing behavior.

- The human UI and agent tools must have exactly the same editing capabilities. They
  are two interfaces to one editor, not separate editing implementations.
- Implement editing behavior in shared operations with the same validation, supported
  parameters, asset services, and authoritative project state for both interfaces.
- Every UI edit must be available to the agent; every supported agent edit must be
  inspectable and editable in the UI. Neither may silently discard the other's work.
- A new editing feature is incomplete until both interfaces support it. Verify that
  equivalent actions produce equivalent state and rendering, including both handoffs.
- Existing parity gaps are bugs to close, not precedents to copy. Do not claim parity
  merely because both paths use the EDL schema. Keep implementation status accurate.

Implementation reference: [EDITOR.md](./EDITOR.md). Use `packages/core/src/modules/editor/lib/operations.ts`
for domain changes and `packages/core/src/modules/editor/server/store.ts` for persistence. Do not write project
EDLs through `q.setProject`, exported JSON files, or a separate provider-specific path.
Run `pnpm test` for editing changes and `pnpm test:render` when rendering/state resolution changes.

## Interface work

Treat visual details as part of completion: use deliberately sized SVG icons, never
text glyphs as substitute controls; give status indicators consistent iconography,
spacing and readable labels across list rows and headers. Keep internal paths and
raw state identifiers out of primary page chrome. Inspect the result in the browser.

`.claude/skills/` carries the UI skills this project designs against: `better-ui`
(polish, motion, icons, surfaces), plus `better-colors`, `better-layout`,
`better-typography`, `better-writing`, `better-accessibility` and `interface-review`.
Read the relevant one before building or reviewing UI, rather than inventing a house
style per screen. Harness marks live in `apps/studio/src/common/components/brand-marks.tsx`: one
`currentColor` SVG per provider, states from CSS, never a second asset.

## General editing and clipping

Use one shared visual editor for both flows. General editing starts with an empty
canvas; footage is optional. Clipping starts with an edited source selection.
A project holds reusable media and editable timelines, including source-free scenes
for titles, images, and audio. Do not create a separate simplified assembly editor.
Generated clips promote in place through `clip.promote` with their ID and edits
preserved; never create an independent copy merely to add media or expose layers.
Opening a page must not persist a migration. Both entry points support overlapping
video layers and independent titles/images/audio through shared item placement.
The human and agent use the same operations, validation, saved state, and renderer.
See [SEQUENCES.md](./SEQUENCES.md) for the current model and scope.
