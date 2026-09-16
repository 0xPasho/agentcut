# agentcut — spec

> Short clips, cut by your coding agent. Local-first, no API keys.

Open-source, local-first clip generator. Long video in, vertical short clips out.
The differentiator: a **coding agent** (Claude Code / Codex) is the brain, not a hardcoded pipeline.

## Decided

| # | Decision | Why | Rejected |
|---|---|---|---|
| 1 | **Local-first single-user tool.** `pnpm dev`, your machine. | Agent CLIs need a real filesystem + your logged-in session. Uses the subscription you already pay for: zero API keys. | Multi-user server — 3x work, needs API keys, can't reach your Claude session. Left as a later adapter. |
| 2 | **Agent is the author, renderer is the runtime.** Agent emits an **EDL** (edit decision list); renderer replays it deterministically. | Keeps the agent where it's strong (tool-using, multimodal, steerable) while re-renders stay instant, reproducible, diffable and testable. | Agent as runtime — re-render means re-reason; can't regression-test or explain a bad clip. |
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
