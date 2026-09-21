<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

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

Implementation reference: [EDITOR.md](./EDITOR.md). Use `src/lib/editor/operations.ts`
for domain changes and `src/lib/editor/store.ts` for persistence. Do not write project
EDLs through `q.setProject`, exported JSON files, or a separate provider-specific path.
Run `pnpm test` for editing changes and `pnpm test:render` when rendering/state resolution changes.

## Interface work

`.claude/skills/` carries the UI skills this project designs against: `better-ui`
(polish, motion, icons, surfaces), plus `better-colors`, `better-layout`,
`better-typography`, `better-writing`, `better-accessibility` and `interface-review`.
Read the relevant one before building or reviewing UI, rather than inventing a house
style per screen. Harness marks live in `src/components/brand-marks.tsx`: one
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
