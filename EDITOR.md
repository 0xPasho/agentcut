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
| `item.detachAudio` | Lift a shot's own sound onto an audio track and mute the picture |
| `item.transition` | How a shot arrives over the one before it on its track; `null` is a hard cut |
| `item.keyframes` | How a layer's transform and volume travel over the item's own time; `null` holds still |
| `clip.add` | Add a clip with a unique ID |
| `clip.remove` | Remove the identified clip |
| `clip.patch` | Change only supplied clip fields; caption fields merge individually |
| `edit.add` | Add a timeline edit |
| `edit.replace` | Replace an edit at its index in the expected revision |
| `edit.remove` | Remove an edit at its index in the expected revision |
| `output.patch` | Change only supplied output dimensions/frame rate |
| `media.transcription` | Record where an imported source's own words stand |

All seven edit types are supported: silence, punch, emphasis, text, image, sound effect,
and music.

Picture and sound are separate tracks. A layer is still a plain z-order integer in the
EDL, and both interfaces write the same `layer`; `src/lib/editor/tracks.ts` is how that
number is read. A layer carrying nothing but music, sound effects or hidden footage audio
is an audio track: it is drawn under the picture, named "Audio" rather than "Track 3",
and every gesture that hands it a sound — a drop, a drag, `placeAsset`, the default layer
of `item.detachAudio` — lands there instead of on a picture track. Layer 0 is always the
picture's running order, because a transparent scene there holds black frames for as long
as the sound it carries. One thing you can see anywhere on a layer makes the whole layer
picture again.

`item.transition` is the joint between two shots on one track. It is the only operation
that writes the incoming shot's `transition`, and it validates against the pair it joins:
a first shot has nothing to arrive over, and a joint refuses a blend longer than the two
shots can spare. Past that, geometry is clamped by `sequenceFrames` rather than refused,
so removing or shortening a neighbour can never fail because of a transition somewhere
else on the track. The overlap shortens the video; no footage is trimmed, so the inverse
operation restores the timing exactly. See [SEQUENCES.md](./SEQUENCES.md#transitions-between-shots)
for the model, the edges and why the overlap is not taken out of source handles.

`item.keyframes` is the layer's motion: the whole list is set at once, the way `crop`
already is through `item.patch`, so a keyframe is never addressed by an index a retime
would invalidate and one write is one undo. `t` is seconds from the item's own first
frame, which is the only time base that survives moving the shot, changing its layer or
giving it a transition — and the only one a canvas scene has at all. Every animatable
field is optional and an absent one keeps the static `transform` (or `volume`)
underneath; `src/lib/keyframes.ts` resolves the list for the timeline, the Player and the
export alike. The operation refuses out-of-order or duplicate times, a keyframe that
animates nothing, and one past the end of the shot, each with the number in the message;
it also refuses `item.place` changing a fixed value the keyframes animate, since that
edit could never be seen. A trim leaves keyframes where they are in the item's own time,
and a split gives each half its share with a keyframe on the seam so no pixel changes.
See [SEQUENCES.md](./SEQUENCES.md#keyframed-layer-transforms) for the model, the rejected
alternatives, and how this relates to automatic music ducking.

`item.detachAudio` is how a shot's sound becomes editable on its own. It adds a second item
over the same media with `hidden: true`, carrying the shot's silence cuts — and therefore its
exact length — but none of its captions, titles or pictures, and mutes the original. Nothing
about rendering changes: a hidden item's visuals are hidden and its audio still plays. The
timeline draws such an item as a sound, with the waveform of the file behind it.

A source's loudness envelope is computed by ffmpeg on this machine (`src/lib/peaks.ts`,
cached under `<project>/cache/peaks-<mediaId>.json`, served by
`GET /api/projects/<id>/media/<mediaId>/peaks`). A long stream cannot be decoded in the
browser, which is what the library's small audio assets still do. A file with no audio track
returns an empty envelope rather than an error.

Undo and redo are `invertOperations` in `src/lib/editor/history.ts`: the inverse of a batch,
expressed in these same operations and sent through the same save path. Nothing in the UI
writes a remembered EDL back over the project. Crop keyframes, layer motion keyframes, split rectangles, caption settings, transcript words, clip
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

The playhead is deliberately not React state. The player reports a frame thirty times a
second, and re-rendering the editor on each one costs tens of milliseconds — enough to
starve the player's own loop, which then drags the video element back to catch up and
replays the audio it had already played. `src/lib/editor/playhead.ts` holds the position
in a small store: handlers read it without subscribing, and only the running time, the
playhead marks, the ruler's slider value and the lit transcript word follow it.

## Agent and headless tools

`src/lib/editor/tools.ts` exposes project-scoped tools used by the UI and agent transport:

- `project.read`, `project.edit`, `project.render`
- `project.status` (what the project is doing now: status, the running job with its stage and
  progress, and every activity line since a cursor — read-only and safe to poll)
- `project.unlock` (release a project whose job is stuck; same escape hatch as the panel's
  **Stop and unlock**)
- `transcript.resync` (re-recognise the source and refresh every clip's words)
- `assets.list` (library plus project assets), `assets.capture` (source seconds)
- `assets.delete` (take one out of the library, the panel's own button). Refused while a
  template's bookend or a rule's slot still names it, saying which: removing one they name
  does not fail here, it fails later in the middle of a batch as "Asset not found" on a
  clip nobody was watching, and the rule written to put a card on every video quietly
  stops putting one anywhere. The file stays on disk — this is a listing, not a
  wastebasket, and the library keys an asset by its bytes, so dropping it back in
  `library/` brings the same asset back.
- `assets.search`, `assets.adopt` (select a returned provider/ID for a query)
- `assets.searchAudio`, `assets.adoptAudio` (the same two steps for sound: free-licence audio
  search, then download into the project with its licence and credit). A handful of starter
  sounds ship with the app and are installed into the library on first read, so a sting is
  available with no network at all.
- `assets.import` (a file inside the project workspace)
- `assets.upload` (name and base64 contents, using the same ingestion as UI uploads)
- `assets.importFolder` (every image/audio file in a local folder, in filename order)
- `assets.providers` (which image sources this machine has, and which need a key)
- `templates.list`, `templates.get`, `templates.schema`, `templates.save`, `templates.delete`
- `templates.suggest` (rank the templates against this video's own material)
- `templates.looks` (named caption looks), `templates.preview` (schematic SVG of a template's layout)
- Cuts that remove the whole of a shot are refused where they are written. The time map
  has to answer something for a clip that exists, and what it answered was the whole shot
  uncut — so a set of cuts saying "remove everything" came out as a shot with no cuts at
  all, which is the opposite of what was asked.
- `style.audit` reads an exported video back out of its own pixels and checks it against
  what its template said: the pane framed where the layout says at the moment the cuts
  say, the hook held across the body and off the end card, a word drawn into the caption
  band and a gap that is empty, the longest word stopping before the edges of the frame
  rather than running off them, the end card being the card and playing whole. The panel,
  the agent and `scripts/style-audit.ts` run the same reading.
- `scripts/caption-sync.ts PROJECT_ID` measures whether the captions are on the words: it
  marks what the footage's own sound calls speech, slides the transcript against it, and
  reports the shift that agrees best. A shift inside a frame is nothing; a consistent one
  across every video is what `captions.syncOffsetMs` is for. `src/lib/transcribe/sync.ts`
  is the same reading as a function.
- `sequence.derive` (copy a video into another aspect as an editable sequence)
- `template.plan` (a dry run over the transcript), `template.apply` (commits it)
- `rules.list`, `rules.get`, `rules.schema`, `rules.save`, `rules.delete`
- `rules.evaluate` (an agent judges which rules hold for a video), `rules.apply` (executes them as a template application)
- `glossary.get`, `glossary.save`, `preferences.get`, `preferences.set` (see [RULES.md](./RULES.md))
- `plan.read`, `plan.generate` (an agent writes a sequence plan or the shared project plan), `plan.apply`
  (executes a plan as a template application; `all: true` reaches every video). Plans are part of the
  EDL (`edl.plan`, `sequence.plan`) and are edited with the `plan.patch` / `sequence.plan.patch` operations.

- `conversation.read` (the project's thread, oldest first)
- `media.transcribe` (imported media get their own transcript; words land on every shot cut from them.
  `background: true` queues it and returns at once — the same call the asset panel's retry makes;
  `force` ignores both the cached transcript and the skip rules)
- `media.transcription` (where every source's words stand, and whether a newly imported one recognises
  itself), `media.transcription.set` (`audio`, `always` or `off`, workspace or project)
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

### Progress

An edit takes minutes, so no interface is left with a spinner. Every run reports what it
is doing line by line — the tool it is calling and on what, the stage, how it went — and
all of it lands in one place, the project's `events` table:

- `src/lib/activity.ts` turns a tool call into a line a person can read (`project.edit ·
  3 changes · item.patch ×2, item.place`), announced **before** the call runs.
- `src/lib/activity-log.ts` runs an editor tool and writes that line to the project's feed,
  whoever started it: the UI (`via: "web"`), a terminal agent (`"mcp"`), the CLI (`"cli"`).
  Reads and status polls stay out of the feed so it does not fill with someone's polling.
- The web streams it over SSE (`/api/projects/[id]/events`). `useProjectStream` keeps one
  connection per project, so every surface reads the same trail. The project page shows it
  once, in the agent panel: a second raw copy of the same feed below it was noise, not a
  second view.
  The panel is a chat: `src/lib/thread.ts` interleaves the conversation with the feed by
  time (splitting on job id, and on a gap over three minutes), so each turn shows what
  was asked, the steps that answered it and the reply. Steps collapse to one line —
  `12 steps · 1:48` — and open into `AgentLog`, which follows the newest line only while
  the reader is at the bottom. Any line too long for the panel opens in place.
- A terminal agent gets the same lines as MCP `notifications/progress` while its call runs
  (when it passes a `progressToken`), as the `activity` trail returned by
  `agentcut_message_send`, and by polling `agentcut_project_status` with the `cursor` it
  was last given.
- `agentcut edit PROJECT ask` prints them to stderr as they happen; stdout stays the result.

### The chat

`src/components/chat.tsx` is the chat itself — thread, composer, dropped files, harness
picker — and knows nothing about projects. A `ChatController` (`src/lib/use-chat.ts`) is
the only difference between surfaces:

- `useProjectChat` is the panel in the editor: the project's shared thread, its live
  feed, and edits that run against the open sequence.
- `useStartChat` is `/chat`, the empty window. The first message decides what to make:
  a link clips it (`/api/projects` then analyse), dropped footage is imported into a new
  project, and words alone create an empty canvas — all through the endpoints the home
  page cards already use. Then the message is sent as the project's first turn and the
  browser lands in the editor with the conversation already going.

Dropped, pasted or picked files are uploaded as ordinary library assets and ride along in
`context.attachments`. A run copies them into `attachments/` in its run directory, so the
agent can open an image to see it, and is told each asset id so it can place the same file
in the timeline. No second upload path, and the turn keeps its attachments, so the thread
still shows the picture next to what was asked.

### What the agent can see

A turn's run directory gets `frames/`, `transcript.txt` and `signals.json` for the open
sequence. The frames are stills of the **finished video**, not of the footage: they come
out of the same `SequenceComposition` the Player previews and the export writes
(`src/lib/editor/frames.ts`), so captions, titles, images, crops, layer placement and the
blend part-way through a transition are all in the picture. 360 on the short side, every
2s, capped at 32 frames — past that the cadence widens, because an agent that has seen
the first minute of a four-minute video and thinks it has seen the video is exactly the
confident-wrong judgement this exists to prevent. Files are named `frame-<output
seconds>.jpg`, as they always were.

Rendering costs seconds and a person is waiting, so it is cached on a hash of what the
composition actually reads — this sequence, the media it points at, the sampling — rather
than on the saved revision. A turn that changed nothing renders nothing; a turn that
edited a *different* video in the same project moves the revision but keeps these frames.
The whole sampling is bounded by a 40s wall clock: whatever rendered is kept, reported as
partial, and the next turn renders only the frames still owed.

Five things fall back to the old source frames — switched off
(`AGENTCUT_OUTPUT_FRAMES=0`), a sequence with no shots, a sampler already running
elsewhere, a machine still fetching Remotion's browser, and a render that fails. In every
one of them `frames.json` records `kind: "source"`, why, and what such frames cannot show,
and the prompt says the same in words. That honesty is the feature: an agent that thinks
it is looking at the output while looking at the footage will confidently approve captions
that are not there.

It takes **no job row**. The sampling happens inside the edit job that already holds the
project, so a row of its own would either deadlock against the turn that needs it or need
the `background` status automatic transcription uses for work that outlives its caller —
and this outlives nothing. It takes a pid-named file lock (`claimPidLock`, shared with
exports) and never waits on it: if an export or another turn is already rendering, this
turn reads the footage instead of queueing a person behind a render.

### MCP

`agentcut mcp` serves the same tools over stdio as an MCP server: one MCP tool per editor
tool, generated from the same schema (`agentcut_project_edit`, `agentcut_plan_apply`, …)
with a `projectId` argument, plus `agentcut_projects_list`, `agentcut_message_record` (log
what you did into the thread) and `agentcut_message_send` (ask the host's editing agent,
which returns its reply and the trail of what it did).
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
of silently keeping their worse words. It writes through a temporary file and renames, so
a process killed mid-write leaves either the previous transcript or none.

Importing a source starts its own transcription, off the project lock, into the same
`<project>/transcripts/<mediaId>/` cache the batch flow uses. Where each source stands is
a record on the media in the EDL, written by `media.transcription` in the same batch as
the words it produced, and both interfaces read and act on it through `media.transcribe`
and `media.transcription`. `AGENTCUT_TRANSCRIBE_ON_IMPORT` (`audio`, `always`, `off`)
overrides the stored setting; a test run is `off` unless it asks otherwise, and
`setDefaultRecogniser` is the seam that lets the path be exercised without a model. See
[SEQUENCES.md](./SEQUENCES.md#newly-imported-sources-transcribe-themselves).

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
The lock file records the pid that holds it, so a render killed mid-flight is taken over
by the next one instead of blocking exports until somebody deletes `render.lock` by hand.

`scripts/render.ts path/to/edl.json` remains an explicit standalone snapshot render.
It does not represent the latest state of a project in the database.

### Why a cut does not go black in the Player

An export extracts frames off-thread and never waits for a seek. The Player is a browser:
every cut — a shot boundary, or the splice a silence leaves — mounts a new `<video>` that
has to read a multi-hour recording's header and seek hours in before it has a picture, and
until then it paints nothing. Two things in `remotion/VideoRegion.tsx` and
`remotion/SequenceComposition.tsx` keep that off the screen, both preview-only — Remotion
drops premounting while rendering, and exports are byte-identical:

- **Premount** (`remotion/premount.ts`, two seconds): the incoming shot or span mounts
  early, invisible and frozen on its first frame, so the seek happens while the previous
  one is still playing. This is why the span `Sequence` is not `layout="none"`.
- **`pauseWhenBuffering`**: if a seek is still not done, playback waits instead of running
  on past footage nobody saw.

Postmounting the outgoing span to hold its last frame underneath is the obvious third
thing and it does not work: past the end of its own window the element's readyState has
dropped below HAVE_FUTURE_DATA, and Remotion answers that by calling `.load()` on it,
which resets the element and discards the frame it was being kept for.

The other half is `src/lib/httpFile.ts`, which serves every file with an `ETag` and a
`Last-Modified` built from its size and date. Without a validator the browser's media
cache may not keep a byte of a range response, so each of those elements re-read the
header from scratch. Size and date change whenever the file does, so a re-ingested source
is never served from the old cache, and a range asked with a stale `If-Range` comes back
whole rather than spliced onto a cached piece of a different file.

Nor does serving a byte range cost a read of the project any more. `readEditor` validates
the whole edit list, which on a four-hour project measured two to four seconds — per
range, and a `<video>` asks for many of them before its first frame. `mediaFile` in
`src/lib/editor/store.ts` reads the one field a file server needs out of the same
authoritative `edl` column and keeps it for as long as that revision stands. The same
ranges now answer in tens of milliseconds.

## Jobs and the project lock

A project runs one job at a time — analyze, edit, batch, transcribe or render — and the
`jobs` row with status `running` is the lock. The row is written by whichever process is
executing: the web server, or the MCP server in the owner's terminal.

A process can die without writing the ending, and the row would then hold the lock
forever. `src/lib/reaper.ts` decides liveness from facts, not elapsed time: the row
records the owner's pid and a per-run boot id, and every process is local, so
`kill(pid, 0)` answers whether the owner still exists. A heartbeat every 15s is only a
backstop for a recycled pid. Dead owners are reaped whenever a project is read or a job
starts, so a stuck project heals as soon as anybody opens it.

Rejected, and why:

- *Clear every running row when the server boots* — MCP runs in its own process and can
  start jobs, so a web-server restart would cut a live terminal-agent batch out from
  under itself.
- *A timeout alone* — wrong in both directions: it unlocks minutes after a crash, and it
  would kill a healthy long render that simply had nothing to report.

One kind of work deliberately sits outside that lock. Automatic transcription of a
newly imported source is a `transcribe-media` job whose row is written with status
**`background`**: `q.activeJob` does not see it, so it never closes the lock and a
person can keep editing the video they just imported while a render or an agent run
starts; `q.unfinishedJobs` does see it, so the reaper heals it from pid liveness like
everything else. It waits on nothing and nothing waits on it, which is what stops an
agent that imports media inside its own edit run from deadlocking against the lock it
already holds. Reaping one closes the row and logs the reason but does **not** hand the
project back — it never took it, and doing so would clear the status of a job that is
alive and holding it. "Stop and unlock" cancels it too, since the drain checks
`ownsJob` between sources. Rejected: taking the lock (locks the person out of the
footage they just added), and queueing behind it (still deadlocks the agent, and a long
render starves the words). See `src/lib/transcribe/auto.ts` and
[SEQUENCES.md](./SEQUENCES.md#newly-imported-sources-transcribe-themselves).

`POST /api/projects/:id/unlock`, the panel's **Stop and unlock** button and the
`project.unlock` tool are the same escape hatch for a job that is alive but stuck,
e.g. a model call that never returns. It abandons the run rather than cancelling it:
nothing interrupts the work, and the abandoned run's result is discarded if it ever
lands. Real cooperative cancellation needs an `AbortSignal` threaded through
conversation, render and transcribe, and is **not implemented**.

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
