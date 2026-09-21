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
| `item.source` | Replace an item's footage in place, keeping its slot and overlays |
| `clip.add` | Add a clip with a unique ID |
| `clip.remove` | Remove the identified clip |
| `clip.patch` | Change only supplied clip fields; caption fields merge individually |
| `edit.add` | Add a timeline edit |
| `edit.replace` | Replace an edit at its index in the expected revision |
| `edit.remove` | Remove an edit at its index in the expected revision |
| `output.patch` | Change only supplied output dimensions/frame rate |

All seven edit types are supported: silence, punch, emphasis, text, image, sound effect,
and music.

Undo and redo are `invertOperations` in `src/lib/editor/history.ts`: the inverse of a batch,
expressed in these same operations and sent through the same save path. Nothing in the UI
writes a remembered EDL back over the project. Crop keyframes, split rectangles, caption settings, transcript words, clip
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
first. Other writers' saved changes appear through polling, without replacing local drafts. A hidden
tab has its timers throttled to roughly once a minute, so returning to the window polls at once
rather than waiting: the agent edits the same project while nobody is looking at it.

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
- `transcript.resync` (re-recognise the source and refresh every clip's words)
- `assets.list` (library plus project assets), `assets.capture` (source seconds)
- `assets.search`, `assets.adopt` (select a returned provider/ID for a query)
- `assets.import` (a file inside the project workspace)
- `assets.upload` (name and base64 contents, using the same ingestion as UI uploads)
- `assets.importFolder` (every image/audio file in a local folder, in filename order)
- `assets.providers` (which image sources this machine has, and which need a key)
- `templates.list`, `templates.get`, `templates.schema`, `templates.save`, `templates.delete`
- `templates.suggest` (rank the templates against this video's own material)
- `templates.looks` (named caption looks), `templates.preview` (schematic SVG of a template's layout)
- `sequence.derive` (copy a video into another aspect as an editable sequence)
- `template.plan` (a dry run over the transcript), `template.apply` (commits it)
- `rules.list`, `rules.get`, `rules.schema`, `rules.save`, `rules.delete`
- `rules.evaluate` (an agent judges which rules hold for a video), `rules.apply` (executes them as a template application)
- `glossary.get`, `glossary.save`, `preferences.get`, `preferences.set` (see [RULES.md](./RULES.md))
- `plan.read`, `plan.generate` (an agent writes a sequence plan or the shared project plan), `plan.apply`
  (executes a plan as a template application; `all: true` reaches every video). Plans are part of the
  EDL (`edl.plan`, `sequence.plan`) and are edited with the `plan.patch` / `sequence.plan.patch` operations.

- `conversation.read` (the project's thread, oldest first)
- `media.transcribe` (imported media get their own transcript; words land on every shot cut from them)
- `project.batch` (starts the batch job: transcribe, plan and edit every pending video under the shared plan)
- `observations.read` (what the owner has corrected), `observations.review` (an agent proposes rules, glossary
  and preferences from it; nothing is saved until accepted)
- `conversation.undo` (take back everything one agent turn did, as one revision-checked edit)
- `packs.list`, `packs.inspect`, `packs.import`, `packs.remove`, `packs.export`, `quickactions.list` (see [PACKS.md](./PACKS.md))
- `media.import` also accepts a library video's asset id, and `place` to put the shot on a timeline in the same revision

The host binds the project ID. Asset services perform capture and search on behalf of
the agent; granting general network/shell access is not required for these operations.

### Conversation

A project has one conversation. The web panel, `agentcut edit PROJECT ask`, and a terminal
agent over MCP all write to the same `messages` table, and the analysis brief is its first
turn. Every editing run receives the recent turns (`conversation.json` in its run
directory, trimmed from the oldest) and the editor's context (`context.json`: open
sequence, selected items, playhead), so "shorter, like the last one" and "move this" mean
something. The agent's reply is recorded as a turn; a failed run leaves a turn saying so.

### MCP

`agentcut mcp` serves the same tools over stdio as an MCP server: one MCP tool per editor
tool, generated from the same schema (`agentcut_project_edit`, `agentcut_plan_apply`, …)
with a `projectId` argument, plus `agentcut_projects_list`, `agentcut_message_record` (log
what you did into the thread) and `agentcut_message_send` (ask the host's editing agent).
Revision conflicts come back as tool errors carrying the current revision, like HTTP.

`transcript.resync` is the "Re-sync captions" button in the UI. It is not a second
mutation path either: it recognises the audio again and then submits `clip.patch` /
`item.patch` operations that replace only `words`, so boundaries, edits, framing and
caption styling survive. Anything cut from imported media, and any canvas scene, is left
alone — the transcript belongs to the primary source.

## Transcription

`src/lib/transcribe/` owns the words every caption, template and clip selection is built
from. `ensureTranscript` is the single entry point: it reuses `transcript.json` only when
it came from the current engine, so improving the recogniser re-runs old projects instead
of silently keeping their worse words.

- `whispercpp.ts` runs whisper.cpp with `large-v3-turbo`, Silero VAD, and DTW token
  timestamps (which require flash attention off). It falls back to `small` if the model
  will not load, and records per-word confidence.
- `align.ts` snaps word starts onto the audio's own speech onsets and stops a word when
  its speech run stops. Whisper's word times are estimates on a 20ms grid; the audio is
  the ground truth for when a word begins.
- `polish.ts` sends only the segments whisper doubted to the local agent, which may
  correct wording but never timing: corrected words inherit the times of the words they
  replace, and a rewrite that keeps too little is refused. `AGENTCUT_TRANSCRIPT_POLISH=0`
  turns it off.

A caption's own timing lives in `src/lib/timeline.ts` (`lineAt`, `activeWordIndex`), which
the preview, the export and the tests all share.

`template.apply` is not a second mutation path. It plans against the transcript, resolves
each picture to an asset, and then submits ordinary `EditorOperation[]` through
`project.edit` with an `expectedRevision`, so a template's captions, cuts, punch-ins, hook
layer and images are all editable by hand afterwards. Every edit it writes carries
`by: "template:<id>"`; re-applying replaces only those, and only canvas layers whose every
edit still carries one. The agent receives `templates.json` in its run directory alongside
`project.json`. See [TEMPLATES.md](./TEMPLATES.md) for the document format, the picture
cadence, and the image providers.

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

What sits inside a layer moves through `item.patch` in the same way. A title carries an
optional free centre (`x`/`y`, 0..1 of the frame) that overrides its `position` preset, a
picture already had `x`/`y`, and the caption block has `captions.positionY`. The canvas
writes those fields when a title, picture or the captions are dragged, through the shared
`moveOverlay` in `src/lib/editor/canvas.ts`; the agent sets the same fields directly, and
the Selected panel shows them as sliders either way.
