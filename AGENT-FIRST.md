# Agent-first editing, rules and shared packs

Decided 2026-09-17. This is the direction; the editor stays for fine adjustment, but the
video is *built* by the agent from a brief, a set of rules and a plan the human can read,
correct and approve. See [SPEC.md](./SPEC.md) for the shared-editor requirement, which
still governs everything here: every rule action runs through the same operations the UI
uses, and everything the agent decides is inspectable and editable in the UI.

## Decided

| # | Decision | Why | Rejected |
|---|---|---|---|
| 1 | **The plan is an editable artifact, not a log.** The agent writes `plan.json` per video: which template, which rules fired and why, which assets, which beats. The UI renders it, the human can change a choice ("use the other template") and regenerate. | Agent-first means the human reviews *decisions*, not keyframes. A timeline alone hides why anything is there. | Plan as read-only explanation with edits only on the timeline. |
| 2 | **Rules = semantic condition + structured action.** `when` is free text the agent judges ("this clip is gameplay"); `then` is structured: apply template (with overrides), add asset at start/end, forbid/force overlay sources, extra prompt text. Every edit a rule makes carries `by: "rule:<id>"`, so re-applying is idempotent like templates. | A rule that is entirely a prompt cannot be shown, tested or edited in the UI, which breaks parity. A rule that is entirely structured cannot express "is about the stream". | Free-text-only rules; tag-matching-only rules. |
| 3 | **Rules execute at generation and on "re-apply".** On ordinary agent messages they are constraints in the prompt, not re-executed. | Re-running twenty rules on "move the title" is slow and overwrites work. | Executing on every message. |
| 4 | **Classification is two-layered.** Project/source tags set by the human are ground truth; the agent adds per-clip tags in `clips.json` from transcript + frames. Both visible and editable in the UI. | Rules need a subject to match. Agent-only tags are wrong sometimes; human-only tags never exist per clip. | Either alone. |
| 5 | **Conflicts:** numeric priority; first match wins for template choice; additive actions (outro, prohibitions) accumulate. UI shows which rule fired and why. | Predictable, explainable. | LLM arbitration. |
| 6 | **The shareable unit is a pack**: folder or zip with `pack.json` + `templates/` + `rules/` + `assets/`. Importable from a local path or any URL. | A rule like "gameplay → outro X" is useless without X. Templates and rules alone do not travel. Any static host serves a pack, so the registry server can be decided later without rework. | Sharing templates and rules as loose files; deciding the server first. |
| 7 | **Imported packs are copied into the workspace** with their origin (URL, version, hash) recorded. Updates are manual. | Offline render keeps working; content-hashed assets dedupe. | Live-linked packs that update themselves. |
| 8 | **Publishing packs: export only, for now.** Export a pack from the workspace; uploading to a registry comes when the registry exists. | No server yet. | Building publish before there is anything to publish to. |
| 9 | **Rules from other people are untrusted content.** Show them before install; wrap their text in untrusted markers in the agent prompt, same as transcripts. | A pack is a prompt-injection vector into an agent that edits your files. | Trusting installed packs. |
| 10 | **Conversation per project with history**, stored in SQLite, in phase 1. Each agent run gets the last N messages plus the current project and plan. Also available from the CLI. | Brief → plan → correct → regenerate is a conversation. One-shot instructions cannot carry it. | Keeping the single-instruction editor agent. |
| 11 | **Library accepts video** (intros, outros, stingers, b-roll) as a first-class asset kind. | "Add this at the end" is almost always a video. Today video only enters per project through `media.import`. | Keeping the library image/audio only. |
| 12 | **"Remote asset bank" v1 is a mounted or synced folder**; v2 is an HTTP provider reading a pack or manifest. | Folder browsing already exists; nothing to build for v1. | A bespoke asset server before the registry exists. |
| 13 | **The editor is context for the agent.** Every message carries the current selection, playhead and visible range. "Improve this" targets what is selected. | This is what separates an agentic editor from a chat beside a timeline. | Context-free instructions. |
| 14 | **Two entry points in the editor:** a side panel with conversation + plan, and a context menu on any item or time range ("ask the agent"). | Judgement calls start from the thing you are looking at. | Panel only. |
| 15 | **Agent edits apply directly**, highlighted on the timeline, undoable through history. | Same path as `template.apply`; no second mutation path. Proposal/diff mode later for large changes. | Accept/reject diff first. |
| 16 | **Rules can be created from the editor.** "Always do this" on a change or message makes the agent draft a rule; the human sees and saves it. The agent may suggest saving one when a request repeats. | Rules should come from real edits, not from writing JSON. | Rules only authored in the rules panel. |
| 17 | **The editor agent sees the video:** sampled frames, loudness peaks, scene cuts and the sequence transcript, like the clipping agent. | It cannot judge framing or b-roll blind. | Transcript-only editor agent. |
| 18 | **"Why is this here"**: hovering an item shows the rule, template or message that placed it, from the `by` marker. | Cheap, and it is how the human audits the agent. | — |
| 19 | **Deterministic work stays deterministic.** Silence removal, resync and template apply are operations that both buttons and the agent call. The agent is for judgement: what to improve, where, with which asset. | Every LLM round trip is seconds and money; routing a button through it is waste. | "Everything through the agent." |
| 20 | **Quick actions** ("suggest b-roll", "improve the hook", "reframe") are fixed in code in v1, and become saved prompts shipped in packs in phase 2. | Shareable behaviour belongs in packs, but the pack format lands in phase 2. | Hardcoded forever; packs first. |
| 21 | **The plan has two levels.** Project plan: shared decisions (template, rules, caption style, brand, brief). Sequence plan: local decisions (hook, cuts, pictures, beats) with overrides. Changing the project plan regenerates every sequence. | Eight raw videos must look like one series. Per-sequence plans cannot express that. | Per-sequence only. |
| 22 | **The sequence plan is a beat sheet**, not a decision list: hook, points, payoff, outro, each bound to a timeline range with intent and reason. | This is what "start from agent logic" means on screen. | Flat list of decisions. |
| 23 | **Three entry points, one engine:** a link or long video → find clips; N raw videos → edit each with consistency; empty canvas → build from sources. All produce sequences with plans. | The product is an editing logic, not a clipper. | Treating clipping as the product. |
| 24 | **A batch is one project, N sequences, one conversation.** Sequences carry a status: pending, edited, approved, rendered. Only approved ones render. | The clip list already exists; it becomes the sequence list. | One project per video. |
| 25 | **Batch runs are one short run for the project plan, then one run per video in parallel** with the project plan as context. | One run with eight transcripts overflows. | Single run for everything. |
| 26 | **Regenerating from the plan touches only items marked by a rule, template or agent.** Manual work survives, as with template re-apply. Never delete manual work without asking. | Data-loss decision, made once. | Full regeneration. |
| 27 | **Rules declare `stage: select | edit | both`.** Selection rules shape which clips come out; edit rules shape how they are edited. | "Never pick clips where I read chat" is not an edit. | Edit-only rules. |
| 28 | **The Templates panel folds into the Plan panel.** The template is a decision of the plan. | One place to read decisions. | Two panels. |
| 29 | **The editor agent sees rendered output frames** at low resolution every 2s, so it judges what the viewer sees, overlays and captions included. Fall back to source frames if it is too slow. | Source frames hide half the decisions. | Source frames only. |
| 30 | **The brief is the first message.** Creating a project = drop media and describe what you want. The project plan stores `brief` (goal, platform, length); rules can read it. | The conversation starts where the project starts. | Separate brief field. |
| 31 | **One agent message = one history entry.** Undo reverts everything that message did. | Predictable undo. | Per-operation undo of agent work. |
| 32 | **`clips.json` stays as the selection output for now;** clips promote as today and the plan attaches to the promoted sequence. Replacing the legacy format is a later migration. | No user value in the migration yet. | Agent writes sequences directly. |
| 33 | **No approval gate before applying.** Generate → apply → correct. The editable plan is the correction. | Already decided to apply directly. | Approve-then-apply. |
| 34 | **An eval set of 5–10 real projects with saved plans**, compared by hand whenever a prompt changes, in addition to fake-provider tests. | Without it every prompt change is faith. | Tests only. |
| 35 | **Library assets get tags at import**, written by the agent (mood, topic, kind) and corrected by the human. The agent receives an index of names and tags, not files. | The agent cannot choose music or b-roll from filenames. | Untagged library. |
| 36 | **Four preference levels:** user (workspace), pack, project, sequence. More local wins. Rules and glossary can live at any level. | "How I write Deska" is not a project decision. | Project-only rules. |
| 37 | **Glossary is separate from rules:** term → correct form, plus one line of what it is. Deterministic: feeds the whisper prompt, polish, captions, and translation when it exists. | A spelling is a table, not a judgement. | Glossary as rules. |
| 38 | **User preferences are a `preferences.md`** in the workspace that enters every prompt, marked as the owner's, not untrusted. | "Short hooks, never emojis" is free text. | Structured preference fields. |
| 39 | **Observation bank, not popups.** Every human correction is appended as one line (what changed, where) without asking. The agent reads the bank as soft context on every run. Consolidating into rules or glossary happens only on request ("review my preferences"), where the agent proposes and the human accepts. | Saving-as-rule prompts are intrusive; pattern detection in code is unmaintainable. One append-only table, judgement left to the agent when asked. | Prompting to save a rule after each edit; heuristic pattern detection. |
| 40 | **No skills, no harness hooks.** A rule's prompt text can be a string or a markdown file; if there are ever dozens, they are listed by name and read on demand. Host events (clips generated, edit applied, before render) are rules with a stage. | Skills only add on-demand loading; harness hooks do not port across Claude Code, Codex and OpenCode. | A skills format; native harness hooks. |
| 41 | **Caption translation is not in phase 1.** The glossary is designed so translation respects it when it arrives. | — | — |
| 42 | **The same tools are exposed as a local MCP server**, next to the file transport. Any harness (Claude Code, Codex, OpenCode) in the user's terminal can drive a project; the web reflects it. | The web is a shell over what agents do. That is only true if agents can act without the web launching them. | Web-launched runs only. |
| 43 | **The web receives push updates (SSE per project):** revisions, agent events, plan changes, sequence status, observations. | Polling cannot make the shell feel live. | Polling. |
| 44 | **Templates are parametric over a built-in component catalogue.** Packs never ship code. The catalogue grows with each real need. | Third-party code breaks offline rendering and security. | Packs with Remotion components. |
| 45 | **Templates gain in phase 1:** brand kit (palette, fonts, logo), caption style presets, intro/outro slots, aspect variants (9:16, 1:1, 16:9). Transitions and SFX on punches in phase 2. | This is where "templates need strength" lands first. | All at once. |
| 46 | **Templates can `extends` another.** A pack varies a base instead of copying it. | Less duplication, shareable variations. | Copy-only. |
| 47 | **Every template has a cached rendered thumbnail.** | People choose by looking. | Names only. |
| 48 | **`subject` is a user-level entity for anything the person talks about often:** a game, a channel, a person, a product. Name, glossary, optional brand kit, assets, rules. Rules can say `when subject is X`. Optional; the agent proposes one from the observation bank when a name repeats, never in onboarding. | Most people do not have products. They do have things they say often and want spelled right. | Subject as "product"; asking for products up front. |
| 49 | **First-run interview understands who is editing**, not what they think their videos should look like: streamer, educator, podcaster, marketer, agency; what they record, for whom, what annoys them about their videos. Writes `preferences.md`. Optional and skippable. | Empty preferences produce generic videos; a product-shaped interview fits one user. | Blank start; asking about products or subjects. |
| 50 | **Model per task**, configured with overrides: strong for clipping and plans, cheap for tags and observations. | Cost. | One model everywhere. |
| 51 | **Batch operation:** 2 runs in parallel, `failed` status with log and retry, resumable runs that survive closing the browser. | Eight videos will not all succeed the first time. | Fire-and-forget. |
| 52 | **Beats reference item ids;** their ranges resolve from the items, so hand edits move the beat with them. | A beat stored in seconds drifts the first time someone trims. | Beats as second ranges. |
| 53 | **The project plan has a `series` section:** order, numbering, dedupe of points across sequences. Per-video runs read it. | Consistency across eight videos is also not saying the same thing twice. | Style-only consistency. |
| 54 | **One derived, editable sequence per aspect** (9:16, 1:1, 16:9), linked to its original. | Parity: what renders must be editable. | One sequence auto-adapted at render. |
| 55 | **An observation is a change to something an agent, rule or template placed, or a text correction in captions.** Work created from scratch is not a correction. | Logging every operation is noise. | Log everything. |
| 56 | **OpenCode drives projects through MCP in phase 1;** a host-launched adapter comes in phase 2. | MCP covers the terminal case without a new adapter. | Adapter first. |
| 57 | **Phase 1 ships as milestones, each usable alone:** M1 rules + glossary + preferences; M2 two-level plan + panel; M3 conversation + MCP + SSE; M4 raw-video batch with status and approval; M5 editor context + frames + observation bank; M6 strong templates + onboarding. | Phase 1 is too big to land at once. | Big-bang phase. |
| 58 | **The interview is its own full-screen route (`/welcome`), not a card on the home page.** First run redirects there once, from `/` only; skipping or finishing lands back home for good, and no other page ever redirects. | Setting up and making a video are two jobs. Sharing one page made both look optional and neither look finished, and a card that disappears cannot be returned to. A route can be left, linked and reopened. | A modal over the home page; a blocking gate before the editor. |
| 59 | **A skip is reversible and is not "done".** State is `pending | skipped | done`: skipping stops the asking and keeps the answers, the Library always carries an entry to the interview, and the home reminder is one dismissible line. Only skipping, finishing or reopening moves the status — an answer saved later never puts it back in the way. | Easy to skip is only safe if it is easy to come back; otherwise everyone skips once and the agent guesses forever. Conflating skip with done made the interview unreachable. | A permanent silent skip; nagging until answered. |
| 60 | **One question per step, exactly one of them required.** The first ("what do you make, and who is it for") gates only the finish button, never the exit: skip is on every step and on Esc. | A full screen showing five boxes is the old card, larger. One required answer is what stops an empty interview from writing nothing, and one is as far as insisting may go. | All five at once; nothing required; all required. |
| 61 | **The interview is an editor tool (`onboarding.status/answer/run/skip`), so all three interfaces share it.** The web asks it full screen, the chat panel asks it a question at a time above the composer, and any terminal agent asks it over MCP. Answers, state and the preferences section are the same for all; the host agent is told it may ask one question after doing the work, and never before. | Same requirement as editing: two interfaces to one thing, not two implementations. It also means an interview started in either place can be finished in the other. | A web-only interview with the agent pointing at it; a second set of agent-side questions. |
| 62 | **What the interview writes lives in a marked section of `preferences.md`**, and its state file is written through a queue and an atomic rename. | Reruns appended a second copy of everything, and concurrent saves from two interfaces tore the state file, which read back as a fresh workspace and lost both the answers and the skip. | Appending on rerun; replacing the whole file and losing hand-written lines. |

## Future, noted so the plan leaves room

- **Registry server** for packs: search, install by id, publish. Pack format and import-by-URL are built so this is an adapter, not a rewrite.
- **Sources that are not footage:** a single image or an idea as the start of a video. The beat-sheet plan does not assume a transcript, so this fits without a rewrite.
- **Caption translation**, respecting the glossary.
- **Publishing videos** (posting to platforms): two shapes were named, driving an iPhone from a Mac without a server, and scheduling through a platform. Not designed yet. The plan artifact should be able to carry a `publish` section later.

## Status

- **M1 (rules + glossary + preferences): implemented 2026-09-17.** See [RULES.md](./RULES.md).
  Tags per clip are written by the selection agent and editable through `clip.patch` /
  `item.patch`; a tag editor in the UI, project-level tags and the rule action "add an
  asset at start/end" are still open.
- **M2 (two-level plan + panel): implemented 2026-09-17.** `edl.plan` and `sequence.plan` live in the
  project state (operations `plan.patch`, `sequence.plan.patch`, undoable); `plan.read`, `plan.generate`
  (agent writes beats, summary, tags, template, rules, reasons), `plan.apply` (deterministic template
  application, overrides stacked project → sequence → rules, author `template:<id>/plan[/rule:…]`,
  `all:true` for the whole project). The Plan panel replaces the Templates panel; template settings fold
  under it. Sequence status pending/edited/approved/rendered is on the plan and shown on project cards.
  Beats store `itemIds` plus an offset in the shot's source seconds; a hand trim moves the shot, not the
  offset (documented limitation).
- **M3 (conversation + MCP + SSE): implemented 2026-09-17.** `messages` table; `sendMessage` records
  the turn, runs the agent with `conversation.json` + `context.json`, records the reply; web panel is a
  thread; CLI `ask` and the brief write to the same thread. `agentcut mcp` serves every editor tool over
  stdio (`src/lib/mcp.ts`, no SDK dependency). The per-project SSE stream already carried revision and
  job status, so the web reflects agent work without new plumbing.
- **M4 (raw-video batch, status, approval): implemented 2026-09-17.** `createVideoProject(…, { layout: "separate" })`
  makes one video per file; `runBatch` (`src/lib/batch.ts`) records the brief, transcribes each media into
  `<project>/transcripts/<mediaId>/` and puts words on its shots, writes the shared plan, then plans and applies
  each video with 2 workers, then closes the set; failures are logged, left pending with `plan.reasons.error`,
  and a re-run only touches pending videos. Rendering without a list covers approved videos once anything is
  approved, and marks them rendered. UI: "Edit a set" entry, per-video status, "Edit pending videos", "Render
  approved". CLI: `agentcut projects batch`. Tools: `project.batch`, `media.transcribe`.
- **M5 (agentic editor: context, frames, authorship, observations): implemented 2026-09-17.** Messages carry
  the open sequence, selection and playhead; "Ask the agent about this" in the clip context menu; every edit an
  agent creates is stamped `agent:<messageId>` (`src/lib/editor/authorship.ts`) and shown as such on the
  timeline and in the inspector ("why is this here"). The editing agent gets `frames/` (source frames at shot
  starts, ≤24), `transcript.txt` with times and `signals.json` per source (cached). The observation bank
  (`src/lib/observations.ts`) records a person's changes to generated work and caption fixes from the HTTP
  editor only; every agent reads it as soft context; "Review my preferences" asks an agent for proposals
  that are saved only on acceptance. Quick actions are four preset messages. Rendered-output frames
  (decision 29) were not done: source frames are the fallback the decision allowed.
- **M6 (templates strength + onboarding): implemented 2026-09-17.** `extends`, `captionLook` (five looks),
  `brand` kit (also on glossary subjects), `intro`/`outro` image bookends on the main track, `variants` per
  aspect, `sequence.derive` for one editable sequence per aspect, schematic SVG previews. Onboarding is a
  five-question card on the home page about who is editing; an agent turns the answers into preferences and
  glossary entries; skippable once. Not done: rendered thumbnails (schematic instead), transitions and SFX
  (phase 2 as decided). **Superseded 2026-09-20** by decisions 58-62: the card became the full-screen
  `/welcome` route, the skip became reversible, and the interview became a shared tool the agent asks
  through too (`src/lib/onboarding.ts`, `src/components/welcome.tsx`, `src/components/onboarding-chat.tsx`,
  `tests/onboarding.test.ts`).
- **Phase 1 complete.**
- **Phase 2 implemented 2026-09-17:** video in the library (`workspace/library/video`, uploads, drop-in,
  `media.import` by asset id with `place`, library videos placed from the browser or by drag); template
  bookends from library video; the rule action "add an asset at start/end" is `then.overrides.intro/outro`;
  packs (`src/lib/packs/`, `PACKS.md`: manifest, import by path or URL with an untrusted preview, export,
  origin recorded, removal); quick actions from packs in the thread; sound on punch-ins
  (`rhythm.punch.sfx`); per-message undo of an agent turn (`conversation.undo`, inverse operations stored
  on the message). Deferred, and why: transitions between shots need renderer work; proposal mode as a
  diff before applying is replaced for now by "apply, then undo the whole turn", which the decision
  allowed as the first step; a separate HTTP asset provider is not needed because a pack served over
  HTTP is one.
- **Three ways in, a contextual editor, and sound: implemented 2026-09-20.** The home screen is three
  tabs — **Edit** (drop videos, one video or one each), **Clips**, **Chat** (the conversation that starts
  a project, now on the home screen rather than only at `/chat`). "Edit a set" is gone as its own entry:
  dropping several files and choosing "one each" is the same project, and the set is edited by asking for
  it. In the editor, the properties column follows the selection and everything about the video as a whole
  (plan, templates, rules, format) moved behind one **Video** menu; the controls people reach for constantly
  — hook, colours, mute, separate audio, split, duplicate, remove — sit on the frame. Sound: `item.detachAudio`
  lifts a shot’s audio onto its own track; every footage-backed clip draws its waveform from peaks computed
  by ffmpeg here and cached; `assets.searchAudio` / `assets.adoptAudio` find free-licence sound the way
  pictures are found, with eight synthesised starter sounds installed locally for offline use; templates
  carry a sound design (`sound.transitions`, `sound.opener`, a `query` on any sound source) with
  `sound.mode: "off"` to refuse all of it. Transitions between shots are stings, not renderer transitions,
  which is what Phase 2 deferred.
- **Phase 3: not started** (registry, caption translation, publishing, non-footage sources).

## Phases

**Phase 1 — plan, rules, conversation, agentic editor**

Milestones, in order: M1 rules + glossary + preferences → M2 plan + panel → M3 conversation + MCP + SSE → M4 batch → M5 editor context + frames + observations → M6 templates + onboarding.

1. `src/lib/rules/`: schema (zod) with `stage`, registry per level (workspace, project, sequence), evaluation (agent judges `when`, host executes `then` through `template.apply` / `project.edit`), marker `by: "rule:<id>"`, re-apply idempotence.
2. Glossary and `preferences.md` at workspace and project level; glossary feeds whisper prompt, polish and captions.
3. Tags: project/source tags by the human, per-clip tags by the agent in `clips.json`, library asset tags at import. All editable in the UI.
4. Plans: project plan (brief, template, rules, caption style, brand) and sequence beat sheet bound to timeline ranges. Tools `plan.read` / `plan.patch` / `plan.regenerate`. Plan panel replaces the Templates panel.
5. Conversation: `messages` table, `agent.message` tool + HTTP + CLI; first message is the brief; run directory gets `conversation.json`, `rules.json`, `plan.json`, `glossary.json`, `preferences.md`, `observations.json`, `library-index.json`.
6. Entry points: link/long video → clips (existing, plus rules and plan); N raw videos → per-video runs under one project plan; empty canvas → build from sources. Sequence status column and approval before render.
7. Editor context: messages carry `{selection, playhead, range}`; context menu "ask the agent"; agent edits marked `by: "agent:<messageId>"`, highlighted, one history entry per message.
8. Editor agent sees media: rendered output frames every 2s at 360p, loudness peaks, scene cuts, sequence transcript.
9. "Why is this here" hover from `by`. Observation bank appended on every human correction; "review my preferences" consolidates into rules and glossary on request.
10. Quick actions v1, fixed: suggest b-roll, improve hook, reframe, clean rhythm. Preset messages with scope, never an LLM call behind a deterministic button.
11. MCP server exposing the editor tools; SSE per project for live updates.
12. Templates: brand kit, caption style presets, intro/outro slots, aspect variants, `extends`, cached thumbnails.
13. Subjects at user level; first-run interview; model per task; batch concurrency, retry and resume.
14. Tests: rule evaluation deterministic given tags; regenerate preserves manual work; parity through tool transport and MCP. Eval set of real projects with saved plans.

**Phase 2 — video in library, packs**
1. `kind: "video"` in library and asset browser; rule action "add asset at start/end" for video, image and audio.
2. Pack format: `pack.json` + `templates/` + `rules/` + `glossary` + `assets/`. `pack.import` (path or URL), `pack.export`, origin recorded, untrusted display before install.
3. HTTP asset/pack provider in `src/lib/search`.
4. Quick actions as saved prompts inside packs.
5. Template transitions and SFX on punches.
6. Proposal mode: large agent changes shown as a diff to accept or reject.

**Phase 3 — registry, translation, publishing, non-footage sources**
Registry adapter for packs; caption translation; publish flows for videos; image-or-idea as a source. Designed when each is needed.
