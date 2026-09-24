# agentcut

**Your coding agent edits the video.** agentcut is a video editor exposed as tools, so
the agent you already use — Claude Code, Codex, Cursor, OpenCode — cuts, captions,
scores and renders a video from your terminal. No graphical interface required.

There is also a browser UI. It is the *same* editor, live: what the agent does appears
on the timeline as it happens, what you drag is what the agent reads next. Use it when
you want to touch something yourself. Skip it entirely and nothing is missing.

## Install

Node.js 22.13 or newer and pnpm 11.9.0. Node is required even if your pnpm ships its
own runtime: the app uses Node's built-in SQLite module.

```sh
npm install --global pnpm@11.9.0   # if you don't have it
pnpm install --frozen-lockfile
```

Nothing else is needed to edit and render. Full details in [docs/SETUP.md](docs/SETUP.md).

## Give it to your agent

Register the MCP server once, with the absolute path to this checkout:

```sh
claude mcp add agentcut -- node /absolute/path/to/scripts/agentcut.mjs mcp
codex mcp add agentcut -- node /absolute/path/to/scripts/agentcut.mjs mcp
```

Cursor and OpenCode take the same command in their own MCP config. No web server has
to be running for any of this.

Then talk to your agent:

> Make a 40-second vertical short out of `~/recordings/stream.mp4` about the pricing
> part. Captions in my usual style, add the outro, and render it.

It gets more than ninety tools — `agentcut_project_edit`, `agentcut_template_apply`,
`agentcut_assets_search`, `agentcut_plan_generate`, `agentcut_project_render` and the
rest — the same operations the UI buttons call, with the same validation and the same
saved state. `agentcut_projects_list` finds a project id.

Long calls report while they run: your agent receives MCP progress notifications, and
`agentcut_project_status` returns the running job plus every activity line since the
cursor it was last given. Poll it and relay what is happening.

## Same editor, live

Start the app when you want to look:

```sh
pnpm dev --hostname 127.0.0.1    # then open http://localhost:3000
```

The browser subscribes to a per-project event stream. An edit your agent applies in the
terminal moves the blocks in front of you within the second — revisions, agent messages,
plan changes, sequence status, job progress. Drag a clip in the browser and your agent's
next read sees it, because there is one project state and one set of operations behind
both. Neither side has a capability the other lacks, and neither silently discards the
other's work; edits are applied against a revision, so a conflict is reported, not lost.

![The local editor with three video sources, a title layer, and the shared timeline](docs/images/editor.png)

*Screenshot of the running app with original illustrated demo media.*

See [EDITOR.md](EDITOR.md) for the tool surface and conflict handling,
[docs/EDITING.md](docs/EDITING.md) for editing by hand.

## What you can ask for

Three ways in, one engine — a link or a long video becomes clips; several raw
recordings become a consistent series; an empty canvas becomes a video built from
whatever you import. All of them produce sequences with an **editable plan**: the hook,
the beats, which template, which rules fired and why. Change a decision, apply it again.

- **Rules** say when to do what — "when the clip is gameplay, use this template and no
  pictures". A **glossary** keeps names spelled right. **preferences.md** says how you
  like your videos in your own words. Files your agent, the UI and the CLI all read.
  See [RULES.md](RULES.md).
- **Templates** are the structure of a finished video: where the hook sits, how captions
  read, how often a picture may interrupt. Parametric, extendable, with brand kit and
  aspect variants. See [TEMPLATES.md](TEMPLATES.md).
- **Packs** bundle templates, rules and assets so they travel. Import from a path or a
  URL. A pack also carries what its videos must be true of, so a look can be verified and
  not only applied. See [PACKS.md](PACKS.md) and [REVIEW.md](REVIEW.md).
- **Corrections are remembered.** Every time you fix something an agent placed, it is
  appended to an observation bank the agent reads as context.

Your agent is told which templates and rules exist before it starts. Direction and
current status: [AGENT-FIRST.md](AGENT-FIRST.md).

## Clipping needs two more tools

Manual editing and rendering need nothing extra. Finding clips inside an existing video
additionally needs `whisper-cli` from whisper.cpp for local transcription, an agent CLI
installed and signed in, and `yt-dlp` only for URL imports:

```sh
brew install whisper.cpp yt-dlp
brew install --cask claude-code && claude    # complete sign-in, then exit
```

The first transcription downloads the Whisper model automatically (~1.6 GB for the
default `large-v3-turbo`, plus a small voice-activity model); later runs reuse them.
`AGENTCUT_WHISPER_MODEL` overrides the choice. Word timings are snapped to the audio,
and segments the recogniser was unsure of are proofread by an agent
(`AGENTCUT_TRANSCRIPT_POLISH=0` skips that).

This is also the one place agentcut launches an agent *itself*, rather than being
driven by yours: a picker chooses which CLI and which model runs clipping, plans and
tagging. See [HARNESS.md](HARNESS.md).

## Headless commands

For scripting, without MCP and without a server. Run from the repository root, or by
absolute path to `scripts/agentcut.mjs` from anywhere:

```sh
node scripts/agentcut.mjs projects create "Travel edit" /path/one.mp4 /path/two.mp4
node scripts/agentcut.mjs projects batch "Tips" --brief "Five tips for TikTok" a.mp4 b.mp4
node scripts/agentcut.mjs projects list

node scripts/agentcut.mjs edit PROJECT_ID read
node scripts/agentcut.mjs edit PROJECT_ID ask "Move the title to the bottom"
node scripts/agentcut.mjs render PROJECT_ID

node scripts/agentcut.mjs templates list
node scripts/agentcut.mjs templates plan PROJECT_ID explainer-broll
node scripts/agentcut.mjs rules evaluate PROJECT_ID
```

Relative media paths resolve from your current folder. Rendering by project id reads
authoritative saved state; rendering an exported EDL JSON file is a separate snapshot
workflow — never use stale JSON to continue a live edit.

## Local data and network use

Projects, imported media and rendered files live in `workspace/` inside this checkout.
There is no agentcut account. The application, project state, transcription and
rendering all run on your machine.

Agent requests send prompts, transcripts and sampled frames to whichever provider your
CLI is signed in to; their limits and billing apply. Online assets, URL imports and
first-run model downloads need network access.

The server exposes local media and file operations and has no built-in authentication.
The commands above bind it to loopback. Reaching it from another device is a separate
deployment problem. See [workspace configuration and backups](docs/SETUP.md#workspace-and-backups).

## Development

```sh
pnpm exec tsc --noEmit
pnpm test
pnpm test:render        # real media rendering, slower
pnpm build && pnpm start --hostname 127.0.0.1
```

- [Setup, configuration, troubleshooting](docs/SETUP.md)
- [Shared editor and agent tools](EDITOR.md)
- [Editing by hand](docs/EDITING.md)
- [Harness and model selection](HARNESS.md)
- [Rules, glossary and preferences](RULES.md) · [Templates](TEMPLATES.md) · [Packs](PACKS.md)
- [What correct looks like: pack-defined review](REVIEW.md)
- [Agent-first direction and status](AGENT-FIRST.md)
- [Sequences, layers, and timeline behavior](SEQUENCES.md)
- [Product requirements](SPEC.md) · [Design conventions](DESIGN.md) · [Contributor/agent instructions](AGENTS.md)

Rendering uses Remotion. Review its [licensing terms](https://www.remotion.dev/license)
for your intended use: it is free for individuals and for companies of up to three
people, and larger companies need a licence. The EDL is renderer-agnostic, so the
renderer stays swappable. Dependency licenses are independent of this application's code.
