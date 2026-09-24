# Packs

A pack is what travels between people: templates, rules, glossary entries, assets and
quick actions that belong together. It is a folder — servable from any static host —
with a manifest:

```
streamer-kit/
  pack.json
  templates/stream-look.json
  rules/gaming.json
  rules/gaming.md          # a rule's promptFile, beside it
  assets/a_1234abcd.mp4    # named in pack.json with its kind and the id it had
  STYLE.md                 # the style guide: how videos in this pack are made
  examples/reference.mp4   # reference videos and pictures
  review.json              # what a finished video in this pack must be true of
```

`pack.json`:

```json
{
  "id": "streamer-kit", "name": "Streamer kit", "version": "1.0.0", "author": "pasho",
  "description": "Gameplay clips with a sting at the end.",
  "templates": ["stream-look"],
  "rules": ["gaming"],
  "glossary": [{ "term": "Deska", "aliases": ["desk app"], "note": "the app" }],
  "assets": [{ "file": "assets/a_1234abcd.mp4", "kind": "video", "name": "sting.mp4", "id": "a_1234abcd" }],
  "quickActions": [{ "label": "Stream recap", "text": "Cut {selection} into a recap." }]
}
```

Nothing in a pack is code. Templates are the same documents as in `workspace/templates/`
(a sparse `extends` document travels sparse); rules are the same as in `workspace/rules/`.

## Style guide and references

A template holds the mechanics of a video — where the hook sits, how the captions read,
what is cut. It cannot hold the judgement: who the videos are for, what a good clip is,
how the hooks sound, what the channel never does. That is `STYLE.md`, a page of prose
the pack carries, with `examples/` beside it: reference videos and pictures, each with a
note on what to take from it.

```json
"style": "STYLE.md",
"examples": [{ "file": "examples/git-worktrees.mp4", "kind": "video", "title": "Git worktrees",
               "note": "The hook is the topic in two words, only at the start." }]
```

- **Who reads it.** The clip-selection agent, which is where the judgement matters most,
  and the editing agent. Both get it before the owner's preferences, and are told the
  preferences win where the two disagree. An agent cannot watch a video, so a video
  reference is read as a sheet of eight stills taken across it (`contactSheet`), stamped
  with their times, beside the note.
- **Which guide a video uses.** The project's own choice (**Video → Rules and
  preferences → Preferences**, or `style.choose`); else the pack that owns the template
  the video is made in; else the only installed pack with a guide. Two packs with guides
  and nothing to choose between them is none, and `style.active` says so: two voices in
  one prompt contradict each other.
- **Why it is not called SOUL.md.** OpenClaw and Hermes give the *agent* a soul — who the
  assistant on your computer is. Here the agent stays the same and the channel changes;
  what changes is the style guide it edits to.
- **Trust.** The guide is the one thing in a pack that speaks to the agent directly, so
  it is held to 4000 characters and scanned for lines that only make sense as an attack —
  "ignore previous instructions", a credential, a command to run, "delete the project".
  A pack whose guide fails the scan is refused whole, before anything is copied, and the
  import preview shows the guide in full. Saving one by hand is scanned the same way.
- **Editing.** **Settings → Packs → Style guide and references**, or `packs.style.get`,
  `packs.style.set`, `packs.examples.add`, `packs.examples.update`,
  `packs.examples.remove`. An installed pack keeps them in `workspace/packs/<id>/`;
  `packs.export` with `stylePack` writes them into the exported folder.

## What correct looks like

A template is what gets applied; it is not what gets verified. `STYLE.md` says what a good
video is in prose, which an agent reads and has every reason to agree with. `review.json`
is the third file: the part of that judgement that can be written as a number with a limit,
or as a question with an answer that has to point somewhere.

```json
"review": "review.json",
```

```json
{
  "schema": 1,
  "checks": [
    { "id": "no-tail", "metric": "video.durationSec", "max": 62, "severity": "critical",
      "fix": "Cut after the last sentence; the tag runs long." }
  ],
  "rubric": [
    { "id": "chat-opens", "severity": "critical", "evidence": "timestamp",
      "ask": "Does the clip open on the chat comment being answered?",
      "fix": "Extend the head to the comment, or pick a clip that stands without one." }
  ]
}
```

- **The pack brings thresholds, not measurements.** `metric` names one entry in a catalogue
  the host owns — length, cuts per minute, caption rate, whether the captions cross the
  seam, and the seven things `style.audit` reads back out of an export's pixels. A pack
  cannot lie about a number it did not take, and cannot ship code to take one.
- **What cannot be measured is asked.** A rubric item is answered with a timestamp, a
  frame, an EDL field or a quote; an answer with nothing beside it counts as
  "cannot tell", and on a critical item that is a finding rather than a pass.
- **The examples are the evidence.** A rubric item can name one, and the contact sheet the
  agent already reads is what it compares against.
- **A pack is linted at import.** A metric the host cannot measure, or a critical check
  with no `fix` sentence, is shown on the inspect page before anything is copied — the same
  shape as the rule lint that says when a rule judges but does not act.
- **Trust.** `ask` and `fix` are text from a stranger that reaches the agent, so they are
  scanned like `STYLE.md` and a pack that fails is refused whole. Thresholds are numbers.

- **Where it is read.** **Video → What correct looks like** in the editor, or `review.run`,
  `review.criteria` and `review.waive` from an agent. A critical finding the project
  already fails refuses an export until it is fixed or waived with a reason.
- **Editing.** **Settings → Packs → What correct looks like**, or `packs.review.get` /
  `packs.review.set`. `packs.export` carries the file out again.

The metric catalogue, the artifact and the reasoning: [REVIEW.md](./REVIEW.md).

## Import

**Settings → Packs → Read it** takes a folder path or a URL to `pack.json` and shows
everything the pack carries before anything is installed: template names, every rule
with its full text, quick actions, assets, glossary. A template that builds on one this
machine does not have — and that the pack does not bring either — is called out there,
because installing it would be refused and the reason would arrive as a failure rather
than as a warning. A pack from anyone else is untrusted
text an agent will follow, which is why the rules are shown in full and marked.

**Install** copies it in: assets into the library (source `pack:<id>`, ids remapped so
templates and rules that name them keep working), templates and rules into the
workspace, glossary terms merged, quick actions recorded. Existing user templates and
rules with the same id are kept unless **Install and replace mine**. The workspace
remembers the origin (`workspace/packs/<id>.json`: source, version, hash, what came in).
Nothing stays linked: offline rendering keeps working and updates are a re-import.

Removing a pack removes its templates and rules. Assets stay, because projects may use them.

## What installing one is worth

The whole path was run from nothing on a machine that had never seen the pack: an empty
workspace, the pack read from a folder, a recording ingested and transcribed, clips chosen
by the selection agent, the owner's rule judged to hold on each of them, executed the way
a batch executes them, rendered, and read back out of the pixels. Three shorts, eighteen
checks, none failed — each framed as the pack's template says, each holding the pack's
hook across its body, each ending on the pack's own card at the loudness of the video in
front of it. Nothing about the look was typed on that machine.

Then again, from nothing, on a different recording: three more shorts, eighteen more
checks, none failed. The agent judged the pack's rule to hold on every clip both times,
which is what a rule written as a sentence is for.

And a third time, on seven minutes of a second stream nothing in this workspace had seen:
three shorts, twenty-one checks, none failed — the caption-margin check among them. The
agent judged the rule to hold on all three again.

## Export

**Export** writes `workspace/exports/packs/<id>/` from what is in this workspace: chosen
templates and rules, the glossary, chosen assets, quick actions. Serve that folder or send
it as is. Publishing to a registry comes when a registry exists.

There is no catalogue to browse. Import is a path or a URL you type, export writes a
folder, and nothing in the app goes looking for packs on the network — no index, no
search, no remote discovery. A marketplace is still an open question in
[AGENT-FIRST.md](./AGENT-FIRST.md), not a thing that exists.

## Tools

`packs.list`, `packs.inspect`, `packs.import`, `packs.remove`, `packs.export`,
`quickactions.list` — the same functions behind the panel, the agent and MCP.
