# One editor, two interfaces

The human UI and agent tools control the same editor. Editing behavior belongs to the
shared operation engine, not to a React component or an agent prompt. The product
contract lives in [SPEC.md](./SPEC.md#core-requirement-one-editor-two-interfaces).

## State and operations

SQLite's `projects.edl` and `projects.revision` are authoritative. An edit is an atomic
batch with an `expectedRevision`. A successful batch increments the revision once;
a stale batch fails with a conflict and does not change the project. `edl.json` is a
derived export, never the authority for a project-ID render.

`src/lib/editor/operations.ts` owns the operation schemas, validation, immutable reducer,
trim behavior, and UI adapter. Both interfaces use these operations:

| Operation | Behavior |
| --- | --- |
| `clip.promote` | Promote a clip in place to a layered timeline, preserving its ID and edits |
| `item.place` | Patch item timing, layer, transform, volume, mute, and visibility |
| `clip.add` | Add a clip with a unique ID |
| `clip.remove` | Remove the identified clip |
| `clip.patch` | Change only supplied clip fields; caption fields merge individually |
| `edit.add` | Add a timeline edit |
| `edit.replace` | Replace an edit at its index in the expected revision |
| `edit.remove` | Remove an edit at its index in the expected revision |
| `output.patch` | Change only supplied output dimensions/frame rate |

All seven edit types are supported: silence, punch, emphasis, text, image, sound effect,
and music. Crop keyframes, split rectangles, caption settings, transcript words, clip
metadata, and output settings are accessible to both interfaces. The UI's **All clip
properties** panel is generated from the same schema exposed to agents; compact controls
remain shortcuts to that engine. Add/remove clips is available on the project screen.

Patch schemas deliberately remove defaults before making fields optional. Zod's ordinary
`.partial()` can populate defaults for omitted fields and erase unrelated edits.

Changing clip boundaries rebases existing word, edit, and crop timestamps relative to
the new start, clips timed items to the new duration, and interpolates a crop at the
new start. Explicit replacement arrays override this behavior. Extending a clip does
not invent missing transcript words: they can be supplied through the same properties
and patch operation. Source identity/metadata cannot be changed by an editing operation.

## Human workflow and conflicts

Both visual editing surfaces use `useEditor`. Controls preview the shared reducer locally
and save after a short debounce. Save, export, and asking the agent flush pending edits
first. Other writers' saved changes appear through polling, without replacing local drafts.

A revision conflict preserves the draft and blocks saving. The UI offers downloading the
draft or explicitly discarding it and loading the latest state; it does not silently merge
or overwrite. Drafts are also retained in session storage for navigation recovery. Browser
storage is a recovery aid, not the authoritative project. Properties are a staged form:
Apply submits one atomic batch, and concurrent changes require reopening the form.

The agent follows the same revision protocol. On conflict it receives the current snapshot
and must reconsider its requested changes. It must not blindly replay a stale full clip.

## Agent and headless tools

`src/lib/editor/tools.ts` exposes project-scoped tools used by the UI and agent transport:

- `project.read`, `project.edit`, `project.render`
- `assets.list` (library plus project assets), `assets.capture` (source seconds)
- `assets.search`, `assets.adopt` (select a returned provider/ID for a query)
- `assets.import` (a file inside the project workspace)
- `assets.upload` (name and base64 contents, using the same ingestion as UI uploads)

The host binds the project ID. Asset services perform capture and search on behalf of
the agent; granting general network/shell access is not required for these operations.

Read the live JSON Schema with `GET /api/projects/<id>/editor`. Invoke tools with
`POST /api/projects/<id>/editor`. Human saves use `PATCH /api/projects/<id>` with the
same edit request and store. For example:

```json
{
  "tool": "project.edit",
  "expectedRevision": 3,
  "operations": [
    {
      "type": "clip.patch",
      "clipId": "abc123",
      "patch": { "captions": { "positionY": 0.8 } }
    }
  ]
}
```

No web server is required for the CLI:

```bash
pnpm exec tsx scripts/edit.ts <projectId> read
pnpm exec tsx scripts/edit.ts <projectId> call request.json
pnpm exec tsx scripts/edit.ts <projectId> ask "Move the title to the bottom"
```

The UI's **Edit with agent** action starts an edit job on the existing project. Both
provider adapters use the same file-based tool transport in `editor-runs/<run-id>/`:
the agent reads `project.json` and `tools.schema.json`, writes `request-0001.json`, and
reads `response-0001.json` before the next request. The host executes the shared tools.
Request numbers cannot be reused. Successful tool responses confirm saved changes;
writing an EDL or modifying the initial snapshot does not save anything.

Initial selection still uses transcript/frame analysis to propose clips. Publishing
those proposals appends clips through the shared state layer. **Find more clips** and
recovery/CLI selection preserve existing clips and edits; they do not replace the project.

## Rendering

UI render jobs, `project.render`, and `scripts/render.ts <projectId>` call
`renderProject`, which captures the current database revision and uses the common
Remotion composition. A per-project file lock prevents overlapping exports. The output
manifest records each clip's revision; stale outputs are not offered as current downloads.
If a process crashes while rendering, remove its `render.lock` only after verifying that
the process is no longer running.

`scripts/render.ts path/to/edl.json` remains an explicit standalone snapshot render.
It does not represent the latest state of a project in the database.

## Verification and maintenance

```bash
pnpm test
pnpm test:render
pnpm exec tsc --noEmit
pnpm build
```

The editor tests cover UI/agent state equivalence, both handoffs, nested partial patches,
conflict rejection, transaction rollback, preserved clips during selection, trim rebasing,
the tool transport, shared HTTP validation, and asset services. The render integration test
compares decoded frame hashes from UI-service, agent-tool, and CLI exports and deliberately
corrupts the exported EDL to prove project-ID rendering reads the database.

Browser verification covers two open editors, UI → agent → UI editing, autosave, properties,
a deliberately raced save, split-layout property editing at 320px, and preservation of
additional agent-created title tracks when using quick controls. Provider orchestration is exercised with a test provider;
authenticated model sessions are separate smoke tests. Isolated Claude and Codex CLI runs
successfully read the project and changed only a requested title through the shared
tools, preserving captions, split layout, and multiple overlays. Claude saved revision
15 and Codex continued from it to revision 16 in the temporary test project.

New editing features must extend this operation/schema contract, expose human controls
(including the schema-driven properties panel), and test both entry points. Do not add a
second agent-only or UI-only mutation path.

## Empty-canvas and multi-source editing

Projects also support imported media and multiple layered sequences through the same
operation engine and revision store. See [SEQUENCES.md](./SEQUENCES.md) for the new
operations, import tools, shared visual editor, local launcher, and render verification.
`Edl.source` may be null for a general editing project. A sequence item with
`mediaId: null` is a source-free canvas scene and supports the same clip edits.
Humans and agents create it through `item.add`, then use the usual item operations.
Clipping and general editing use the same `ClipEditor`; starting state is the difference.

The unified asset browser uses `assets.browseLocal` (folder/offset) and
`assets.importLocal` (local image/audio path); video import continues through
`media.import`. These are explicit host filesystem services available equally to the
human and agent. `item.edit.add` appends an edit to a shot without replacing unrelated
edits. See SEQUENCES.md for the local-folder and project-membership semantics.

## One visual editor for every video

Generated clips and empty videos use identical editor controls and timeline semantics.
The shared `clip.promote` operation preserves the generated clip's ID, title, output,
source range, and edits while moving it into a sequence. It is committed with the first
edit, not by a read-only route. Existing clip links remain valid. Agents can issue the
same promotion and item operations in one revision-checked batch.

`item.place` patches absolute output start time, layer order, percentage-based transform,
rotation, opacity, volume, mute, and visibility. Its optional `before` provides the
same stale-form protection as other staged edits. Omitted/null start times append on
the item's own layer. Independent source-free layers provide titles, images, and audio
across multiple footage cuts. Preview and export use the same frame placement and
composition. See SEQUENCES.md for field units and current limits.
