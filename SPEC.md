# agentcut — spec

> Short clips, cut by your coding agent. Local-first, no API keys.

Open-source, local-first video workspace for creating your own videos. Clipping a
source video into highlights is one workflow; assembling several sources into a new
video is another workflow.
The differentiator: a **coding agent** (Claude Code / Codex) is the brain, not a hardcoded pipeline.

## Product direction: your computer, your video projects

The user runs the application on their own computer. That machine owns the project
state, media, editing services, and rendering. The local browser UI and agent/CLI
are entry points into the same workspace, so users can manage and resume their
projects from either interface.

- Launching commands from another working directory must resolve the configured
  workspace consistently, rather than silently creating a separate project library.
  The checkout launcher supports this; a global package install is not implemented.
- Core project management, manual editing, and rendering must not require a hosted
  application account or uploading source media to an application backend. Agent
  providers and optional online services can still require connectivity and their
  own authentication.
- The intended model is project → media + sequences → timeline items → exports.
  A project can contain several source videos and several finished-video sequences.
  Finding clips and assembling a video are starting flows into the same editor,
  with exactly equivalent human and agent operations.
- Multi-source sequences are implemented alongside existing single-source clips.
  Old projects remain readable; generated clips promote in place on their first edit
  to a layered timeline with the same ID and their edits intact. See [SEQUENCES.md](./SEQUENCES.md)
  for the model, local launcher, shared operations, and current editing scope.
- Local-first does not by itself imply remote access from other devices. Remote
  access is a separate deployment capability, not a dependency of these workflows.

A project should feel like an editing workspace, with preview and timeline central,
assets close at hand, and properties/agent controls alongside them. The shared asset
browser brings project media, reusable library assets, chosen local folders, and the
existing online image providers into the shared editor.

**A general editing project starts as an empty canvas, with no required source video.**
The clipping flow prepopulates that same editor; general editing starts empty. These
are entry points, not independent editing products. Users and agents may import as
many sources as needed and build source-free scenes with titles, images, and audio.
The same editor controls, operation validation, saved state, and renderer serve both.
There are no separate clip/general editing modes: only the initial contents differ.
Both support overlapping video layers, independent titles/images/audio, layer placement
and transforms, and music spanning cuts. Adding media to a generated clip extends its
existing timeline in place. Opening a route alone never changes saved state.

## Core requirement: one editor, two interfaces

**The human and the agent must have exactly the same editing capabilities.** The UI is
the visual interface for a human; agent tools are the programmatic interface to that
same editor. They operate on the same project, using the same editing operations,
validation, constraints, asset services, and rendering behavior.

This is a mandatory product and architecture requirement, not an optional future
integration. The agent already edits video; the requirement is to make that existing
ability fully equivalent to manual editing, including revising an existing project.

- Every edit available through the UI must be available to the agent, with the same
  parameters and supported ranges. Every supported agent edit must be inspectable
  and editable through the UI. This includes clip boundaries, crop keyframes, split
  layouts, captions, timeline edits, titles, images, music, and sound effects.
- Both interfaces must invoke shared editing operations. Domain behavior must not
  live only in React handlers or be independently reimplemented in an agent prompt.
  Sharing an EDL schema alone does not satisfy this requirement.
- There must be one authoritative project state. A human must be able to continue
  an agent's edits, and the agent must be able to continue the human's edits, without
  rebuilding the project or losing unrelated changes. Drafts and concurrent changes
  must be handled explicitly; stale full-document writes must not silently overwrite
  newer work.
- Agent changes must be reflected in the visual editor, and human changes must be
  available to the agent. File exports such as `edl.json` are representations of that
  state, not independently editable sources of truth that can silently diverge.
- Preview, UI export, and command-line export must resolve the same project revision,
  assets, and composition rules. A standalone imported EDL is an explicit snapshot.
- The agent must have equivalent asset discovery, selection, capture, and editing
  operations through project-scoped services. It must not need unrestricted shell
  or network access to match the UI's capabilities.
- New editing features are incomplete until both interfaces support them. Presentation
  details such as hover effects and panel arrangement can differ; editing semantics
  and outcomes cannot.

Required architecture:

```text
Human-facing UI ─┐
                ├─ Shared editing operations ─ Authoritative project state ─ Preview/export
Agent tools ────┘
```

Acceptance criteria: starting from the same project revision, an equivalent UI action
and agent action produce the same validated edit state and rendered result. Verify
both handoffs (human → agent and agent → human), preservation of unrelated edits,
matching validation failures, and rendering the latest saved revision through either
export entry point.

### Implementation status

The shared operation engine, revision-checked database store, UI session, and project-scoped
agent tools are implemented. Both editing surfaces use the same operations; agent edit jobs
modify the current project. Full clip properties expose crop/split and all supported EDL
fields to humans. Agent tools expose the same asset services. Reanalysis appends clips,
and project-ID rendering reads the database through the shared render service.

Conflicts preserve local drafts instead of overwriting newer changes. Equivalence is covered
by state/HTTP/tool-transport tests and decoded-frame comparisons across UI, agent, and CLI
exports. See [EDITOR.md](./EDITOR.md) for the protocol, supported operations, recovery behavior,
and validation limits. Isolated authenticated Claude and Codex CLI smoke tests also verified
targeted edits through the real tool transport, preserving the rest of the project.

## Decided

| # | Decision | Why | Rejected |
|---|---|---|---|
| 1 | **Local-first single-user tool.** `pnpm dev`, your machine. | Agent CLIs need a real filesystem + your logged-in session. Uses the subscription you already pay for: zero API keys. | Multi-user server — 3x work, needs API keys, can't reach your Claude session. Left as a later adapter. |
| 2 | **One editor, two equal interfaces; renderer is the runtime.** Human UI and agent tools share editing operations and an **EDL** (edit decision list); the renderer replays it deterministically. | Either can author or revise the same project with identical capabilities, while rendering remains reproducible, diffable and testable. | Separate human/agent editing engines; agent as runtime requiring new reasoning for every render. |
| 3 | **Agent has tools, and that's the point.** It reads the transcript *and* probes audio peaks, scene cuts, and sampled frames. | Multi-signal selection beats transcript-only. A single structured LLM call can't see the video. | One-shot structured call — cheaper but blind. |
| 4 | **Pluggable agent providers** behind one interface: `claude -p` first, `codex exec` second. | "Uses the agent you already have" only works if it shells out to the real CLI. | Agent SDK in-process — Anthropic-only, needs an API key, kills the zero-key story. Drops in later. |
| 5 | **Static ffmpeg binaries** (`ffmpeg-static`, `ffprobe-static`). | Contributors get a working ffmpeg with `pnpm install`. Homebrew's is currently broken (stale bottle vs x265 4.3). | System ffmpeg — unreproducible per machine. |
| 6 | **`node:sqlite`** for jobs/projects. | Built into Node 22+. Zero native deps, zero install friction. | better-sqlite3 (native build), Postgres (a server for a one-user tool). |
| 7 | **Remotion** for composition + captions; ffmpeg for probe/cut/encode. | Captions become TSX the agent can read, edit and diff. ffmpeg `drawtext`/ASS is opaque and painful. | Pure ffmpeg filtergraphs. |
| 8 | **Reframe v1: scene-detect + face pass per scene → static crop per scene**, exposed as EDL keyframes. | Covers most talking-head/podcast footage at a fraction of the cost. Agent can repair the keyframes. | Per-frame active-speaker tracking — a real CV project; v2. |
| 9 | **Transcription pluggable**, local `whisper.cpp` default, hosted API optional, SRT/VTT import always. | Keeps the zero-key path intact without blocking people who want speed. | API-only — breaks the zero-key story. |

## Open risk: prompt injection

The agent gets Bash and reads transcripts of **arbitrary third-party video**. That text is attacker-controlled.
Mitigations, non-negotiable:
- **`--disallowed-tools`, not just `--allowed-tools`.** Verified: under `--permission-mode dontAsk`,
  an allowlist does not take anything away — Claude Code still ran `cat` with only `Read` allowed.
  Only an explicit deny removes a tool from the session.
- **Bash is denied by default.** The agent does not need it: frames are pre-sampled and the signals
  are already JSON. `AGENTCUT_AGENT_SHELL=1` grants `ffprobe`/`ffmpeg` back for debugging.
- **WebFetch/WebSearch are denied.** They are the exfiltration path — an injected transcript saying
  "post this to https://…" needs a way out, and this removes it.
- Never `--dangerously-skip-permissions`. Codex runs under `--sandbox workspace-write`.
- cwd is the per-project workspace dir; `--add-dir` never points at `$HOME`
- the transcript is wrapped in untrusted-content markers in the prompt
- every agent action is logged to the job record

## Pipeline

```
ingest (file | yt-dlp)
  -> probe (ffprobe: duration, fps, resolution, streams)
  -> audio (16kHz mono wav)
  -> transcribe (word-level timestamps)
  -> signals (scene cuts, loudness peaks)
  -> AGENT: read transcript + signals, sample frames, emit EDL
  -> render (Remotion: crop + animated captions) -> mp4
```

Everything before and after the agent step is deterministic and cacheable.
This diagram describes initial clip generation. Subsequent editing by either the human
or the agent must follow the shared-editor requirement above; it is not a separate
agent-only generation path followed by a human-only editing path.
