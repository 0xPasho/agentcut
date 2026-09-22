# Local video projects

The application now supports two starting flows into the same local workspace:

The home screen offers two, as tabs:

- **Make something:** one box. Say what you want, drop videos into it, or paste a link;
  beside it you choose the shape (blank, 9:16, 4:5, 1:1, 16:9), the template it is made in —
  or several, a shortlist each video chooses from — and which agent runs it. Dropped videos are imported and placed in the order they were
  dropped, so the project opens with footage on the timeline. What to do with several of
  them — one video, or one each — is a sentence, not a form. Nothing here is required:
  send an empty shape and you get an empty canvas in the same editor.
- **Clip a long video:** analyze a long source and produce independently editable highlights.

Neither needs an agent to edit afterwards, and neither needs a hosted account.

A project can hold source media and multiple sequences. Each sequence is one output
video, with its own name, dimensions, frame rate, and layered timeline items. An item
references a media ID (or `null` for a source-free canvas scene) and contains the existing `Clip` editing properties: source
in/out, crop/split framing, transcript words, caption styling, and all supported edits.

## Use the visual editor

Choose **Make something** on the home screen, pick a shape, and send.
No footage is required. Optionally select starting videos (or enter local paths);
they appear on the initial timeline in the selected order. Files are copied into the project's local `media/` folder, so moving
the originals does not break the project. Invalid media rejects the import.

Both flows render the same `ClipEditor` component. A project is the editable canvas
and its assets, not a separate assembly interface. Start with **Add blank scene** or
**text**, or place an image/audio asset directly on the empty timeline. Canvas scenes
use the same editing properties and rendering composition as footage-backed scenes.

In the editor:

- Import additional sources and add footage to any sequence.
- Create and switch between multiple output videos.
- Move items earlier/later, remove them, trim their source in/out, or split them.
- Set an absolute start time and layer, overlap videos, and place a video in a corner.
- Adjust each layer’s position, size, rotation, opacity, volume, mute, and visibility.
- Animate any of those over the shot's own time, on the frame or in the **Motion** panel.
- Place titles, images, and audio on independent canvas layers, including music spanning cuts.
- Sound sits in its own region of the timeline, under the picture tracks: music, sound
  effects and separated audio go there, and dragging one over the picture sends it back.
- Add a title, an image, music or a blank scene from the one **Add** row under the timeline;
  the shot edits beside it — punch-in, emphasis, silence cut — act on the picked clip.
- Use **Captions** and **Add** for common shot edits. Source-frame
  capture uses the selected shot’s media, through the same `assets.capture` tool.
- Select a clip and its controls appear in the bar under the frame: hook, colours, mute,
  separate audio, split, duplicate, remove. The picture itself carries nothing but the
  layer's own handles, so every part of it can be dragged. Nothing selected means an empty
  column — the plan, templates, rules and format live behind **Video** in the header.
- Separate a shot’s audio to move, trim or level it on its own track. Every clip backed by
  footage draws that footage’s waveform.
- Find sounds online from the editor: free-licence search, downloaded into the project with
  its credit. A few starter sounds are installed locally, so this works offline too.
- Open **All scene properties** for captions, transcript words, titles, images, music,
  sound effects, silence cuts, punch-ins, crop keyframes, and split framing.
- Change each video's dimensions and frame rate in **Video settings**.
- Use **Edit with agent** to continue the same saved edit, or **Render** to render.
- Generated clips open in this same layered editor. The first saved edit promotes the
  clip in place, keeping its ID, title, output settings, source selection, edits and the
  agent's score — at forty candidates the ranking is how you choose what to watch, and
  losing it on the first edit loses it exactly when the work starts.
  Adding footage extends that edit; it does not create an independent copy. Project
  information screens link each saved video individually.

## Shared operations and persistence

All changes use the existing pure operation engine, SQLite revision checks, draft
recovery, and editor tool transport. This is not a second persistence or rendering
engine. UI and agent boundaries use the same validation.

| Operation | Behavior |
| --- | --- |
| `clip.promote` | Promote a generated clip in place to a timeline with the same ID |
| `item.place` | Set start time, layer, transform, volume, mute, or visibility |
| `media.add` | Register source metadata (normally emitted by the import service) |
| `media.remove` | Remove unused media from the project; reject if still referenced |
| `media.transcription` | Record where a source's own words stand; the one media field an edit may write |
| `sequence.add` / `sequence.remove` | Create/delete an output timeline |
| `sequence.patch` | Change the sequence name or output settings |
| `item.add` | Insert a video or source-free canvas item at an index, or append it |
| `item.remove` | Remove an item without deleting its source |
| `item.move` | Move an item to a zero-based destination index |
| `item.patch` | Update changed clip properties; optional `before` protects staged edits |
| `item.split` | Split at seconds relative to the item's source start, before silence cuts |
| `item.detachAudio` | Lift a shot's sound onto its own track, muting the picture it came from |
| `item.source` | Replace an item's footage in place, keeping its slot, overlays and placement |
| `item.transition` | Set or clear how a shot arrives over the one before it on its track |
| `item.keyframes` | Set or clear how a layer's transform and volume travel over the shot's own time |

`media.import` and `media.upload` are project tools accepting an `expectedRevision`.
Both use the same probing/copying service as visual imports. Path imports read a local
file on the user's machine; uploads accept a filename and base64 bytes. Agents should
use these services rather than inventing paths or source metadata.

Import failures remove their incomplete copies. A stale revision rejects registration
and removes the uncommitted copy. Removing a media entry does not delete its original
file or automatically reclaim its workspace copy.

Old EDLs parse with empty `media` and `sequences` collections. Existing clips retain
IDs and edits. Opening a page does not write a migration. On the first edit,
`clip.promote` registers the primary source as reusable media and replaces the clip
with a timeline of the same ID in the same atomic batch. Existing `/c/<id>` links
continue to open it, and exports retain the output ID. Revision rules still determine
whether an older download is current.

## Preview and export

`sequenceFrames()` allocates output frames identically for the timeline, Remotion
Player, and export. `SequenceComposition` composes the existing `ClipComposition` for
each item, so source audio, captions and edits use the same runtime in both previews
and finished videos. Imported sources can have different dimensions and frame rates.
Sources from older projects outside the workspace are served through explicit local
file aliases during export.

UI jobs, `project.render`, and CLI rendering resolve the same saved revision. `only`
accepts sequence IDs as well as legacy clip IDs. Downloads are revision-specific.
Empty sequences can be saved but cannot be exported.

There is a third consumer of that composition besides the Player and the export: the
editing agent. Before a turn, the open sequence is sampled to low-resolution stills
(`src/lib/editor/frames.ts`) so the agent judges the video a viewer would see rather
than the raw footage. `openRenderServe` in `src/lib/render.ts` is the one place that
decides how a source, a piece of media and an asset become URLs, and both the export and
the sampler go through it — a second answer to that question would be a second renderer,
and the two would drift into showing different videos. See
[EDITOR.md](./EDITOR.md#what-the-agent-can-see) for the cadence, the cache and the
fallbacks.

## Newly imported sources transcribe themselves

Words used to arrive only from the clipping pipeline or a hand-called
`media.transcribe`, so a video dropped into a project had no transcript until
somebody asked — and captions, the glossary, silence cuts, beats and every agent
judgement that reads text were blind on exactly the footage just added.

Every route in lands in `importProjectMedia` or `createVideoProject`
(`src/lib/editor/media.ts`): the home composer's drop and pick, `media.import`,
`media.upload`, a library video placed into a project, the batch flow, the CLI.
Each writes a `transcription` record onto the media **in the same atomic batch that
registers it**, so a source is never a video that merely happens to have no words.
The record is `queued`, `done` (with the engine and the word count), `failed` or
`skipped` — each with the sentence explaining it — and it carries `by`, the way an
edit does. Words themselves have no `by` field, so the mark lives on this record.
Absent means nobody has considered this source, which is what every EDL written
before this parses as; reading one persists nothing.

**It never takes the project lock.** A project runs one job at a time and the `jobs`
row with status `running` is that lock. Transcription is a `transcribe-media` job
written with status **`background`**: `q.activeJob` does not see it, so a person can
keep editing the video they just imported and a render or an agent run can start;
`q.unfinishedJobs` does see it, so `src/lib/reaper.ts` heals it from pid liveness
like every other job. Nothing waits on it and it waits on nothing, so an agent that
imports a source inside its own edit run cannot deadlock against the lock it holds.
The reasoning and what was rejected are in `src/lib/transcribe/auto.ts` and
[EDITOR.md](./EDITOR.md#jobs-and-the-project-lock).

**Opt-out, and its default.** `media.transcription.set` stores `audio`, `always` or
`off`, workspace-wide with a per-project override; `AGENTCUT_TRANSCRIBE_ON_IMPORT`
beats both, and a test run is `off` unless it says otherwise. The default is
**`audio`**: a source is recognised only when its audio track carries something. A
file with no audio stream costs one probe, and a silent one costs one decode to
measure its peak — a fraction of a recogniser run, which is what stops forty silent
b-roll clips from becoming forty model runs. It is a gate on sound, not on speech:
room tone counts as sound, and that is the honest limit of a test this cheap. On top
of that, `media.import` / `media.upload` / the composer take a per-import
`transcribe`, and the queue runs one source at a time, says which one it is on, and
stops with the project's **Stop and unlock**.

**Interrupted and resumed.** The transcript is written through a temporary file and
renamed, so a killed process leaves either the previous transcript or none — never
half of one; a truncated file from before this reads as absent rather than throwing.
A killed process leaves its sources marked `queued`, which is exactly true, and the
reaper closes the job row without touching the project's status (it never held it).
The queue resumes on the next import, on **Transcribe** in the asset panel, or on
`media.transcribe` with `background: true` and no ids. A second import joins the
drain already running rather than starting a second recogniser, and two callers
asking for the same source share one run.

**Both interfaces, one state.** Each source's card in the asset browser carries its
mark, its sentence and one button whose word is the state it is leaving — Transcribe,
Retry transcription, Transcribe again — and the switch sits beside them. The agent
reads the same record in `project.read`, the same summary from `media.transcription`
and from `project.status`, and is told in words when a transcript is still coming so
it cannot read empty words as "this video has no speech". Both call the same tools.

Not done, deliberately: a shot placed from a source *after* its transcript landed
does not back-fill its own words; `media.transcribe` does it instantly from the cache.

Transcription verification: `pnpm test` covers the import writing the record and the
words landing on the shot, the no-audio and silent skips with their reasons, the
per-import and per-scope switch with the environment beating both, a failure keeping
its reason and a retry clearing it, the cache being reused and a truncated one being
recognised again, the glossary reaching the recogniser on this path, one state read by
both interfaces, a second import joining the drain already running, an old EDL neither
carrying nor gaining the field, and the batch flow reusing an import's transcript. The
lock half is in the jobs tests: the lock stays open while a source is transcribed and a
render still starts, a dead background job is reaped without disturbing the live job
holding the project, **Stop and unlock** cancels the drain, and the panel does not paint
the editor busy over it. The recogniser is injected (`setDefaultRecogniser`), so no test
needs a model on the machine.

## Transitions between shots

A shot can arrive *over* the one before it on its own track instead of after it.
`transition` on the **incoming** shot says how: `kind` is `dissolve`, `dip`, `wipe` or
`slide`, `durationSec` is how long the two shots play at once, `color` is what a dip
passes through, and `direction` is the side a wipe or a slide arrives from. Absent is a
hard cut, which is what every existing project has and what every new shot gets.

It lives on the incoming shot rather than in an entity of its own because which two
shots meet is already decided by the track, the array order and `at`. A separate record
holding two item ids would state that a second time and go stale on every move, split
and removal; a field on the item travels with the shot for free, and `item.remove`
needs no clean-up pass behind it.

**The overlap comes out of the programme, not out of the footage.** The incoming shot
starts `durationSec` earlier and the video gets shorter by exactly that much. The
alternative — consuming source handles so the programme keeps its length — was
rejected. It would have to rewrite `clip.start`/`clip.end`, which rebases transcript
words, edits and crop keyframes through the same trim path a hand trim uses: setting a
transition would quietly move a shot's captions, and removing it could not put them
back. It is also impossible for two of the things this editor edits — a shot already
trimmed to the end of its source has no handles, and a canvas scene has no footage at
all. Nothing is trimmed here, so a transition is exactly as reversible as it looks.

Audio follows the picture. During an overlap both shots are already sounding, and two
takes at once is louder than either, so each end of a joint gets an equal-power ramp
(`crossfadeGain` in `src/lib/sequences.ts`): the incoming shot rises as a sine, the
outgoing falls as a cosine of the same progress, and the joint holds its loudness
rather than dipping in the middle the way a linear pair does. A template's transition
sting (`sound.transitions`) is a separate sound on its own layer and is untouched by
this; the two are meant to compose.

`sequenceFrames()` allocates the overlap, so the timeline, the Remotion Player and the
export agree on which frames are the blend and on how long the video is.
`SequenceComposition` wraps each shot in `Transition`, which is frame-driven only: a
CSS transition or animation is timed by the browser and would land differently on an
export that renders frames out of order. A dip's colour plate sits inside the incoming
shot, so it covers the track underneath and leaves the tracks above alone — a corner
mark or a hook holds straight through the joint.

### What is refused, and what is clamped

`item.transition` validates against the two shots it joins and refuses, with the number
in the message: a transition on the first shot of a track, one longer than the pair can
spare (each shot keeps at least one frame of its own, and two transitions touching the
same shot may not overlap each other), one shorter than a single frame, and one on a
shot pinned to an `at` that leaves it no overlap to blend across.

After that the geometry is **clamped, not refused**. Removing the shot before a
transition, or shortening either neighbour, leaves the author's transition on the item
and resolves it to whatever the joint can still afford, which may be nothing. The
alternative would let an ordinary removal fail because something else on the track held
a transition — a worse answer than a joint quietly going back to a cut, and one that
would make transitions a hazard to every other edit.

Splitting a shot leaves the opening blend on the first half; the second half meets the
first on a hard cut. A transition carries `by` like any other edit, so one a template,
a rule or an agent turn placed reads in "why is this here".

Templates do not place transitions yet. A template decides captions, dead-air cuts,
punch-ins, a hook and pictures from the transcript; the joints between main-track shots
are not something it authored, and giving it a say over them is its own decision rather
than a side effect of this one. The six deliberately silent older built-ins, and every
other template, still produce exactly the video they produced before.

### Using them

In the editor, a marker sits on the seam between two shots on a track. With nothing set
it appears while the track is under the pointer or the keyboard; once a transition is
there it stays lit and the overlap it costs is drawn across both blocks, so the time it
takes is visible rather than implied. Its menu holds the four kinds, three lengths and
letting go of it, with anything the joint cannot afford disabled rather than offered and
then refused. Exact values live in **All item properties**, whose Transition section is
generated from the same schema the agent reads.

Agents use `item.transition` through `project.edit`, over the file tool transport, HTTP
and MCP, with the same validation and the same messages. Undo inverts it like any other
operation, through the shared engine and the ordinary revision protocol.

Transition verification: `pnpm test` covers the frame allocation, every refusal and its
message, clamping when a neighbour is removed or shortened, splitting, inversion,
authorship, the equal-power ramp, HTTP/agent-tool parity with rollback, MCP, and that an
old EDL neither carries nor gains the field. `pnpm test:render` exports a real dissolve
and reads it frame by frame — the first shot alone, both shots at once inside the joint
with neither at full, the second shot alone after it — confirms a dip holds its colour
across the middle of the joint while a mark on the track above does not darken, measures
the outgoing shot's sound ramping down across the overlap, and checks that the
UI service, the agent's render tool and the CLI export the same video frame for frame.

## Keyframed layer transforms

A layer can move, grow, turn, fade and change its level across the shot it lives on.
`keyframes` on the **item** is a list of sampled moments; each one has `t`, any of `x`,
`y`, `width`, `height`, `rotation`, `opacity` and `volume`, and an `ease` saying how it
travels to the next. Absent — which is every project that existed before this — is the
static `transform`, rendered exactly as it always was.

**`t` is seconds from the item's own first frame**, in the item's own output time: not a
source timecode and not a time on the sequence. That is what lets a move survive being
dragged along the timeline, dropped on another track or given a transition, for the same
reason a transition lives on the shot it opens rather than in a record naming two shots.
It is also the only time base a canvas scene has, and a drift across a still is exactly
the case this has to serve without a special case.

Every field is optional and an absent one is simply not animated: it keeps the static
`transform` (or `volume`) underneath. So a title that only fades says `opacity` and
nothing else, and resizing it afterwards still works. A field named by exactly one
keyframe holds that value for the whole item, the way a single crop keyframe does, and
outside the keyframes the value holds at the nearest one at either end.

The catalogue of curves is small and named — `linear`, `ease`, `in`, `out`, `hold` —
because a pack is data and may never ship code, so the only curves that exist are the
ones spelled in the schema. They are quadratic: `ease` is the punch-in's own
`inOut(quad)`, which is the shape this editor has already agreed reads as arriving
rather than jumping. `hold` does not travel at all; the value steps on the frame the
next keyframe starts. `src/lib/keyframes.ts` is the whole resolver, and `sequenceFrames`
plus `SequenceComposition` carry it identically to the timeline, the Remotion Player and
the export — an animation that only looked right in the preview would be a failure.

### Ken Burns is not a feature

A slow push across a still falls out of this rather than being built beside it: the same
`x`, `y`, `width` and `height` any layer animates, travelling from where the layer is to
somewhere about 14% larger and off to one side, over the whole shot. The editor's **Add
a slow push** button writes exactly that as two ordinary keyframes, so an agent can
produce the identical thing by writing the list, and a person can then drag either end
of it. Nobody types a number to get one.

### Ducking, and which one to reach for

`src/lib/ducking.ts` is untouched and stays where it is. It is *automatic* and *local*:
a `music` edit with `duck: true` is lowered under the words of the clip it is inside,
computed from word timestamps rather than from audio. A `volume` keyframe is the other
thing — a gain envelope a person or an agent drew by hand, on the item as a whole.

They compose by multiplication rather than competing: `ClipComposition` computes the
item's own gain at the frame, and the music edit's ducked gain within it. Reach for the
keyframes when the automatic one cannot see the problem, which is the common case for a
bed on its own layer: it only reads the words of its own clip, and a bed sitting under
somebody speaking on a *different* layer has no words of its own to duck under.

### What is refused, and what is clamped

Refused, with the number in the message: two keyframes at the same `t` or out of order
(it names both times) and a keyframe that animates nothing at all — both checked in
`validateEdl`, so they hold on every path into the project and not only on
`item.keyframes` — and a keyframe past the end of the shot (it says how long the shot
runs), which is checked by the operation rather than in `validateEdl` on purpose: a trim
that shortened a shot would otherwise freeze the project it had just shortened. The
engine also refuses `item.place`
setting a fixed `transform` field or `volume` that the keyframes animate — that edit
could never be seen — but only when the value would actually change, so restoring a
placement an item already has, which is what undoing a reorder writes back for every
item on the track, still goes through. An empty list and `null` are the same thing and
both leave the field absent, so "holds still" has exactly one representation and saving
an old timeline never writes one into it.

After that it is clamped, following the transition precedent: an ordinary edit somewhere
else must never fail because of a keyframe.

- **A trim leaves the keyframes where they are in the item's own time.** Trimming the
  head means the move now starts at the new first frame; trimming the tail can leave
  keyframes past the end, which are kept and simply never reached. Two alternatives were
  rejected. Rebasing them through the source, the way words and crop keyframes are
  rebased, would make `t` a source timecode by the back door — contradicting the schema,
  and impossible for a canvas scene, which has no source time at all. Rescaling them to
  the new length would silently change a fade a person had timed at half a second.
  Keeping a keyframe that has fallen off the end, rather than deleting it, is the same
  choice: a trim is usually adjusted twice, and the second adjustment should find the
  work still there.
- **A split gives each half the part of the move it still has**, with a keyframe on the
  seam holding exactly the value the animation had reached there — the repair `trim`
  already makes to crop keyframes at a clip's new start, and what stops a cut from making
  the layer jump. With `linear` or `hold` either side, which is what every move authored
  in the editor starts as, the two halves are the original frame for frame. With a curve
  they are not: there is no member of the catalogue that means "the first 40% of an ease",
  so each half re-eases the travel it still has and the middle of each half lands slightly
  differently. That is the honest cost of the catalogue being small and named, and it is
  cheaper than the alternative — sampling the curve into a polyline would be exact and
  would throw the author's curve away. The seam keyframe carries the ease and the
  authorship of the one it was cut out of.
- **Replacing an item's footage leaves its motion alone.** `item.source` clears the
  transcript and the crop rectangles, which describe the footage being replaced; where
  the layer sits in the frame describes the layer.

Every keyframe carries `by`, so one a template, a rule or an agent turn placed reads in
"why is this here" exactly like every other edit. Templates do not place motion yet.

### Using them

Select a layer and **Motion** sits beside **Position & audio**. With nothing on it, it
offers the slow push and **Pin the placement here** — everything the layer is now, pinned where the
playhead is. Once there is something to travel between, dragging or resizing the layer on
the frame pins *that moment* rather than writing the fixed value underneath the motion,
and the handles sit where the layer actually is rather than where the static transform
says. The panel lists every moment with what it decides, who put it there and how it
travels, and retimes, re-eases and removes them; the timeline draws a diamond per
keyframe on the block, lit when the agent placed it. Exact values live in **All item
properties**, whose Motion section is generated from the same `TransformKeyframe` schema
the agent reads, seeded with what the layer is doing now. The placement panel marks the
fields the motion decides, so the refusal is never the first anyone hears of it, and
offers the only two answers that are true of an animated field: pin the number just typed
at the playhead, or stop animating that one field. Both are ordinary `item.keyframes`
edits — `setKeyframe` and `clearField` in `src/lib/editor/motion.ts` — so a way out of a
refusal is not a way around the operation.

A keyframe's `by` is read out rather than typed in, in **All item properties** as
everywhere else: it is what "why is this here" answers, and the system writes it. The
same is true of a transition's. An agent still sets both; only the panel stops offering
a text box over the answer.

Agents use `item.keyframes` through `project.edit`, over the file tool transport, HTTP
and MCP, with the same validation and the same messages. Undo inverts it like any other
operation.

Motion verification: `pnpm test` covers the resolver and every ease curve, a single
keyframe holding, an un-animated field keeping its static value, every refusal and its
message, clearing, the `item.place` rule and the placement-undo it must not break, trim,
split and source replacement, inversion — including undoing a split whose move reached
past the seam — a shot the trim left keyframes hanging off still being editable,
authorship, HTTP/agent-tool parity with rollback and both handoffs, MCP, the panel's own
shortcuts including Ken Burns, and that an old EDL neither carries nor gains the field. `pnpm test:render` exports a real move
and reads it out of the pixels — the layer on the left at the first frame and on the
right at the last, the run of it along a scanline wider every time it is measured, the
spot under the fading layer going from footage to layer, and the bed's level dipping
through the middle of the video and coming back — then confirms the UI service, the
agent's render tool and the CLI produce the same file frame for frame. Another cuts a
moving layer in two and reads the same seconds out of both exports, so "a split does not
change the picture" is a measurement rather than a claim. A second render
test covers a keyframed shot arriving on a dissolve: its own clock starts at the first
frame of the overlap, so it has already travelled by the time the blend finishes.

## Run from any folder

The default workspace resolves against the installation checkout, not the terminal's
working directory. The existing checkout's workspace is retained. An absolute
`AGENTCUT_WORKSPACE` selects another workspace consistently across entry points.

```bash
node /path/to/agentcut/scripts/agentcut.mjs dev
node /path/to/agentcut/scripts/agentcut.mjs projects list
node /path/to/agentcut/scripts/agentcut.mjs projects create "Empty canvas"
node /path/to/agentcut/scripts/agentcut.mjs projects create "My film" ./one.mp4 ./two.mp4 ./three.mp4
node /path/to/agentcut/scripts/agentcut.mjs edit PROJECT_ID read
node /path/to/agentcut/scripts/agentcut.mjs edit PROJECT_ID ask "Move the last shot first and trim it to two seconds"
node /path/to/agentcut/scripts/agentcut.mjs render PROJECT_ID --only SEQUENCE_ID
```

Creation, read, structured edits, and rendering do not need the web server running.
`projects create` calls the same creation service as the visual form. Paths supplied
to the launcher resolve relative to the caller; instruction text and project names
are forwarded literally. This is a checkout launcher, not a global package install.
Remote-device access is not part of this feature.

## Current scope and verification

The timeline supports overlapping video and source-free layers, with hard cuts.
Each item's optional `at` is its absolute start in output seconds. With no `at` (or
`null`), it follows the previous item on its own layer. Higher `layer` values draw
above lower values; items on the same layer retain timeline order. `transform`
contains `x`, `y`, `width`, and `height` in output-frame percentages, `rotation` in
degrees, and `opacity` from 0 to 1. `volume` ranges from 0 to 2; `muted` silences an
item and `hidden` hides its visuals. Source-free layers have a transparent background,
so titles, images, and audio can span cuts without covering the footage underneath.
The final uncovered background is black.

Consecutive shots on a track can be joined by a transition; see below. A layer's
`transform` and `volume` can be keyframed over the item's own time; see below. Newly
imported sources are transcribed automatically; see below. Existing source-crop
keyframes remain supported and are a separate thing: they move a window across the
footage, in source pixels and source seconds.
Per-item captions can be authored through properties or carried in from generated clips.
The existing manual conflict resolution, transcript-extension, and crashed-render-lock
limitations documented in [EDITOR.md](./EDITOR.md) still apply.

`pnpm test` covers multi-source state, HTTP/tool parity, trim/split/reorder behavior,
rollback, media references, import cleanup, legacy compatibility, and workspace paths.
`pnpm test:render` generates distinct source videos and verifies shot order, duration,
audio presence, and decoded-frame equivalence across UI-service, agent-tool, and CLI
exports. Browser checks cover multi-file creation, editing, external-agent handoff,
export/download, accessibility, and 320px layout.

A live authenticated Claude Code run also continued a browser-created three-source
project through the file tool transport: it moved the last shot first, trimmed its
source range, and renamed the sequence in one revision-checked save, preserving the
other shots and output settings. This is targeted smoke coverage, not an exhaustive
provider evaluation.

## Unified asset workspace

The shared editor has an **Assets** browser alongside
preview, timeline, properties, and agent controls. On narrower clip-editor screens,
**Browse assets** opens the browser without permanently taking preview space.

- **Project:** source videos, imported images/audio, and library assets used in the edit.
- **Library:** reusable images and audio, with image thumbnails and audio previews.
- **Folders:** explicitly browse a folder on this machine, move into subfolders/up to
  parents, and import supported videos, images, or audio. Listings are nonrecursive,
  omit hidden/unsupported entries, and paginate at 100 entries.
- **Online:** image search and adoption. Brand logos (Simple Icons, CC0) answer when the
  query is a company or product name; Wikimedia Commons and Openverse need no key. Pexels,
  Unsplash and Google Programmable Search are used only when their keys are configured and
  return nothing otherwise. `assets.providers` reports which are available. Attribution is
  retained for exported credits. This is image search, not a new remote video or music
  provider integration.

Source videos have inline previews and timeline placement controls. Images and
music/sound effects are placed at the playhead. These capabilities are identical
whether the editor began with a generated clip or an empty canvas.

The shared tools `assets.browseLocal` and `assets.importLocal` expose the same local
folder workflow to agents. `media.import` imports videos. `item.edit.add` atomically
appends an edit to a sequence shot; `edit.add` does the same for a legacy clip. File
imports copy originals into the workspace. Asset membership is tracked separately
from content deduplication, so reusing the same file in multiple projects makes it
available in each project's browser without duplicating its stored content.

The empty-canvas flow is also verified with title-first, image-first, and audio-first
creation, schema-properties edits, three later video imports, shared agent-tool updates,
render/download, and deleting/recreating the final sequence. Source-free render tests
check actual title/image pixels and audio, alongside existing multi-source and legacy
UI/tool/CLI export parity. Desktop and 320px browser checks report no page overflow
or automated accessibility violations in the tested states.

Layered editing verification: 34 domain/workspace tests and six real-render tests pass.
Exports verify overlapping video pixels, rotation, opacity, music across cuts, gain,
mute, visual hiding, UI/tool/CLI equivalence, and identical decoded video/audio when
a legacy clip is promoted in place. Browser checks cover the same controls on both
entry routes, pointer and keyboard movement, canvas resizing, title duration, agent
handoff, render/download, and no automated accessibility violations or 320px overflow
in the tested states. Use **Overlay at playhead** for picture-in-picture, select a timeline clip to move/resize its visual, and **Position & audio** for exact values.
Timeline blocks can be dragged or nudged with arrow keys; Shift nudges one second.

The asset browser now uses selectable thumbnail cards with type filters, search,
durations, used indicators, and a dedicated source preview. **Expand assets** opens
a larger gallery/viewer. Selecting or playing a source does not change the timeline;
placement is an explicit separate action. Online image adoption also imports first
for inspection. Browser checks verify video/audio playback, selection without edits,
explicit placements, desktop/mobile accessibility, and Escape dismissal.

## Templates

A template applies structure to one sequence: caption styling, dead-air cuts, punch-ins,
emphasis, a hook on its own canvas layer, optional title cards, and pictures placed on the
sentences that name something. It is not a separate assembly path — `template.apply` builds
`EditorOperation[]` and commits them through the same revision-checked store, so everything
it writes is an ordinary timeline item or edit. Every generated edit carries
`by: "template:<id>"`, which is what lets a second apply replace the template's own work while
leaving hand-made edits and hand-edited layers alone. A generated clip named as the target is
promoted in place first. See [TEMPLATES.md](./TEMPLATES.md).

Rules decide when a template applies: a plain-language condition an agent judges, and a
structured action (template, overrides, instruction) the host executes through
`template.apply`, marked `template:<id>/rule:<ids>`. A workspace glossary and preferences
reach every agent prompt and the transcription. See [RULES.md](./RULES.md).

Template verification: sentence segmentation, salience, cue spacing/density, application from
the HTTP and tool transports, re-application preserving hand edits, stills captured from the
footage, uncapitalised transcripts, structural cards, and the registry are covered by `pnpm test`. `pnpm test:render` exports a real video and checks that the planned
pictures appear in folder order at the planned beats, the gaps between them stay bare, the
hook layer survives every cut, and dead air is removed. Browser checks confirm the panel
plans and applies a template, its slot inputs, the online provider chips, no axe violations
on the editor page, and no horizontal overflow from the panel in a 288px column. A live
render also confirmed two brand marks placed side by side with the footage visible between
them, and that a corner watermark holds across every cut. A three-shot render was read
frame by frame either side of each cut: footage changes while the hook, the corner mark
and the ducked music bed hold, and each shot's pictures land on its own sentences. A live Claude Code run through
the file tool transport chose a template with `templates.suggest`, dry-ran it and applied
it without placing anything by hand. Production build passes.

## Timeline interaction

The editor has one time ruler and a draggable playback marker. Ordinary clip dragging
places items freely along any track or between tracks through `buildTimelineMove`,
which pins automatic neighbors to preserve their timing. Alt-drag onto Main inserts
between neighboring clips and closes gaps through `item.reorder`. Drag the ends of a clip to trim it.
The shared `buildTimelineTrim` adapter maps output movement through silence cuts,
bounds source footage, and resizes a standalone title/image/audio layer’s content.
Main-track trims ripple following clips; overlay timing stays fixed. `buildTimelineSlip`
changes which part of the footage a clip shows without moving it or changing its length: it is
one `item.patch` that moves both bounds and passes the author's overlays through unchanged, so
the engine's own rebasing carries the transcript and crop with the footage while titles stay
where they were put. It is bounded by the source at both ends, and the Trim & split panel drives
it, so slipping needs no hidden modifier and no new operation. Selected clip
effects appear under the same ruler rather than on a second timeline, and each one has the same
two edges a clip has: dragging them changes how long that title, zoom or sound runs, in the
clip's own source time, bounded by the clip that carries it.

Dragging snaps: a moved clip, a trimmed edge and an incoming asset all lock onto the
origin, the playhead and any other item's edges through the shared `snapTargets`/`snapSpan`
helpers, whichever of the moving span's two edges is closer. A white guide marks what it
locked onto. Snapping is a visible toggle in the timeline toolbar, and holding Command or
Control inverts it for the length of one drag. Only an edge that actually moves in output
time can snap, so trimming the head of a packed main clip still ripples instead of sliding.

Drag asset thumbnails onto a track to add media there, or drop video, image and audio files
straight from the desktop onto the track and position where they should land; both routes
ingest through the same import service and then place through the same operations. The drop
preview shows the real footprint of what is arriving, not a bare insertion line. Dropping
media onto the middle of a compatible clip replaces that clip's footage through `item.source`
(or, for a title/image/sound scene, patches only that scene's `src`), keeping its position,
trim and overlays; the outer fifth of a clip still inserts. Dropping onto the preview frame
places the media where it was dropped, carrying the spot into the item transform or the image
overlay's own coordinates. Right-clicking a clip opens split, duplicate, mute, hide and remove. Every way of adding media is draggable, not only clickable: project and library assets,
files listed in the folder browser, online image results, and files dragged in from the
desktop. Each lands through its own existing service — `media.import`, `assets.importLocal`,
`assets.adopt`, the upload route — and is then placed with the ordinary timeline operations
where it was dropped. Dropping files on the asset panel imports them without placing anything. The same holds
outside the editor: both start flows and the library page take a drop wherever they take a
click, and each one says what it will accept before the drop lands rather than failing after it. Dragging past either end of
the visible timeline scrolls it, and the playhead snaps to the same targets while scrubbing.
Stacking two clips on one track is legal — items layer by array order — but it hides one behind
the other, so a move or drop that would do it is drawn hatched and labelled before it lands,
through the shared `timelineCollides` check.
Command or Control with the wheel — a trackpad pinch — zooms the timeline around the pointer,
keeping the moment under it still; Shift with the wheel scrolls sideways. Transport keys work
wherever you are looking: Space or K plays and pauses, `,` and `.` step a frame, Up and Down
jump to the previous or next cut — every edge the snapping engine already knows about — and
Home and End jump to the ends. Space defers to a focused button or link so it never steals a control's key,
and a step reads the player's live frame so holding the key does not repeat from a stale one.
Clips copy and paste (Cmd/Ctrl + C and V) with their trim, overlays and placement intact.
Several clips can be selected at once — Shift- or Command-click, or sweep a band across
empty track space — and dragging any of them moves the whole selection in one
`buildTimelineGroupMove` transaction that freezes every clip left behind at the time it
resolved to. Delete removes the selection together, the timeline header says how many clips are held and
offers to let go of them, and Escape clears it. Removing from Main closes the gap only while
that track is still following on its own: once its clips carry times the author set by hand,
a removal leaves every other clip where it was, because packing the track would discard them. The selection is view state: it never reaches
the project, only the next transaction. Trim handles belong to the one clip being edited, so a
selection of several never covers the timeline in handles.
Every drag has a click equivalent, so nothing here is mouse-only: assets and folder files
have add buttons, online results adopt on click, desktop files come in through Import, and
a compatible selected clip can be swapped from the asset panel's Replace action instead of a
drop. Each track's label opens a menu — select its clips, move the track up or down among the
overlays (an ordinary group move), or clear it — which keeps track order reachable without a
pointer. Selecting several clips at once remains a pointer gesture; every edit it enables is
available one clip at a time from the keyboard.

Changes that are easy to miss or hard to reverse — a removal, a replacement, an import, or
an add from the asset panel, which happens away from the timeline — confirm themselves in a
toast that carries Undo. A drag that lands in view stays quiet, as do ordinary moves and
trims; those only announce themselves to assistive technology.

Inverting a batch normally replays it one operation at a time, since each inverse is read
against the state before its own operation. A batch of placements or patches on distinct items
never reads its siblings, so those — group moves, track swaps, the packing of a whole track —
invert against the original state in one pass instead, which keeps drag release off a quadratic
path. Undo and redo (Command or Control + Z, and the toolbar buttons) replay inverse operations
through the shared engine and the ordinary revision protocol, so they obey the same
validation as any other edit rather than restoring a remembered EDL. Reloading the project
clears the history, because it describes edits against the state being replaced. Project-level video creation and
selection live on the project information screen; the editor focuses on one output.
Precise position/audio and trim/split forms are collapsed until needed. Selecting a
visual clip exposes canvas handles automatically while playback is paused.

Timeline verification: 40 editing tests and 6 render tests pass. Browser checks
exercise mouse reorder and edge trim, keyboard reorder/trim, ripple deletion,
Escape cancellation, native video/image drops, effect nudging on the shared ruler,
and navigation back to project information. Desktop and 320px mobile checks found
no axe violations or horizontal page overflow in those tested states. Production
build passes with existing dynamic-filesystem tracing warnings.

A source clip draws a strip of frames sampled evenly across what it actually shows, so the
strip changes with the footage instead of repeating one frame; samples are cached per source
and range, at most two sources are sampled at a time, and a source that will not decode simply
has no strip. A sound on the timeline draws its own waveform: the file is decoded once in the browser, its
average energy is sampled into fixed buckets, and the shape is drawn to fit whatever width the
clip has at the current zoom. Decoded peaks are cached per file, and a file that cannot be
decoded keeps its plain block — the waveform is a reading aid, never a requirement.

Standalone title/image/audio items appear once on their track, labeled with their
content; selecting one opens its edit controls. Their internal full-duration effect
is not duplicated as a second, constrained draggable block. Nested clip effects
still appear below the tracks. Pointer gestures suppress native browser text drags.

Free-placement regression checks also verify short title blocks on a 44-second
timeline moving horizontally and between existing tracks, main-footage movement
away from zero, persisted positions after reload, and a single standalone title
block. Main reordering remains verified with Alt-drag. All 40 editing tests, 6 render
tests, the production build, and desktop/mobile browser accessibility checks pass.

Canvas placement is magnetic in the same way the timeline is: a dragged layer catches the
frame's edges and its centre through the shared `snapAxis`, drawing the guide it caught, and
Command or Control passes them by. Holding Shift while resizing keeps the layer's proportions.
Canvas manipulation previews the actual transformed content while dragging and
commits one `item.place` transaction on release; Escape/cancellation restores the
saved preview. Standalone title selection follows the rendered text bounds rather
than the transparent full-canvas layer. Title resizing anchors its top-left corner;
selection handles stay inside the preview and clear of playback controls. The
preview draft is temporary UI state; exported and agent-visible state remains the
shared saved transform.

The content inside a layer moves too. While a layer is selected, every visible title,
picture and the caption block inside it gets its own handle: dragging one writes the
overlay's free position (`x`/`y` for a title or picture, `positionY` for captions) through
one `item.patch`, previewing the real composition until release and snapping to the
frame's edges and centre with the same guides a whole layer gets. Captions keep their
horizontal centring and only move up and down. A press that does not move selects the
overlay so its controls open; arrow keys nudge by 1% and Shift by 5%. A title with a free
position keeps its preset width, so it wraps exactly as before; choosing a preset again in
the Selected panel or the Add panel clears the free position. A grid of thirds, the centre
and a 10% mesh covers the frame for the length of any canvas drag, including media dragged
in from the asset panel, so the size of what is moving stays legible against the frame.

Canvas browser checks verify live title/video movement, title-sized selection,
no saved mutation before release, no release jump, Escape restoration, live title
resizing, and one timeline scroll ancestor with thin dark scrollbars. The tested
portrait layout passes axe and has no page overflow at 320px. Build, 40 editing
tests, and 6 render tests pass.

Timeline edge scrolling runs continuously during a pointer drag, including while
the pointer is stationary near an edge. Scroll displacement participates in the
shared trim delta. Moving/extending an item can grow the horizontal timeline at a
fixed pixel-per-second scale rather than hitting the viewport boundary. Release,
Escape, and pointer cancellation stop the animation; only release saves the edit.
Browser checks verify zoomed edge scrolling, extension beyond the previous timeline
end at default zoom, persisted duration, and Escape rollback. Editing tests: 40 pass;
production build passes.
