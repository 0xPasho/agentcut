<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Architecture: domain-driven modules

The layout follows postgun's web app (`~/Projects/postgun/CLAUDE.md`): every feature lives
in one domain module, shared code lives in `common/`, and `src/app` only routes.

```
src/
  app/                    routes only: a page loads with a server loader and renders a view;
                          an API route parses the request and calls a module's server code
  common/
    ui/                   shadcn primitives
    components/           marks and surfaces used by 2+ modules
    lib/                  pure helpers used by 2+ modules (cn, format, urls, text-fit)
    hooks/                React hooks used by 2+ modules
    api/                  the browser's API client and its response types
    server/               node-only plumbing: config, db, bin, file server, secrets
  modules/<module>/
    types.ts              zod schemas and types — the module's model
    data.ts               constants and config tables
    lib.ts | lib/         pure functions: no React, no node — safe in the browser and in Remotion
    hooks.ts | hooks/     React hooks
    components/           sub-components
    <name>-view.tsx       page-level view
    server/               node-only services: fs, SQLite, ffmpeg, spawning agents
    __tests__/            the module's tests (node:test through tsx)
remotion/                 the render bundle's own entry — compositions only
```

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
| `packs` | Import and export of packs |
| `agent` | Harness drivers, selection, the chat and editing agents, MCP |
| `onboarding` | The setup interview |
| `render` | Rendering, output frames, the style audit |
| `stream-comments` | The stream chat and the comment a clip opens on |
| `settings` | The workspace settings pages |

### Rules

1. **Types** go in `module/types.ts`, not inline in views, components or hooks. Component
   `Props` are the only types allowed inline.
2. **Constants** go in `module/data.ts`.
3. **Pure functions** go in `module/lib.ts` (or `lib/<topic>.ts` in a large module).
4. **Hooks** go in `module/hooks.ts` (or `hooks/<topic>.ts`).
5. **Node-only code** goes in `module/server/`. Nothing outside `server/`, `src/app/api`,
   scripts and tests may import from a `server/` folder at runtime; `import type` is fine.
   `lib/`, `types.ts` and `data.ts` stay free of node, because Remotion and the browser
   bundle them.
6. **Shared code** (used by 2+ modules) goes in `common/`; a module reaches into another
   module only through its `types.ts`, `lib`, `server/` entry points or components.
7. **Pages are thin.** A page calls a loader from `module/server/pages.ts` (or the module's
   own server code) and renders one view. No SQL, no parsing, no JSX layout in `src/app`.
8. **Imports inside `src/modules`, `src/common` non-UI code and `remotion/` are relative**,
   because the Remotion bundle does not resolve `@/`. UI files may use `@/`.
9. Early returns over nested `if/else`; no nested ternaries in JSX.

`src/modules/__tests__/architecture.test.ts` enforces rules 1, 5 and 7.

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

Implementation reference: [EDITOR.md](./EDITOR.md). Use `src/modules/editor/lib/operations.ts`
for domain changes and `src/modules/editor/server/store.ts` for persistence. Do not write project
EDLs through `q.setProject`, exported JSON files, or a separate provider-specific path.
Run `pnpm test` for editing changes and `pnpm test:render` when rendering/state resolution changes.

## Interface work

`.claude/skills/` carries the UI skills this project designs against: `better-ui`
(polish, motion, icons, surfaces), plus `better-colors`, `better-layout`,
`better-typography`, `better-writing`, `better-accessibility` and `interface-review`.
Read the relevant one before building or reviewing UI, rather than inventing a house
style per screen. Harness marks live in `src/common/components/brand-marks.tsx`: one
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
