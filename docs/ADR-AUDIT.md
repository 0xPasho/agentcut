# ADR audit — 2026-09-24

What was compared: the 17 docs in this repo (root `*.md`, `docs/`), the 74 rows of the
Decided table in [AGENT-FIRST.md](../AGENT-FIRST.md), and 51 Claude Code sessions from
2026-09-16 to 2026-09-24 (user prompts and assistant text, not tool output). Session ids
are the first 8 characters of the transcript; times are as logged.

The rule this audit holds to: an ADR is a numbered row in the Decided table with a
Decision, a Why and a Rejected. A decision that lives only in prose, in a commit message
or in a conversation is not recorded, however well the prose explains it.

Headline numbers:

| | count |
|---|---|
| Decisions made in conversation or code with no row | 77 |
| Rows whose Why, Rejected or Decision text is out of date | 31 |
| Doc statements contradicted by code or another doc | 34 |
| Ideas voiced and written nowhere | 12 |
| Process rules stated in capitals and written nowhere | 6 |
| Decision tables that exist outside AGENT-FIRST.md | 2 (SPEC.md 10 rows, HARNESS.md 10 rows) |

## Applied 2026-09-24

Done the same day, in commit `docs: the table catches up with what was decided`:

- **§1 → rows 75–129** of AGENT-FIRST.md (55 rows; the audit's drafts that were doc-level
  detail rather than decisions went into the docs instead). Mapping: F1→75, F2+F3→76, F4→77,
  F5→78, F6→79, F7→81, R1→80, R9→82, R3→83, R2→84, R4→85, R5→86, R6→87, R7→88, H1+H2→89,
  H3→90, H4→91, H1(panel)→92, H5→93, H6→94, E16→95, H7→96, E1→97, E2+E3+E4→98, E5→99,
  E6→100, E7→101, E8+E9+E10→102, E11+E12→103, E13→104, E14→105, H9→106, T1→107, T2→108,
  T3+T4→109, C1→110, C2→111, C3→112, C4→113, C5→114, C6→115, T5→116, B11(split)→117,
  P1→118, P2→119, P4→120, P3→121, P5→122, P6→123, P7→124, P10→125, V1→126, V2→127,
  D1→128, D5→129. F8→SPEC S3, F9→README, F10→BRAND, P8→row 69, R8→row 51, R11→row 43.
- **§2**: every listed row amended in place, dated; rows 18 and 41 filled.
- **§3**: items 1–9, 12–17, 19, 22–25 fixed in EDITOR, SETUP, README, HARNESS, AGENT-FIRST,
  PLAN-media, DESIGN, DESIGN-REVIEW, BRAND, RULES, SPEC, EDITING.
- **§4**: all ideas added to the Future list. **§5**: written into AGENTS.md ("Working in this
  repo"). **§6**: option 2 — SPEC rows are S1–S10, HARNESS rows H1–H10, cross-referenced from
  AGENT-FIRST's preamble and rows 56, 40, 42.

Still open, because another session was editing those files at the time:

- **SEQUENCES.md**: §3 items 9 (library kinds), 10 (copied vs referenced), 11 (peaks in
  browser vs server), 12 (phantom playback reservation, line ~704), 20, 21; the home labels;
  plus the timeline rules of rows 98, 102–104 in prose.
- **TEMPLATES.md**: §3 item 24 (duplicate `hook.maxWords`); "Templates panel" wording (row 28);
  optionality of templates (row 91).
- **PACKS.md**: row 121 is there; `review.json` in the folder listing (§3 item 16) waits for the
  review module to land; the missing-parent warning (audit P11).
- **Code left honest in the docs rather than hidden**: three `confirm()` calls remain
  (`project-view.tsx`, `sequence-settings.tsx`, `editor-status.tsx`) against row 102; raw
  `<details>` in `review/components/review-panel.tsx` and a native checkbox in
  `settings/components/toggle.tsx` against DESIGN.md's rule; `tools.ts:28` comment and
  `.env.example` still say "Stop and unlock" and `small`.
- **To confirm with the owner**: row 104's hidden-tab pause, reported as a defect and kept on
  purpose.

Section 1 is the backlog of rows to write. Section 2 is rows to amend. Section 3 is doc
text to fix. Sections 4 and 5 are ideas and process rules. Section 6 is the one structural
question: what to do with the two parallel tables.

---

## 1. Decisions with no row

Each entry is a draft row. The source column says where the decision was made and where
its mechanics are already documented, if anywhere. "Prose only" means a doc explains it
but no row records it; "conversation only" means nothing in the repo says it.

### 1.1 Foundations

| # | Decision | Why | Rejected | Source |
|---|---|---|---|---|
| F1 | **The agent says *what* to show; deterministic host code decides *where it comes from*, downloads it and records the licence. The agent has no network.** | Transcripts are attacker-controlled, so WebFetch/WebSearch are denied; giving the agent network "reabre justo la vía de exfiltración que cerramos". Rows 44 and 71–72 lean on this. | Agent with web tools; stock/generated images as default. | 09-16 `8adf7792` 00:20. Prose: PLAN-media.md:102-120. |
| F2 | **SQLite `projects.edl` + `revision` is authoritative; `edl.json` is a derived mirror. Every entry point (CLI, HTTP, MCP) registers the project in the DB; a project on disk the DB does not know is a bug, not a mode.** | The first CLI run wrote an EDL to disk and never appeared in the UI. | Disk as source of truth; CLI-only projects. | 09-16 `8adf7792` 21:37. Prose: EDITOR.md:9-12. |
| F3 | **Edits are atomic batches with `expectedRevision`; a stale batch fails with a conflict and the UI keeps the draft, never merges or overwrites.** | Two writers (human and agent) on one EDL. | Last write wins; silent merge. | Prose only: EDITOR.md:9-12, 107-114. |
| F4 | **The codebase is domain modules (`src/modules/<domain>` + `src/common`; `src/app` routes only), like postgun's web app, enforced by an architecture test. `server/` per module replaces a separate backend; `.ts` in modules import relatively because Remotion cannot resolve `@/`.** | One app holds server and web; the move was a TS-compiler codemod, not regex. | Flat `src/lib` + `src/components`. | 09-22 `02733df3` 22:59. Prose: AGENTS.md. |
| F5 | **A local file is referenced by path, never uploaded. "Choose from this computer" is a server-side file browser (`assets.browseLocal`) that returns a path; the project reads the file where it lives and the agent sees the same path. Drag-and-drop stays because it only has bytes, and streams.** | Everything runs locally; upload read the whole file into memory (2 GiB ceiling); a browser `<input type=file>` can never reveal the path. | Upload as default; raising the upload limit. | 09-21 `4a965b0c` 07:01-07:04. Check SEQUENCES.md:26,522 ("copied into `media/`") against this. |
| F6 | **Provider keys are write-only secrets in the workspace SQLite settings table: never in `process.env` (which `spawnStream` copies into every CLI), never returned to page or agent. The UI shows "set" and origin, with replace or clear.** | Env vars leak into every spawned harness; a masked tail is still a reveal; parity holds because both interfaces are equally blind. | Keys as env vars; masked display; `.env` beside run dirs. | 09-21 `355e4b39` 09:00. Prose: RULES.md:202-205. |
| F7 | **The product is an agent that edits video from whatever harness you use; the GUI is optional and never a prerequisite. README leads with the thesis; parity is stated as a requirement with a link to real status, never as "done".** | "El core es que no ocupas una interfaz gráfica y ya puedes tener todo funcionando." | README as "a local video editor" with a drag-and-drop tutorial; claiming full parity. | 09-21 `efbc5c26` 02:47-02:49. Strengthens row 42. |
| F8 | **Moment selection runs in an agent harness with tools, not a one-shot structured call; interactive tweaks ("make captions bigger") stay deterministic, never an agent round trip.** | Cost objection collapsed under a subscription; a harness adds tools, self-healing on media edge cases and open-ended steering. | One-shot structured call; routing tweaks through the agent. | 09-16 `8adf7792` 18:59-19:01. SPEC.md row 3 has half of it. |
| F9 | **Remotion is accepted with its licence constraint known (free ≤3 people); the EDL keeps the renderer swappable as the hedge.** | A project positioned as the open alternative must know who it excludes. | — | 09-16 `8adf7792` 20:17. README:171 only links the terms. |
| F10 | **The name is `agentcut`; "OpenOpusClip" stays a folder name.** | "Opus Clip" is a live trademark; "Open<Marca>" is exactly what gets a takedown; a tagline says how, a name says what. | OpenOpusClip; "harness edition" in the name. | 09-16 `8adf7792` 21:56-21:57. Nowhere in docs. |

### 1.2 Agent runtime and jobs

| # | Decision | Why | Rejected | Source |
|---|---|---|---|---|
| R1 | **A job's lock is owned by a pid + boot id; liveness is `kill(pid, 0)`, not a timer. A 15 s heartbeat is only a backstop for a recycled pid. Dead owners are reaped on project list, project read, job start and the SSE tick. `render.lock` uses the same primitive.** | One machine, so the exact answer exists; a timeout unlocks late after a crash and kills a healthy 40-minute render; closing a tab kills nothing. | Clearing every `running` row when the DB opens (MCP is a separate process); heartbeat as primary signal. | 09-21 `f2bc3fe7` 01:52-02:02. Prose: EDITOR.md:449-483. Row 64 borrows it. |
| R2 | **Stop kills the harness (2026-09-24). Every job carries an `AbortController`; `spawnStream` kills the child on the signal; the turn ends as "Stopped", not "Failed", keeping what was saved; Stop is offered from the first second.** Supersedes the 09-21 decision that "Stop and unlock" only abandons a run. | Stop only released the lock while the harness kept spending tokens for someone who had left; the button appeared after 120 s. | Abandon-not-cancel; a two-minute wait before offering Stop. | 09-21 `f2bc3fe7` 02:07-02:15 (abandon); 09-24 `b27f326b` 06:33 (kill). **EDITOR.md:485-490 still says "not implemented".** |
| R3 | **One activity feed, line by line, for web, MCP and CLI; no interface is left with a spinner. A tool call is announced before it runs; lines are readable, never raw JSON; reads and status polls stay out; MCP gets `notifications/progress`; CLI prints to stderr.** | "Como cuando nosotros corremos cualquier agente que nos muestra información, necesitamos hacer exactamente lo mismo aquí." | Spinner + "working"; a second raw log below the panel. | 09-21 `e2d8dab1` 02:04-02:18. Prose: EDITOR.md:206-228. Row 43 covers SSE only. |
| R4 | **A message written while a run is active is queued, shown as a queued turn with an X, and sent in order when the project is free; a failed send returns to the queue and holds the rest.** | One job per project is a fact about the editor, not a reason to make somebody watch before saying the next thing. | Blocking the composer; a second concurrent job; firing every queued message after a failure. | 09-24 `b27f326b` 06:33. Nowhere in docs. |
| R5 | **Agent replies render as Markdown through an in-repo parser: no HTML passthrough, `javascript:` links dropped, no new dependency.** | Every harness answers in Markdown; a reply quotes transcripts we did not write, so raw HTML is an injection surface. | A Markdown library with HTML passthrough; raw text. | 09-24 `b27f326b` 06:33. Nowhere in docs. |
| R6 | **A harness is hung when it goes quiet, not when a wall clock runs out: 10 min of silence ends the run, every line resets it, the clock stops while the host runs a tool the agent asked for, a 2 h ceiling ends a loud loop, stop is SIGTERM then SIGKILL after 5 s, and the transport owes an answer to every request.** | A 15-minute wall-clock timer killed a run 167 ms before a 21-minute `media.transcribe` answered. | Wall-clock timeout; no ceiling; letting a listener exception drop the poll loop. | 09-23 `cfa4510b` 18:44-18:52. Commit `d177524` only. |
| R7 | **Under `--permission-mode dontAsk` the deny list is the whole confinement, so every door to a shell, a delegate or the network (Bash, Monitor, sub-agents, WebFetch, WebSearch) is named in one shared list, not per driver.** | A run denied Bash reached for `Monitor node /tmp/...`; Monitor was not on the list. | Per-driver copies; allowlists. | 09-23 `cfa4510b` 18:52. SPEC.md:138-152 lists three tools and no single-list rule. |
| R8 | **The agent's output lives on disk and the host is rebuildable from it (`scripts/finish.ts`), because the harness child outlives the process that launched it.** | The dev server died with the shell; `claude -p` kept running and wrote `clips.json` "pero ya nadie lo estaba esperando". | Fire-and-forget. | 09-16 `8adf7792` 22:20. Row 51 has resumable runs without the principle. |
| R9 | **The selection agent must be able to reach the whole recording: the transcript is written as timed chunks with an index, and the frame-sampling interval scales with duration.** | One 5-hour transcript is past one `Read`, so the agent "would silently see only the start"; 60 frames capped at 30 s covered the first 30 minutes of 4.9 hours. | One transcript file; fixed frame count. | 09-16 `8adf7792` 20:56, 22:24. Code only (`clipping/server/select.ts`). |
| R10 | **The playhead is not React state; it lives in a module store and the timeline subscribes.** | Sixty updates a second through React re-rendered the whole editor. | Playhead in component state. | Prose only: EDITOR.md:116-121. |
| R11 | **Other writers' changes reach the editor by 1 s polling of the revision, not through the SSE event stream; a hidden tab stops polling.** | The event stream carries activity; the EDL is fetched whole on a revision change. | SSE carrying EDL diffs. | Prose only: EDITOR.md:101-105. Reads as contradicting row 43. |

### 1.3 Chat and home

| # | Decision | Why | Rejected | Source |
|---|---|---|---|---|
| H1 | **One `Chat` component with no project knowledge; a `ChatController` per surface; a third surface is a third controller, never a second chat. The panel is a thread with tool steps inline per turn, grouped per run, collapsed by default and open while running; the composer sits at the bottom.** | "Los usuarios ya han usado más estas UI en las que son chatbot"; two controllers would be two pollers and two accounts of what is running. | A log panel with the prompt above; a chat bound to the editor. | 09-21 `e2d8dab1` 02:23-03:03. Prose: EDITOR.md:232-248. Row 14 says only "side panel". |
| H2 | **`/chat` starts a project from a message alone: a link → clipping, a dropped video → editing, text → empty canvas. Attachments (drop, paste, paperclip) are ordinary library assets riding in `context.attachments`; no second upload path. Building from the home text area always creates a project.** | "No necesariamente partamos siempre de un video." Agent work is never done outside a project (09-24 report of a run with no project to open). | A brief field before creation; a separate upload route for chat files. | 09-21 `e2d8dab1` 02:59; 09-24 `6a82c390` 06:10. Row 30 says "drop media and describe". |
| H3 | **Two ways in: one composer and "Clip a long video". "Edit a set" and its brief field are gone; what to do with several dropped files is something you say, not a control.** A three-tab version was built and replaced the same day. | Simplicity of the first screen; the brief belongs in the project's chat. | Three tabs (Edit / Clips / Chat); a separate Edit card. | 09-21 `c26c16a6` 05:36-06:22. Status entry only; both versions still listed in Status. |
| H4 | **A template is offered, never required.** The composer carries a template chip; a project without one is fine. | "Tampoco quiero que sea algo obligatorio." | Template as the mandatory centre of the flow. | 09-21 `c26c16a6` 05:36. TEMPLATES.md never states it. |
| H5 | **The composer's gallery is the shape, and "Default" is first (2026-09-24): a Default sequence carries `autoOutput`, the first video placed sets the output shape, naming a shape ends it. A chosen shape wins over the first source's shape; dropped videos are placed on the timeline, not merely imported.** | Shape is the only decision costly to change later; "posiblemente el usuario no tenga un video con ciertas dimensiones o simplemente no sabe". | A template gallery as the big grid; forcing a shape before the first clip; importing without placing. | 09-21 `c26c16a6` 06:19; 09-24 `6a82c390` 06:10. Prose: SEQUENCES.md:87-88, DESIGN.md:128-133. |
| H6 | **Several versions of one video ("the 30s and the 60s") are additional sequences under the same project plan.** | Row 24 already makes a project hold N sequences and one conversation. | Duration as a render parameter; a project per variant. | 09-18 `dbe847bd` 04:00-04:07. Nowhere. |
| H7 | **Choosing several templates is a shortlist, not a mix: `plan.templates` is the set each video may be made in, `templates.suggest` ranks only the shortlist.** | Two caption styles cannot both win; for 20 clips and 3 looks each clip takes the one that fits. | Merging templates. | 09-21 `c26c16a6` 06:25. Prose: TEMPLATES.md:810-820. |
| H8 | **A clipping project's list is designed for N≈40 ranked candidates: rows, not posters; the score as a large neutral number with a meter; filter chips with counts; the panel scrolls, not the page; `SequencePlan` carries `score` so promotion keeps it.** | "No seria raro tenerlo todo vertical si a la derecha volveremos a desplegarlo de forma vertical?" | A 9:16 poster grid (built first, redone the same session). | 09-21 `d1261ef6` 06:36-06:39. DESIGN.md has nothing on the list. |
| H9 | **"Ask the agent about this" is a popover anchored to the clip with four states (idle, working + stop, answered + undo, waiting) read from the conversation, never a local flag; `context.selection` is stored with the message; a ring marks the clip being worked on.** | The one gesture that names a clip lost the clip on the way to the agent; a reload, a second window and an MCP run must see the same state. | A sentence typed into the side panel; state held in the popover. | 09-24 `fd7edc28` 03:06. Row 14 says only "context menu". |

### 1.4 Editor model and timeline

| # | Decision | Why | Rejected | Source |
|---|---|---|---|---|
| E1 | **A layer is a plain z-order integer; which layers are audio is derived from content, never a stored flag; layer 0 never carries music. Every gesture that hands over a sound lands on an audio track; a music bed is a track from 0 to the end, not a field inside the shot.** | A transparent scene on layer 0 held black frames for as long as the sound lasted; deriving the track means no schema change and both interfaces write the same `layer`. | A `kind: audio` field; music inside the shot's edits. | 09-22 `4176fcbe` 00:23-00:43. Prose: EDITOR.md:37-45. |
| E2 | **A title is text. A clip lists every `text` edit it holds; "Hook" survives only where it means something. A line added to a footage shot goes inside it at the playhead; one added elsewhere becomes its own scene.** | The UI showed `edits.find(text)` as "Hook", so a second line was invisible and titles looked like a different thing. | A separate Hook concept; a schema-level title type. | 09-24 `fd7edc28` 03:06. Prose: SEQUENCES.md:53-57. |
| E3 | **Titles share one track: `titleLayer` picks the first picture track above Main that carries only titles and is free at that moment, mirroring `audioLayer`; it answers with a track, never an existing shot to append into.** | Five lines made five tracks; appending into a template's hook shot is thrown away on re-apply. | A layer per title; merging into the existing title scene. | 09-24 `fd7edc28` 03:06. Commit `d887bb2`. |
| E4 | **`TextEdit` carries `color`, `background` and `fontScale`, all absent by default; size is a multiple of the renderer's automatic size, not a share of the frame.** | Colour was hardcoded in the composition, unreachable by hand, agent or template; "twice as big" survives a square or wide derive, "6 % of height" does not. | Size as a fraction of frame height. | 09-24 `fd7edc28`. Commit `5657132`. |
| E5 | **Detached audio is a second hidden item over the same `mediaId` plus the original muted, one shared operation `item.detachAudio`. Footage peaks are computed by ffmpeg server-side and cached; the browser decodes only small library sounds.** | `ClipComposition` already honours `hideVisuals`; decoding a two-hour stream in the browser is unworkable exactly in the clipping flow. | Extracting a WAV and inserting it as a `music` edit; client-side decode for long media. | 09-21 `c26c16a6` 05:37-05:38. Prose: EDITOR.md:71-81. Check SEQUENCES.md:684. |
| E6 | **Keyframed layer motion: `t` is seconds from the item's own first frame; the whole list is set at once; five named curves only; trim leaves keyframes in item time, split adds a seam keyframe; `item.place` refuses a fixed value the keyframes animate.** | A keyframe stored in source or sequence time breaks on the first trim. | Rebasing through source time; rescaling on trim; sampling curves to polylines. | Prose only: EDITOR.md:56-69, SEQUENCES.md:299-396. Status entry, no row. |
| E7 | **Undo and redo are inverse operations through the same save path, never a remembered EDL; history clears on reload.** | The inverse goes through validation and the revision check like any edit. | Snapshot stack. | Prose only: EDITOR.md:83-85. |
| E8 | **Destructive actions never ask; they act and offer Undo in the toast, and the engine refuses when the action is unsafe (a source still on a timeline).** | A native `confirm()` blocks and teaches nothing. | `window.confirm`. | 09-17 `6f3493a0` 09:22. SEQUENCES.md:657 covers toasts, not this. |
| E9 | **An edit that cannot happen says why instead of doing nothing (no footage that way, start of timeline, the clip's own edge); the context menu never moves the playhead.** | Three gestures answered a refusal with silence; Split was greyed out because opening the menu parked the playhead on the clip's first frame. | Silent no-op. | 09-24 `fd7edc28` 03:06. Commit `48186b9`. |
| E10 | **Timeline visuals show real data or nothing: waveforms are RMS buckets, filmstrips are frames sampled across the clip's own range, at most two decoders at once.** | The old waveform was a gradient: "looked like data but was decoration"; mastered music peaks at full scale everywhere. | Decorative placeholders; peak sampling. | 09-17 `6f3493a0` 10:10-10:22. SEQUENCES.md:681 has the cap only. |
| E11 | **Snapping is a recommendation: canvas magnet reach is measured against the frame, the three magnets per axis never claim more than a third of the travel; a clip's trim grip is one fifth of its width; a vertical drag never retimes (`snapDraggedSpan` holds the clip's time until the drag leaves snap reach).** | An 8 px screen magnet in a small preview left three positions; fixed grips made a 40 px clip all trim; changing track silently changed time. | Fixed-pixel magnets and grips; snapping from the moving edge only. | 09-21 `115c33ab` 06:49-06:54, `1c6d565b` 19:05. Not in SEQUENCES.md. |
| E12 | **A timeline clip borrows only the empty space in front of it for its minimum width; overlapping clips keep real width; an unset transition handle hides when the neighbour is closer than the handle, a set one never hides.** | A 40 px minimum swallowed neighbours on a 30-minute timeline; a stack must still read as a stack. | Flat minimum width. | 09-23 `cfa4510b` 18:31-18:36. Commit `97f7284`. |
| E13 | **The preview has no native player controls; scrubbing pauses; a click anywhere on the timeline seeks. Playback speed (¼× to 2×) belongs to the player only, pitch preserved; project, export and agent never hear of it. A hidden tab pauses the preview rather than crawling.** | The preview must show the playhead's exact frame; browsers throttle background timers so coming back forty seconds adrift is worse than paused. | Native Remotion controls; pretending to play in a hidden tab. Pasho reported "se para el video" as a defect; the fix keeps it paused. **Confirm.** | 09-18 `7577b09a` 02:33-02:38; 09-24 `fd7edc28` 06:11; commit `2b189d2`. |
| E14 | **Source-free projects are exact, not faked: `Edl.source` is `null`, legacy `clips` are refused without a source, imports never promote media to primary, missing media never silently renders as a canvas, an empty sequence is a clear render error.** | General editing is an empty canvas inside the same editor; every place a fake source could leak in is closed. | A required placeholder source; auto-promoting the first import; rendering black for missing media. | 09-17 `7941108c` 03:10. SEQUENCES.md:19 has `null` only. |
| E15 | **A punch-in eases in and out over ~0.3 s and, in split layout, pushes only the camera half.** | A linear 0.2 s ramp "se lee como brinco"; zooming the chat pane made text lurch. | Linear ramps; zooming both panes. | 09-18 `cb54d84a` 02:03. Code comments only. |
| E16 | **The editor is contextual: the right column is about the selection and nothing else; everything about the whole video lives behind one "Video" menu; constant controls sit on the frame; the chat is fixed below as the main mode. Controls live under the frame, never over the picture.** | "Un montón de paneles a la derecha nomás porque sí"; "los controles encima del video hace que se vea raro". | A permanent stack of right-hand panels. | 09-21 `c26c16a6` 05:36, `1c6d565b` 18:46. Prose: DESIGN.md:137-142. Row 28 is one step behind. |

### 1.5 Transcription and captions

| # | Decision | Why | Rejected | Source |
|---|---|---|---|---|
| T1 | **The recogniser's prompt is a vocabulary hint in the language being spoken; a user's brief or any English text is never whisper's initial prompt. The default model is multilingual with language auto-detect; never an English-only model.** | An English brief over Spanish audio made whisper *translate*; `.en` models "emit plausible garbage" on other languages. | Passing the brief as prompt; `small.en`. | 09-16 `8adf7792` 20:56; 09-17 `9f62b663` 07:33. Code comment only. |
| T2 | **With VAD on, token timestamps live on the compressed speech-only clock; `rebaseOntoSource` re-anchors each segment's words on the segment's own bounds, gated on VAD having run; any recogniser change bumps `ENGINE_VERSION`.** | 94 minutes of drift on a 4.4 h stream; clips and captions both read the wrong clock. | Re-syncing captions only; rebasing unconditionally. | 09-21 `4213ef73` 04:13-04:16. EDITOR.md has the engine-version half. |
| T3 | **Legacy data is repaired on read and on commit (`repairWordTimes`); a bad value arriving through an operation is still rejected.** | A revision-0 project could never pass today's validator, freezing six clips; repair on read fixes data, rejecting on write keeps a regression loud. | Loosening the validator. | 09-17 `9f62b663` 11:39; 09-18 `d443f38f` 02:31. Code only. |
| T4 | **The lit caption word is the last one that has started, held until the next begins; sampling is at frame centre; when two lines overlap the newer wins. Word-onset snapping moves only the first word after a pause.** | Whisper's word times leave dark gaps; the snap's failure mode must be "no change", never damage. | Highlighting only inside `[start,end]`; frame-start sampling. | 09-17 `9f62b663` 07:35, 16:31. Code comment only. |
| T5 | **The stream look shows the sentence being said, up to five words, white with the spoken word lit, two rows above the seam; a longer line is drawn smaller, never a third row. One-word-at-a-time was the look for one day and was measured out.** | Read frame by frame, popline never drew 20–26 % of the words and a third were up under 0.2 s. | One word at a time (`popline`). | 09-22 `3d3efd94` 08:12 → `02733df3` 22:28-22:50. Prose: TEMPLATES.md:606-615. |

### 1.6 Clipping and cuts

| # | Decision | Why | Rejected | Source |
|---|---|---|---|---|
| C1 | **Clip boundaries are decided deterministically from the signal, not by the agent: dead air trimmed to 0.25 s at both ends, the last word finishes, a laugh at the start is kept, a false start is removed only from two words up, and the agent's edits are rebased with the same `trim` the UI uses.** | A transcript does not show silence; a single repeated word is emphasis as often as a stutter; tightening bounds without rebasing edits was worse than not tightening. | `snapToWords`; letting the agent place the bounds. | 09-21 `f077bd84` 08:44-09:21. TEMPLATES.md:219 has the false-start rule only. |
| C2 | **The transcript proposes a cut; the sound decides it. A pause is cut only across audio 10 dB under the speaker's own level (50 ms windows); dead air the transcript claims is speech is a dry-run warning, never an automatic cut.** | On two real streams 62 of 196 transcript pauses had speech in them; a recogniser facing a long pause smears the next phrase backwards, so cutting there deletes captions of speech still in the video. | Transcript-only silence cuts; an automatic room-noise cut (written, measured, demoted). | 09-22 `3d3efd94` 17:09, `02733df3` 22:32. Prose: TEMPLATES.md:201-217, 633-645. |
| C3 | **A generation run is trusted only after an audit calibrated with seeded defects; clip starts are not extended backwards to the sentence start automatically.** | 24/36 clips "open mid-sentence" by a pause threshold, but extending backwards pulls in other people's speech; an audit that finds nothing proves nothing until it catches planted defects (12/12). | A generic extend-to-sentence-start fix; trusting a zero-finding audit. | 09-22 `9f06f200` 02:09-02:24. Nowhere. Strengthens row 34. |
| C4 | **A template says what kind of video it makes: a `selection` block (`mode: clips \| section`, count, min/max, target, chapters, brief) from which the selection prompt is assembled; `section` mode publishes one ordered sequence of shots through the same operations; a run with no template keeps the six-vertical-clips default.** | Who chooses was hardcoded, so a template could only dress what another had decided; a 16:9 run was told to split a webcam. | A second long-form editor; per-mode code paths downstream of selection. | 09-24 `e27f3679` 06:12-06:36. Prose: TEMPLATES.md:35-97. **Partially reverses row 32.** |
| C5 | **`rhythm.filler` and `rhythm.retake` remove spoken words and are off unless a template asks; thresholds are measured against the modelled channel; `news-desk` ships in-repo as a pack like any other.** | "A pass that removes spoken words is not something to inherit by accident"; on the reference channel "like" survives 1.3/min (a voice) while "uh" survives 0.04/min. | Default-on; a built-in stall-word list ("este" is a word). | 09-24 `b8ed97fe`. Prose: TEMPLATES.md:646-696. |
| C6 | **The first picture source is the stream itself: a frame at the moment described, proposed only from frames the agent actually read and only when the thing is not already visible; web search is the fallback, only for nameable things, and the resolver may answer "nothing" and drop the overlay. Licences accepted: CC0, PD, CC-BY, CC-BY-SA; rejected: NC, ND, GPL/AGPL.** | "Lo que explicas ya suele estar en tu pantalla"; "una imagen mala es peor que ninguna"; GPL on images is a legal mess; "git worktree" returned a Mitel phone until a title filter. | Stock as default; abstract-concept queries. | 09-16 `8adf7792` 23:24, 00:25. Prose: PLAN-media.md:176 (partial), prompt only. |

### 1.7 Templates and packs

| # | Decision | Why | Rejected | Source |
|---|---|---|---|---|
| P1 | **No channel's look is wired into the code. The built-in is generic; the owner's template in the pack is a sparse `extends` patch, so improvements to the built-in reach it without re-exporting; proven by writing an opposite template and applying it to the same footage.** | "Hay gente que tendrá o construirá diferentes templates." | Hard-coding the channel's numbers. | 09-22 `3d3efd94`. Extends row 46. |
| P2 | **A rule fills a template's video slot (`then.slots`), so a shared template ends on *your* card; the pack ships the mp4 and remaps its id on install. A `video` slot names the shape, never an asset id.** Replaces `then.overrides.intro/outro`. | The earlier form named an asset the template author owned; ids are per machine and cannot be written into a shipped document. | Asset ids in built-ins. | 09-22 `3d3efd94` 08:12-13:06. **Status "Phase 2" line still says overrides.** |
| P3 | **A pack carries `STYLE.md` (the channel's style guide) plus `examples/` with a note each, not `SOUL.md`; read before the owner's preferences, which win; 4000-char cap; an injection scan refuses the pack whole.** | "Soul.md le queda más a hermes/openclaw porque es la soul del agente que es tu compu; aquí el agente se queda y el canal cambia." | `SOUL.md`; trusting pack prose without a scan; two guides at once. | 09-22 `02733df3` 23:51-23:55. Prose: PACKS.md:36-71. Row 71 assumes it exists. |
| P4 | **Sound: free-licence search through Openverse; eight synthesised starters installed locally; a shipped template names a starter (`sound.*.starter`), never an asset id; older built-ins stay silent so an update never makes an existing video start making noise.** | Freesound needs a key + OAuth; ids are per machine. | Freesound first; retro-fitting sound onto old templates. | 09-21 `c26c16a6` 05:36-06:16. Prose: TEMPLATES.md:255-265, 840-845. |
| P5 | **A rule that would save and do nothing is refused (template at `stage: select`, missing `promptFile`) or warned (override naming a section the template lacks, unknown slot, empty `then`).** | All four saved happily and did nothing forever; warnings for the last three because a rule can arrive in a pack before its template. | Refusing "does nothing" outright (tag-only rules are legitimate). | 09-22 `3d3efd94` 17:45-17:51. Prose: RULES.md:46-58. |
| P6 | **`assets.delete` is a shared tool; both interfaces refuse to remove an asset a template bookend or a rule slot still names, saying which; the file stays on disk.** | Deleting the end card failed mid-batch as "Asset not found" on a clip nobody was watching; the panel had a button the agent had no verb for. | Web-only delete. | 09-22 `3d3efd94` 18:17-18:24. Prose: EDITOR.md:134-140. |
| P7 | **A stream clip opens on the chat comment it answers: chat read from the unified chat SQLite, the recording's `creation_time` as clock, the message chosen by what the streamer is heard reading aloud, never a random one; the card is drawn, not screenshotted; the hook layer keeps its span but its words start when the comment leaves.** | Avatars expire; a random comment is a lie; moving the hook layer breaks the "layer moved by a person" logic. | A screenshot of the chat; an LLM picking the comment. | 09-22 `02733df3` 22:28-22:40. Prose: TEMPLATES.md:336-374. |
| P8 | **A loudness target never turns a video *down*; the ceiling is the footage's peaks. A body-of-signal ceiling was tried and reverted.** | The body-based ceiling reached −16.7 LUFS with peaks at 0.0 dB, clipping. | Body-based ceiling. | 09-22 `3d3efd94` 16:11. Refines row 69. |
| P9 | **Never a second implementation of a rule: anything that predicts what a function will do calls that function (`templates.suggest` runs `planTemplate`; the panel sends overrides and the server merges).** | Two models of one rule drift silently: `suggest` promised three pictures for a template that placed zero. | Heuristic copies; client-side merges. | 09-17 `86e0a976` 08:30-08:33. TEMPLATES.md:384 for templates; belongs in AGENTS.md as a repo rule. |
| P10 | **`template.apply` plans on a count before importing anything; a refused apply imports nothing. Layout collisions between placed elements are solved by convention (hook top, channel bug bottom corner), not detection.** | It used to import the whole folder and then reject; detection couples the watermark to the hook's renderer constants. | Planner nudging. | 09-17 `86e0a976` 08:13, 15:43. |
| P11 | **A pack whose template extends one not on the machine is warned before install; templates inside the same pack count as present. Reinstall never duplicates rules, templates or assets.** | — | — | 09-22 `3d3efd94` 10:28. Not in PACKS.md. |

### 1.8 Rendering and preview

| # | Decision | Why | Rejected | Source |
|---|---|---|---|---|
| V1 | **Before a render the stretches a video plays are cut out of each source (conform), merged where they nearly meet, and the composition is pointed at those; the EDL is never rewritten; cuts are re-encoded, not `-c copy`; skipped under `CONFORM_MIN_BYTES`; the per-frame timeout is effectively unlimited.** | `OffthreadVideo` copies the whole file before the first frame; a 26-minute export copied 4h43 and died; `-c copy` leaves an unknowable keyframe offset. | Range caps on the file server (wrong hypothesis); `file://`; manual chunked renders; a bigger finite timeout. | 09-24 `434e81d2` 03:41, `fd7edc28` 04:31. Prose: EDITOR.md:394-413. |
| V2 | **A preview cut is kept off black by premounting 2 s and `pauseWhenBuffering`; postmount is rejected; served files always revalidate (`no-cache` + `ETag`) instead of a `max-age` window; the media route reads the path without validating the whole EDL.** | Each cut mounts a fresh `<video>` that re-reads a 6.7 GB header; a re-rendered clip keeps its URL so a 5-minute cache shows the old one; Remotion calls `.load()` on a postmounted element. | `max-age=300`; postmount. | 09-22 `9f06f200` 01:52-02:16. Prose: EDITOR.md:415-447. |
| V3 | **Read the rendered pixels, do not trust the EDL: a template change is verified by reading exported frames.** | Composition faults (logo at photo width, crop overflowing, card over captions) showed only in exported frames while every numeric test passed. | Numeric tests alone. | 09-17 `86e0a976` 08:09-08:18. Rows 71-73 cover review, not the engineering habit. |
| V4 | **Remotion's per-process webpack bundle is deleted when the process exits; an image filling its whole scene enters on the cut, no fade.** | 352 leftover dirs, 16 GB, on one machine. | — | 09-22 `3d3efd94` 21:27, `0cb15d2d` 01:33. Commit `23d1a1e`. |

### 1.9 Design and brand

| # | Decision | Why | Rejected | Source |
|---|---|---|---|---|
| D1 | **The house style is Artlist's dark palette rendered as Apple's Liquid Glass material, built only from shadcn primitives; dark only, no light theme. Neo-brutalism was decided, documented and reversed the same night.** | Pasho saw the built result and changed direction; "es el estilo de liquid glass que quiero que adaptes, no solo los colores". | Neo-brutalism (built and thrown out); "just the palette" reading. | 09-16 `8adf7792` 22:17-22:48. DESIGN.md records only the winner. |
| D2 | **No raw browser controls: `<select>`, `<input type=color>`, `<details>` and native checkboxes exist only inside `src/common/ui` primitives; `PopoverContent` is a panel, the menu popovers opt into menu padding.** | Twelve panels looked broken for four shared causes, not twelve. | Fixing each panel; native pickers. | 09-22 `f1c5f8f7` 00:16-00:33. DESIGN.md never bans raw controls. |
| D3 | **Nothing may look interactive without being so; every state has a way back from the UI; a capability is not done until it is reachable in the editor; new things land at the playhead.** | "Siento que hay un montón de cosas en la UI que no son clickeables"; "te pedí que implementaras todo, no veo nada". | Quick-view-only controls. | 09-16 `8adf7792` 23:39, 01:14-01:24. Nowhere. |
| D4 | **A link that looks like a button is `<a>` wearing `buttonVariants`; the shared `Button` is never patched to accept link semantics.** | Patching `Button` stamped `role="button"` onto real navigation links. | Patching `Button`. | 09-17 `6f3493a0` 08:18, 11:25. |
| D5 | **The mark is a character (happy scissors whose finger rings are the eyes); the app icon is the macOS-Tahoe material; the header uses the icon at 28 px, not the amber glyph.** | The double reading (tool and face) is the brand; the frosted icon "is the product presenting itself" while the flat glyph "read as one more control". | Cut-corner pill family (a pill inside the OS squircle); organic variable-stroke marks (read as a plant app); flat glass versions (eyes become holes); the earlier brief that the logo must show "código/agentes". | 09-21 `96797656` 07:28-08:28. BRAND.md has no Rejected section. |

---

## 2. Rows to amend

Rows where the conversation carries a Why, a Rejected or a nuance the row lacks, or whose
Decision text no longer matches the code.

| Row | What is missing or wrong |
|---|---|
| 1 | Says `plan.json` per video; the plan lives in the EDL (`edl.plan`, `sequence.plan`), the run dir gets `project-plan.json`. |
| 2 | Marker format is `template:<id>/rule:<ids>`, not `rule:<id>`. |
| 4 | "Editable in the UI": the tag editor is still open per M1 status. |
| 6 | "or zip": no zip import exists. |
| 8, 10, 12, 20, 45, 56, 57 | Decision text still says "phase 1/2", "v1", "for now", "milestones"; all shipped or superseded, none amended. |
| 13/14 | Add the clip popover (H9) and the chat-thread shape (H1); "or time range" is not built, clip only. |
| 16 vs 39 | 16 says the agent may suggest saving a rule when a request repeats; 39 says such prompts are intrusive. Unresolved. |
| 17 vs 29 | Neither cross-references the other; 29 supersedes 17 for the editor agent. |
| 18 | Rejected is "—". |
| 24 | "Only approved ones render" overstates: approved-only once anything is approved, otherwise everything. |
| 28 | Plan panel itself moved behind the Video menu (E16); code still has both panels; SPEC/TEMPLATES still say "Templates panel". |
| 30 | Add: a message, a link or a file each start a project; always creates one (H2). |
| 32 | Section mode writes sequences directly, the Rejected column's alternative. Needs a dated amendment. |
| 34 | The eval set of 5–10 projects does not exist; what exists is cold runs, `style.audit`, pace vs the published short (09-21 `f077bd84` 17:44). |
| 35 | Agent tagging at import is not implemented; tags are a plain string. |
| 36 | Code has two rule levels (workspace, project); pack level now holds `STYLE.md`; precedence is pack < workspace preferences < project < rule instructions. |
| 39 | Why should be Pasho's: "tampoco quiero que sea tan intrusivo... que toda esta lógica sea bastante simple de mantener". Add seam-move as a named observation. |
| 40 | Why: Pasho withdrew skills himself; the ranking that replaced them: see the video > plan with reasons > rules as constraints > examples. Add Cursor as a fourth harness. |
| 41 | Why and Rejected both "—". |
| 42 | Quote "la web es un caparazón"; add F7. |
| 46 | Add "a pack's template is a sparse patch over a built-in". |
| 47 | Thumbnails are schematic SVG; row reads as done. |
| 49 | Superseded by 58–62; only the status side says so. |
| 51 | Add R8 (artifact on disk, host resumable). |
| 52 | Status admits an offset a trim does not move. |
| 54 | Add: a template applied to a derived video respects its shape; a variant moves captions with the seam; 16:9 has no split. |
| 58/61 | Add: `onboarding.run` streams because 20–40 s of full-screen spinner reads as hung; visiting `/welcome` is reopening (no state write in a render); workspace tools need no project. |
| 64 | Add: the panel writes the workspace level and deletes a differing project override; env var disables the buttons. |
| 69 | Add P8 (never down; reverted experiment). |
| 71–74 | Origin: review is per-pack ("cada package tendrá indicaciones de qué es correcto"); OpenMontage was reviewed first on request. |
| Wanted | Marketplaces are parked because "no lo tengo digerido", not because they are wrong. "A settings home: built" is misfiled under Wanted. |

Rows with a slogan for a Why (8, 12, 22, 26, 28, 31, 33, 43, 47, 50) would each take one
sentence from the sessions above.

---

## 3. Doc text contradicted by code or another doc

Ordered by how likely a reader is to be misled.

1. **EDITOR.md:485-490** says cancellation is "not implemented" and unlock abandons. Stop kills the harness since commit `7b16600`.
2. **docs/SETUP.md:64,121** whisper default `small`; code, README and EDITOR.md say `large-v3-turbo`.
3. **docs/SETUP.md:10,50,169** "Claude Code or Codex"; four harnesses ship. SPEC.md:130 and BRAND.md:68 also count wrong.
4. **AGENT-FIRST.md Status, Phase 2** says the rule action is `then.overrides.intro/outro`; it is `then.slots`.
5. **HARNESS.md row 8** "No favourites, no ⌥1–9 in v1"; both built 09-21. HARNESS.md:46-76 file paths and :100-121 mount points do not match `src/modules/agent/server/`. HARNESS.md:41 test count is stale.
6. **AGENT-FIRST.md Phases §1** keeps `plan.regenerate`, `agent.message`, `library-index.json`, "cached thumbnails" with no historical marker under a section saying Phase 1 is complete. None exist in code.
7. **AGENT-FIRST.md Status** lists both "three tabs Edit/Clips/Chat" (09-20) and "a box and a tab" (09-21) without marking the first superseded. SEQUENCES.md:7,24 and DESIGN.md:128 say "Make something"; code says "Create a video".
8. **PLAN-media.md:91,178** "No bundled audio"; eight synthesised starters ship. Reword to "no third-party audio". :142 omits video; :95 Freesound never built.
9. **SEQUENCES.md:505** "Library: reusable images and audio"; row 11 and :146 say video too.
10. **SEQUENCES.md:26,522** "files are copied into `media/`" vs F5 (a picked file is referenced in place). `media-import.ts:47` still copies drops; both paths need one sentence.
11. **SEQUENCES.md:684** "decoded once in the browser" vs EDITOR.md:77 (ffmpeg peaks server-side) if it still describes footage.
12. **DESIGN.md:181** and **SEQUENCES.md:704** reserve hit area for playback controls the player no longer draws.
13. **SPEC.md row 8** face-pass reframe: no face detection in src; framing is template `layout` (row 65). **SPEC.md row 9** "SRT/VTT import always": never built.
14. **SPEC.md:140 vs :145** "the agent gets Bash" then "Bash is denied by default"; the first is the threat model, reads as current. :131 "Homebrew's is *currently* broken" is undated.
15. **README.md:40** "around sixty tools"; `tools.ts` has 82 plus 3 MCP-only. `agents.status` appears in no doc.
16. **EDITOR.md:307** `transcription/server/transcribe/`; files are flat. AGENT-FIRST Phase 2 `packs/server/packs/`; it is `packs.ts`. PACKS.md:16 lists `review.json`; `packs/news-desk/` has none and the manifest type has no field for it. REVIEW.md:180 "beside `rendered.json`": no such file.
17. **Labels that do not exist in src:** "Edit with agent" (SEQUENCES.md:65, EDITOR.md:371), "Stop and unlock" (EDITOR.md:129,206; SEQUENCES.md:175,206), "All clip properties" / "All scene properties" (one of three names exists), "Add blank scene" (SEQUENCES.md:30).
18. **RULES.md:3-8** two levels vs :196 "project and sequence level" vs row 36 four levels vs REVIEW.md:166 built on four.
19. **docs/SETUP.md:118-124** lists 5 env vars; code reads 25. :139-144 workspace layout omits `transcripts/`, `cache/`, `library/`, `packs/`, `templates/`, `rules/`.
20. **SEQUENCES.md:37 vs :669** "create and switch between output videos in the editor" vs "the editor focuses on one output". DESIGN.md:176 sides with the latter.
21. **SEQUENCES.md:674,697,726,735** "40 editing tests and 6 render tests" four times; 476 tests today.
22. **EDITOR.md:372** "both provider adapters"; four.
23. **DESIGN.md:23 vs :186** card radius 24 px vs modal 20 px.
24. **TEMPLATES.md:705-717** two overlapping `hook.maxWords` bullets.
25. **DESIGN-REVIEW.md:69** verdict "Block" kept after :3 says the findings shipped; line refs predate the module move.
26. **Memory note `pashoai-stream-style.md`** may still describe one-word captions (T5).

Overlaps worth folding: auto-transcription (SEQUENCES, EDITOR ×2, row 64 + status), transitions
(SEQUENCES, EDITOR, row 63 + status), keyframes (SEQUENCES, EDITOR, status), jobs/lock
(EDITOR, SEQUENCES, row 64), pack review (PACKS.md:93-135 is a copy of REVIEW.md), the home
screen (five places), the shared-editor contract (six places). No doc except AGENT-FIRST.md
and REVIEW.md carries a date; none names an owner.

---

## 4. Ideas voiced, written nowhere

For the "Future, noted so the plan leaves room" list.

- **Repair loop:** the agent renders, reads the output frames and patches its own EDL. (09-16 19:50, 21:35.) REVIEW.md covers verdicts; an autonomous fix pass after a finding is recorded nowhere.
- **Camera region that follows the webcam** when the window moves during a stream (keyframed region tracking). (09-16 21:34.)
- **Chunked, parallel rendering** of a long video joined with `-c copy`; done by hand once when the disk filled. A shared temp cleanup between chunks kills the others. (09-24 `434e81d2` 04:14.)
- **Publishing metadata from the project:** thumbnail, three A/B titles with distinct angles, a description whose timestamps come from EDL chapters. Pasho ran the whole flow by hand. (09-24 `434e81d2` 02:56-04:42.) "Publishing videos" is listed; metadata is not, and C4's `chapters` already yields the timestamps.
- **Voice input:** mic in the composer → local whisper.cpp → text in the chat, no network. Deferred 09-21 (`c26c16a6` 06:14).
- **UI controls for a template's sound section.** Deferred the same day.
- **Worked examples on rules and templates** (`examples`: two good hooks) as the cheap substitute for skills. (09-18 `dbe847bd` 03:51.) Packs' `examples/` is for review, not prompting.
- **Re-anchoring edits to the words they name** rather than to seconds, the way beats reference items (row 52). Done by hand once. (09-21 `4213ef73` 04:29.)
- **"Mix two videos or whatever" from a sentence** in the chat; a *researched* template repertoire. (09-21 `c26c16a6` 05:36.)
- **Glass versions of the character** for in-app surfaces (splash, floating button). Suggested, not adopted. (09-21 `96797656` 08:13.)
- **The clipping list designed through claude.ai/design.** No design-system project exists there for this repo. (09-21 `d1261ef6` 06:39.)
- **Marketplaces for packs and templates**, parked because not yet digested. (09-21 `355e4b39` 08:38.)

---

## 5. Process rules stated and written nowhere

Belong in AGENTS.md. Today they exist only in Claude's auto-memory or in chat.

1. **Work on `main`; never create a branch**, even with several agents on the same checkout. (09-21 `c26c16a6` 05:38 "NUNCA CREES NINGUN BRANCH"; `355e4b39` 08:43.)
2. **Commit by paths, never `git add -A`**, because another session edits the same tree. (`f2bc3fe7` 02:15.)
3. **Parallel agents get disjoint file scopes; each feature runs `test` + `test:render` + `tsc` and commits green before the next starts.** (`355e4b39` 08:38.)
4. **Features land whole, not in phases.** (`c26c16a6` 05:37 "todo va a ser integrado de una sin fases".)
5. **In autonomous loops, grill-me's answer is the source of truth and Pasho is not asked.** (`3d3efd94` goal prompt.)
6. **Docs and ADRs are written in English, whatever language the conversation is in; ADRs are the numbered Decided table, no `docs/adr/`; a design decision updates the docs and the table in the same commit.** (09-24 `b65bd6ed` 06:27 "NADA EN ESPAÑOL", 06:29-06:34.)

Two engineering rules from the loops that also belong there: **one implementation per rule** (P9) and **read the pixels** (V3).

---

## 6. The two parallel tables

SPEC.md:123-136 (10 rows, founding architecture) and HARNESS.md:15-28 (10 rows, harness
selection) are numbered Decided tables that the memory rule "ADRs live in AGENT-FIRST.md"
does not know about. HARNESS.md row 1 supersedes AGENT-FIRST row 56 and nothing links them;
SPEC rows 8 and 9 describe designs that were abandoned.

Options, in order of preference:

1. Keep one table. Move the 20 rows into AGENT-FIRST.md with their dates, renumber, and leave
   a one-line pointer in SPEC.md and HARNESS.md. Amend SPEC 8 and 9 as superseded.
2. Keep three tables but give each a distinct prefix (S1–S10, H1–H10) and a cross-reference
   row in AGENT-FIRST.md for every row that supersedes or depends on one of them.

Either way the memory rule and AGENTS.md should name every table that counts as an ADR.

---

## Suggested order

1. Fix the three doc lines that actively mislead (§3 items 1–4): cancellation, whisper default, harness count, slots.
2. Write the process rules into AGENTS.md (§5); they are six lines.
3. Decide §6, then write the §1 rows, dated 2026-09-24, foundations and runtime first (F1–F7, R1–R7), since later rows lean on them.
4. Amend the rows in §2 that contradict code (1, 2, 24, 32, 35, 36, 47, 56).
5. Add §4 to the Future list.
6. The remaining §3 items in one docs pass.
