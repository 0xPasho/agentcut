# Harness and model selection

One control picks *which agent CLI* runs and *which model* it runs with, and that
control is the same object everywhere a prompt is typed. This document is the
decided spec: the decisions, why the rejected options were rejected, and what
shipped.

Reference implementation read before writing this: Deska's
`deska-desktop/src/agent/main/provider-sessions/` (drivers, discovery, auth
probes, binary resolution) and `renderer/panels/agent-threads/` (the model menu,
its row builders, the composer chip). We port the *logic*, not the architecture —
Deska is Electron with a main process, a long-lived IPC cache and a multi-account
instance model. None of those exist here.

## Decisions

| # | Decision | Why | Rejected |
|---|---|---|---|
| H1 | **All four harnesses ship working.** | The estimate was wrong, and checking the CLIs beat reasoning about them. Deska drives Cursor over ACP and OpenCode over its HTTP server because it needs resumable sessions per thread; a one-shot run needs neither. `cursor-agent -p --output-format stream-json` emits the same envelope as Claude Code's, and `opencode run --format json` is the same engine with no port allocation or teardown. Each driver came to ~90 lines instead of the ~1200 Deska spends. | Shipping two and disabling two. The disabled-with-a-reason rail is still built and still used — for a harness that is missing or signed out. |
| H2 | Availability = binary on PATH **plus** a credential probe; `unknown` counts as signed **in** | A CLI that is installed but signed out fails ~30s into a run with an opaque error. Deska's `auth-probe.ts` reads only what each CLI persists on login. `unknown` leans positive on purpose: telling someone who is already set up that they are not is how a warning becomes something people click past. | `which` alone — cannot distinguish "not installed" from "signed out". |
| H3 | A **short curated fallback**, with live discovery refreshing it in the background into a disk cache (TTL 24h) plus a manual "Refresh" | Discovery spawns a process per harness and can take seconds, so it cannot sit in front of a popover. Two of the four turned out to be plain subcommands (`cursor-agent models`, `opencode models`) rather than the protocol handshakes Deska uses; `claude -p` → `initialize` and `codex app-server` → `model/list` still need one each. The curated list exists for first paint and for a machine where discovery fails — not as a hand-maintained mirror, which is wrong the week a model ships. | Pure live discovery — seconds of latency on a UI affordance. A long curated catalog — stale by the time anybody reads it. |
| H4 | The selection is a **workspace-level default** with a remembered **per-project override** | The common case is one harness for everything; the exception is one project where you want a bigger model. | Per-prompt only — the user re-picks constantly. Project-only — no sane default for a fresh project. |
| H5 | Headless runs inherit the selection, folded in at **`startJob`** and at the two workspace routes — never inside a runner | Every agent run is either a job or one of two workspace actions, so those are the only places that need it. Folding it inside each runner was tried first and reverted: it made `modules/agent` pull in `common/server/db` and `common/server/config`, both of which resolve the workspace path at module load, so merely importing a driver froze it — and pointed the transcript tests at the real database. The barrel now carries a comment saying so. | Per-runner folding (broke three tests). Picker scoped to the chat only (leaves the batch running something else). |
| H6 | Persisted in the workspace SQLite db (`src/common/server/db.ts`), read server-side | The server is what spawns the CLI, and it needs the default for runs with no UI attached (batch, jobs, MCP). | `localStorage` — invisible to the server, wrong for decision 5. |
| H7 | One instance per harness; id **is** the provider id | Deska's N-instances-per-provider model exists because it is a multi-account IDE. Here it duplicates the data model for zero benefit. | Porting `provider-instances`. |
| H8 | UI is a **chip + popover** with a provider rail on the left, search, and pretty model names. Favourites are starred rows kept in `localStorage` (`agentcut:favourite-models`) and listed across harnesses under one rail entry; ⌥1–9 picks the nth visible row directly (`e.code`, because macOS turns Alt+digit into a character). A row whose harness is missing or signed out is disabled with its reason, never hidden; while a run holds the harness, favourites on another harness are left out of the list rather than offered. Choosing a model also switches the harness — a pick is `(harness, model)`, never a model alone. *(amended 2026-09-24: the original row said "no favourites, no ⌥1–9 in v1"; both shipped 2026-09-21.)* | The rail is what makes "Codex is not installed" legible as distinct from "you cannot change this right now" — both render, both disabled, different reasons. | Two chained `<Select>`s — cannot express the disabled-with-a-reason state, and reads badly with ~15 rows per provider. |
| H9 | The provider is **frozen while a run is live**; the model is free for the next turn | Deska's argv-freeze: the child process already has its flags. Changing the provider mid-run would silently apply to nothing. | Letting both change — the UI would claim a switch that did not happen. |
| H10 | An **explicit** selection that is unavailable is a hard error, never a silent fallback | `resolveProvider()` today walks to the next installed provider. That is right for "no preference"; it is wrong when the user named one — they would get another model's output under the label they chose. | Keeping the fallback everywhere. |

H1 supersedes [AGENT-FIRST.md](./AGENT-FIRST.md) row 56 (OpenCode through MCP only in
phase 1, an adapter later): OpenCode has a host-launched driver, and Cursor is the fourth
harness. This table is one of the three ADR tables named in `AGENTS.md`.

Not a decision, a constraint: harness selection is **not an editing operation**. It
does not go through `src/modules/editor/lib/operations.ts` or `store.ts`, and it does not
enter the EDL. The shared-editor requirement in `AGENTS.md` is about edits.

## What shipped

All four phases. Verified on this machine against the real CLIs: four harnesses
detected with accounts (`claude` 6 models, `codex` 7, `cursor` 223, `opencode`
11 — all live, none curated), the workspace/project scoping round-trips through
the API, and an edit run started from the picker spawned
`codex exec --json --cd <run dir> --sandbox workspace-write` and then
`claude -p … --model haiku` when the selection changed. The repo has 43 test files
under `__tests__/`; `pnpm test` runs 36 of them, `pnpm test:render` the 7 render
suites, and `pnpm exec tsc --noEmit` is the type check. All three must be green before
a commit (`AGENTS.md`, Working in this repo).

## Run lifecycle

A harness is hung when it goes quiet, not when a wall clock runs out. `spawnStream`
(`src/modules/agent/server/spawn.ts`) ends a run after 10 minutes of silence
(`idleMs`, set by every driver); every stdout line resets the clock; the clock stops
while the host is running a tool the agent asked for (`busy()`), because a harness
waiting 21 minutes on `media.transcribe` is waiting, not stuck; a 2 hour ceiling
(`maxMs`) ends a loud loop. Stop, and either limit, is SIGTERM first so the CLI can
write its last words, then SIGKILL after 5 s. Every job carries an `AbortController`
and `spawnStream` defaults to the job's signal, so pressing Stop kills the harness.

Confinement is one shared list. Under `--permission-mode dontAsk` the denial is the whole
fence, so `AGENT_DENIED_TOOLS` in `src/modules/agent/data.ts` names every door — the
network (`WebFetch`, `WebSearch`), delegation (`Task`, `Agent`, `Workflow`,
`SlashCommand`, `Skill`), and the shell under each name it has gone by (`BashOutput`,
`KillShell`, `KillBash`, `Monitor`) — whether or not the installed CLI has the tool yet.
`AGENT_SANDBOX_TOOLS` adds `Bash` itself and is what every run but clip selection uses.
Claude Code takes the list as `--disallowed-tools`; Cursor and OpenCode have no per-tool
flags, so `--sandbox enabled` and `--auto` plus `--dir` carry the weight there.

Secrets: provider keys live in the workspace SQLite settings table and are never put into
`process.env`, which `spawnStream` copies wholesale into every CLI it starts
(`src/common/server/secrets.ts`).

## Shape

### 1 — `src/modules/agent/lib/` and `src/modules/agent/server/` (detection and catalog)

The module is flat: pure code in `lib/`, node code in `server/`, no `providers/` tree.

`lib/` (browser-safe, also what the picker renders from):

- `registry.ts` — static harness metadata (`id`, `label`, `bin`, the env var that
  overrides the binary, and the label for its "inherit the default" row) for
  `claude`, `codex`, `cursor`, `opencode`. Cursor's binary is `cursor-agent`, not
  `cursor`: on a machine with both, spawning `cursor` opens the editor.
- `model-catalog.ts` — the `ModelInfo` shape, the curated fallbacks, and the
  pure merge/order/filter/label functions. Discovery's ORDER wins over the
  curated `recommended` flags: the CLI lists its own models best-first, and
  re-sorting that would bury the model the vendor just shipped.
- `model-rows.ts` — row building for the popover: harness rows, favourite rows across
  harnesses, filtering, the chip label and the short reason a disabled row carries.
- `agent-picker.ts` — reading the favourites out of `localStorage`.
- `agent-log.ts`, `agent-thread.ts`, `thread.ts`, `ask-agent.ts`, `markdown.ts` — the
  chat's own pure code, not the picker's.

`server/`:

- `binary.ts` — port of Deska `drivers/binary-path.ts`: resolve a bare name to an
  absolute path against the real PATH, once, and spawn *that*. `which()` in
  `src/common/server/bin.ts` shells out to `/usr/bin/which`, which does not see a login
  shell's PATH; an nvm-installed `codex` is invisible to it.
- `auth.ts` — trimmed port of `drivers/auth-probe.ts`: filesystem-only credential
  presence per CLI, returning `authenticated | unauthenticated | unknown`.
- `model-discover.ts` — per-provider transports, bounded timeout, child always
  killed. Parsers are exported apart from their transports so the payload shapes
  are tested without a CLI on the machine.
- `model-cache.ts` — JSON in the workspace dir, TTL, single-flight.
- `claude.ts`, `codex.ts`, `cursor.ts`, `opencode.ts` — the four drivers, one file
  each. Confinement differs per CLI and the file comments say how: Cursor has no
  per-tool flags, so `allowedTools`/`deniedTools` cannot be honoured and
  `--sandbox enabled` carries the weight; OpenCode keeps its permission rules in
  config, so `--auto` plus `--dir` is the boundary.
- `spawn.ts` — `spawnStream`: the one place a CLI is started, with the idle clock, the
  ceiling, the abort signal and the SIGTERM/SIGKILL stop (see Run lifecycle).
- `detect.ts` — folds registry + binary + auth + catalog into one `HarnessStatus`
  per harness, including the `ready` flag and the sentence explaining a disabled
  row. It owns the `unknown`-counts-as-signed-in policy so no caller re-derives it.
- `selection.ts` — read/write the workspace default and per-project override;
  `resolveSelection(projectId?)` returns the effective `{ provider, model }` and
  `effectiveSelection` folds an explicit argument over it.
- `providers.ts` — `resolveProvider()` with the H10 behaviour: named-and-missing throws
  with an actionable message; unnamed keeps the walk to the next installed harness.
- `editor-agent.ts`, `conversation.ts`, `mcp.ts` — the editing agent's run, the
  project conversation and the MCP server; they consume the selection, they do not
  own it.

`hooks/agent-store.ts` is the module-level store the picker reads.

### 2 — `src/app/api/agents/route.ts`

- `GET ?projectId=` → `{ harnesses, selection, override, workspaceDefault }`. The
  effective selection and the scope's own override are separate fields: a UI that
  shows an inherited value as the project's own has people "clearing" something
  they never set.
- `POST` → `select` (workspace or project scope), `refresh` (installed harnesses
  only — probing a missing CLI spends the whole timeout to learn what
  `resolveBinary` already answered).

### 3 — `src/modules/agent/components/agent-picker.tsx` and `prompt-composer.tsx`

`<AgentPicker>` is the chip + popover: rail, search, model rows, an "inherit the
CLI default" row at the top, disabled rows carrying their reason. It reads
`src/modules/agent/hooks/agent-store.ts` — a module-level store rather than a context provider, so
dropping the component anywhere is the whole integration and five composers on a
page cost one request. `src/common/ui/popover.tsx` was added alongside it,
matching the base-ui/glass pattern the existing `select.tsx` uses.

`<PromptComposer>` is the reusable prompt surface: textarea, ⌘↩, a slot for quick
actions, the picker chip, the send button. It has one mount: the composer at the bottom
of `chat.tsx`, the single `Chat` component every conversation surface renders.

### 4 — Plumbing

`agentEdit` in `src/common/api/client.ts` still sends no `provider`/`model`: the body is
`instruction`, `expectedRevision`, `sequenceId` and `context`. That is fine rather than a
gap, because `startJob` (`src/modules/project/server/jobs.ts`) folds `effectiveSelection`
over whatever the request carried (H5), so a chat turn runs on the stored selection the
chip shows. The two workspace routes (`onboarding.run`, `observations.review`) fold it
the same way in `src/app/api/workspace/route.ts`.

## Where the picker is mounted

`<PromptComposer>` carries it for chat-shaped surfaces; `<AgentPicker>` goes in
bare where the surrounding form has its own shape.

- `chat.tsx` — on `PromptComposer`. `Chat` is mounted by `start-chat-view.tsx` (the
  `/chat` home, no project yet, so the pick sets the workspace default) and by
  `agent-editor.tsx`, which `project-view.tsx` and `clip-editor-view.tsx` render for a
  project's conversation, scoped to the project.
- `project-view.tsx` — bare, in the clipping form above the analyze button, scoped to
  the project and locked while the analysis runs.

`new-project.tsx` no longer carries one: the home is two tabs, "Create a video" and
"Clip a long video", and "Start the set" and "Analyze with agent" are gone. The set runs
on the workspace default until a project exists to override it.

Not mounted, and deliberately: `onboarding-chat.tsx` is a question being
answered rather than a prompt being run, and `rules-panel.tsx` writes rule text
that is executed later by whatever runs then. Adding a harness chip to either
would be claiming a choice that has nothing to apply to at that moment.

## Still open

- An editor tool letting the agent read or propose the selection. Harness choice
  is not an editing operation, so the shared-editor rule in `AGENTS.md` does not
  require it — this is a convenience, not a parity gap.

## Tests

`src/modules/agent/__tests__/agents.test.ts` — pure functions only, matching the existing `node:test`
style: binary resolution against a fake PATH, auth probe against fixture dirs,
catalog merge (curated + discovered, dedup, recommended-first ordering), row
building and filtering, and selection resolution (project override beats
workspace default; named-and-missing throws). `picker.test.ts` covers the row model
and favourites; `spawn.test.ts` covers the idle clock, the ceiling and the stop signal.
