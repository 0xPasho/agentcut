# Rules, glossary and preferences

Three files that make the agent edit the way its owner would, without the owner saying
so every time. All three live at two levels: `<workspace>/` applies to every project;
`<workspace>/projects/<id>/` adds to it for one project and wins on a conflict. The
panel (**Video → Rules and preferences** in the editor, for a project and a video), the
**/settings** pages (for the workspace level), the agent tools and the `agentcut rules`
command read and write the same files.

| File | What it is | Who reads it |
| --- | --- | --- |
| `rules/*.json` | A judgement plus an action | Judged by an agent, executed by the host |
| `glossary.json` | How names are spelled | Recogniser, proofreader, a deterministic fix-up, every agent |
| `preferences.md` | How the owner likes their videos, in their words | Every agent prompt |

## Rules

```json
{
  "id": "gameplay-clean",
  "name": "Gameplay stays clean",
  "when": "the clip is gameplay footage",
  "stage": "edit",
  "priority": 10,
  "then": {
    "template": "talking-head",
    "overrides": { "images": { "mode": "off" } },
    "prompt": "Never cover the game with pictures."
  }
}
```

- **`when`** is a sentence. An agent reads it against the material and says whether it
  holds, with a reason. A person reads it in the panel and can tick it by hand.
- **`stage`** says where it applies. `select` rules shape which clips the selection agent
  picks; `edit` rules shape how a video is edited; `both` do both.
- **`then`** is structured and needs no model. `template` names the template to apply;
  `overrides` is the same field-level patch `template.apply` takes; `prompt` (or
  `promptFile`, a markdown file in the same folder) is a standing instruction for the
  agent. Anything that changes the timeline goes through `template.apply`, so a rule is an
  ordinary template application with the rules that chose it in its `by` marker:
  `template:talking-head/rule:gameplay-clean,stream-outro`. Re-applying a template or
  the rules replaces that work and leaves hand edits alone, exactly as before.
- **Conflicts:** lower `priority` runs first. The first matched rule naming a template
  wins; every matched rule's overrides merge in that order; prompts accumulate.
- **`subject`** is optional and names a glossary entry the rule is about.

### When rules run

- **At generation.** The selection agent gets `rules.json`, judges every edit-stage rule
  per clip and writes the matched ids into `clips.json`. After the clips are published
  the host executes them clip by clip, promoting each clip in place; a failure is logged
  and the clip is left as generated.
- **On request.** In the editor, **Which rules hold?** runs `rules.evaluate`, an agent
  judgement that returns matches with reasons and a few tags for the video. Tick or untick,
  then **Apply checked rules** runs `rules.apply`. Both are tools the agent can call too.
- **During ordinary agent edits** the rules are constraints in the prompt, not re-executed:
  running twenty rules on "move the title" would be slow and would overwrite work.

### Tools

| Tool | Behaviour |
| --- | --- |
| `rules.list`, `rules.get`, `rules.schema` | What applies to this project, with each rule's level and resolved prompt text |
| `rules.save`, `rules.delete` | Write at `workspace` (default) or `project` level |
| `rules.evaluate` | Agent judgement: `{ matches: [{ id, reason, rule }], tags, unknown }` |
| `rules.apply` | Execute rule ids on a video: template choice, merged overrides, `expectedRevision` |
| `glossary.get`, `glossary.save` | The merged glossary; save writes one level |
| `preferences.get`, `preferences.set` | Both levels' text; set writes one level |

`rules.apply` needs a template to apply overrides to. It takes the matched rules' choice,
then `templateId` from the request, then the template already on the video, then the
best-scoring suggestion. Rules that only add a prompt change nothing on the timeline and
say so.

## Glossary

```json
{ "terms": [ { "term": "Claude", "aliases": ["clod", "cloud AI"], "note": "Anthropic's model" } ] }
```

Names reach the recogniser as a vocabulary hint (names only, which read the same in any
language; `AGENTCUT_WHISPER_PROMPT` still overrides), the proofreader as a list to spell
exactly, and a final pass that rewrites aliases on word boundaries. A term with capitals
also fixes its own lowercase. Two-word aliases are fixed in segment text only, because
merging two timed words would move the captions. Every agent gets `glossary.json` and is
told to use these spellings in titles, captions and hooks.

## Preferences

Plain markdown. The workspace file goes into every prompt under "The owner's preferences";
a project's file is added under "For this project". It is the owner's own text, so it is
not wrapped as untrusted the way transcripts are.

## Observations

Corrections are noted without asking. When a person changes, removes, moves or re-times
something an agent, rule or template placed, or fixes a caption word, one line goes into
the observation bank (`observations` table, across every project). Only the web editor's
own edits count: an agent's edits are not corrections, and work created from scratch is
not either. Every agent run receives the recent lines as soft context.

**Review my preferences** (Preferences tab) hands the bank to an agent, which proposes
rules, glossary entries and preference lines. Each proposal is saved only when accepted.
Tools: `observations.read`, `observations.review`.

## Why is this here

Every edit carries `by`. Templates write `template:<id>`, a plan adds `/plan`, rules add
`/rule:<ids>`, and an editing agent writes `agent:<messageId>` — the turn of the
conversation that asked for it. Hover an effect on the timeline or open it in the inspector
to read it in words.

## Command line

```
agentcut rules list [projectId]
agentcut rules evaluate PROJECT_ID --sequence SEQ
agentcut rules apply PROJECT_ID gameplay-clean,stream-outro --sequence SEQ
agentcut rules glossary
agentcut rules preferences
```

## Where they live on screen

Everything at workspace level has its own home at **/settings**, reached from the header
on the home page and from the library. Six sections, one subject each:

| Section | What you do there |
| --- | --- |
| Rules | The list for every project: create, edit, reorder, switch one off without deleting it, delete. |
| Glossary | The table of names, their mishearings and one line of what each is. |
| Subjects | The glossary terms you have given a look to: colours, fonts and a logo (decision 48). |
| Preferences | `preferences.md` by hand, with the interview's marked section shown and removable apart from it, the interview's state, and the observation bank with **Review my preferences**. |
| Agents and models | Which harnesses this machine has, the default harness and model, the model per kind of work (decision 50), and the keys for the optional picture providers. |
| Packs | Import by path or URL and export, moved here unchanged. |

Rules at project and sequence level stay in the editor, under **Video → Rules and
preferences**, beside the video they are about. Every control on /settings calls the
same tool an agent calls — `rules.save`, `rules.delete`, `glossary.save`,
`preferences.set`, `onboarding.*`, `agents.select`, `providerkeys.set`, `packs.*` — so
there is no settings-only way to write any of these files.

A provider key is the one thing neither interface can read. `providerkeys.list` answers
whether a key is set and whether the value came from settings or from the environment;
nothing returns the key itself, to the page or to an agent, and nothing puts one in
`process.env`, which every spawned harness inherits.

## Not yet

Adding an asset at the start or end of a video from a rule (an outro, a sting) waits for
video in the library. Project-level tags set by hand, the plan artifact, the observation
bank and packs are the next milestones in [AGENT-FIRST.md](./AGENT-FIRST.md).

Two gaps the settings home did not close. A subject has no assets of its own: a library
image named after it is still found by name, which is how the picture search has always
worked. And the workspace-level tools are still bound to a project id the way every other
editor tool is, so a terminal agent on a machine with no project yet can set a key, run
the interview or choose a model, but not write a workspace rule.
