# What correct looks like

A template holds the mechanics of a video — where the hook sits, how the captions read,
what is cut. [STYLE.md](./PACKS.md#style-guide-and-references) holds the judgement — who
the videos are for, what a good one is, what the channel never does. Neither can be
checked. A template is what gets applied, not what gets verified, and prose is read by an
agent that has every reason to agree with it.

A pack's third file is what its videos must be true of: `review.json`. It is the part of
an editor's eye that can be written down as a number or as a question with an answer.

This is a design. Nothing here is built yet; see [Status](#status) for what exists today.

## Three tiers, separated by who produces the number

**Measured.** The host computes a value from the project or from the pixels of an export.
The pack only names the metric and sets the limit. This is the whole of the trust model:
a pack cannot lie about a measurement it did not take, and cannot run code to take one.

**Judged.** A question the pack asks and an agent answers *with evidence* — a timestamp, a
frame, a field of the EDL, a line of the transcript. The answer is stored. An item with no
answer fails; the reviewer cannot pass a video by not looking.

**Shown.** The pack's `examples/` are what a judged item compares against. Already in the
manifest, already read as a contact sheet of stills. Nothing new.

## `review.json`

A file in the pack, named from the manifest the way `STYLE.md` is:

```json
"style": "STYLE.md",
"review": "review.json"
```

```json
{
  "schema": 1,
  "checks": [
    { "id": "framing", "metric": "framing.worstDrift", "max": 18, "severity": "critical",
      "fix": "The pane is not the region the layout names — re-apply the template." },
    { "id": "no-tail", "metric": "video.durationSec", "max": 62, "severity": "critical",
      "fix": "Cut after the last sentence; the tag runs long." },
    { "id": "caption-rate", "metric": "captions.wordsPerSec", "max": 4.2, "severity": "suggestion",
      "fix": "Three words a line at this speed is unreadable — lower maxWordsPerLine." },
    { "id": "seam", "metric": "captions.crossesSeam", "is": false, "severity": "critical",
      "tags": ["stream"],
      "fix": "Move the captions to one side of the seam." }
  ],
  "rubric": [
    { "id": "chat-opens", "severity": "critical", "evidence": "timestamp",
      "ask": "Does the clip open on the chat comment being answered?",
      "fix": "Extend the head to the comment, or pick a clip that stands without one." },
    { "id": "hook-voice", "severity": "suggestion", "evidence": "quote",
      "compare": "examples/dos-tipos-de-ingeniero.mp4",
      "ask": "Does the hook sound like the reference — a claim or a question, never a summary?" }
  ]
}
```

### A check

| Field | |
|---|---|
| `id` | Stable, lowercase. It is what a waiver names and what the artifact reports. |
| `metric` | One name from [the catalogue](#the-metric-catalogue). Unknown names are refused at import. |
| `min` / `max` / `is` | The limit. `is` takes a boolean, for the metrics that are one. |
| `severity` | `critical`, `suggestion` or `nitpick`. A field, never inferred from wording. |
| `fix` | One sentence saying what to do. A `critical` without one is refused at import. |
| `tags` | Optional. The check applies only to videos carrying one of these tags. |
| `aspect` | Optional. `9:16`, `1:1`, `16:9`. |

Conditions stop there. "When the clip is gameplay" is a judgement, and judgements are
[rules](./RULES.md) — they already have a `when` an agent reads. A check that needed an
agent to decide whether it applies would be a rule wearing a threshold.

### A rubric item

`ask` is the question. `evidence` is what the answer must carry: `timestamp`, `frame`,
`field` or `quote`. `compare` optionally points at an example in the pack. `fix` is
required at `critical`, the same as a check.

## The metric catalogue

The host owns this list. A pack picks from it; it cannot extend it. Two groups, by when
the number can be read.

### From the project, before anything is rendered

| Metric | What it is | Today |
|---|---|---|
| `video.durationSec` | Resolved length of the sequence. | `sequenceFrames` |
| `video.cutsPerMin` | Main-track shots per minute of output. | `sequenceFrames` |
| `video.longestShotSec` | Longest stretch with no cut. | `sequenceFrames` |
| `captions.wordsPerSec` | Words drawn per second across the body. | `mapWords` / `toLines` |
| `captions.positionY` | Where the band sits, 0–1. | `clip.captions` |
| `captions.crossesSeam` | A two-row line is cut by the split seam. | `templates/server/plan.ts` |
| `captions.overPerson` | The band sits on the camera half, not the screen half. | `templates/server/plan.ts` |
| `hook.present` | There is a hook line at all. | `clip.hook` |
| `hook.words` | Its length in words. | `clip.hook` |
| `images.perMin` | Pictures placed per minute. | `clip.edits` |
| `images.unfilledBeats` | Beats that wanted a picture and got none. | `templates/server/plan.ts` |
| `silence.longestGapSec` | Longest pause left in after the silence cuts. | `clip.edits` + time map |
| `transitions.count` | Joints carrying a transition. | `item.transition` |
| `layers.max` | Highest layer index in use. | EDL |
| `endCard.present` | There is an Outro item. | `sequenceFrames` |
| `camera.declared` | A split layout has its camera rectangle. | `templates/server/plan.ts` |
| `plan.warnings` | How many sentences the planner wants to say. | `templates/server/plan.ts` |

`plan.warnings` is the escape hatch: a pack that wants the planner's own complaints to
block sets `max: 0`, and the artifact carries the sentences.

### From the pixels, after the export

Every one of these is a number `auditStyle` already computes. Today the limit beside it is
written into the code; this moves the limit into the pack and leaves the measuring where
it is.

| Metric | What it is | Hardcoded today |
|---|---|---|
| `framing.worstDrift` | Worst mean-absolute difference, 0–255, between the rendered pane and the source region the layout names, over four moments with no push-in in them. | `< 18` |
| `hook.minOverFootage` | Least the hook band is drawn over the footage under it, across the body. | `> 20` |
| `hook.whiteShare` | Fallback when the band cannot be read against the source: share of the strip that is ink. | `> 0.4` |
| `hook.offCardShare` | Ink in the hook band one second into the end card. | `< 0.2` |
| `captions.litMinusDark` | The band on the longest spoken word, minus the band in a gap. | `> 5`, and lit `> 8` |
| `endCard.diff` | Difference between the last card frame and the card asset itself. | `< 12` |
| `endCard.playedDeltaSec` | How much of the card was cut off. | `< 0.2` |

A metric that cannot be read on a given video — no split, no hook, no card — is not a
failure. It is `skipped`, with the reason, the way `auditStyle` already skips a sequence
that was never rendered.

## Why the pack brings thresholds and nothing else

The alternative is an expression language: `duration > 60 && cuts < 3`. It is refused for
the same reason [packs never ship code](./AGENT-FIRST.md): the moment a pack can express a
condition, it wants to express a measurement, and then it wants a function, and then a
pack is a program you install from a URL.

A closed vocabulary also makes the pack checkable at import. `packs.inspect` resolves every
`metric` name and every `severity`, and a check naming something the host cannot measure is
a warning shown before anything is copied — the same shape as the rule lint in
`rules/server/registry.ts`, which already says when a rule "judges but does not act". A
pack that promises a standard nobody can hold it to is a defect of the pack, and the person
installing it should see that on the preview page, not discover it as a review that quietly
never runs.

## The judged pass

The agent answers each rubric item, in order, into the artifact. An answer is
`{ id, verdict, evidence, note }`, where `verdict` is `holds`, `fails` or `cannot-tell`.

- Evidence is required and must be of the declared kind. "Yes" with nothing beside it is
  recorded as `cannot-tell`.
- `cannot-tell` on a `critical` item is a finding, not a pass. It says the video could not
  be verified, which is a different sentence from "the video is wrong" and should read that
  way in the UI.
- A rubric item the agent never reached is a failure of the review, reported as such.

Two rounds. Fix the criticals, review again, and if any survive the second pass the review
ends `passed with findings` and records them. A gate that can loop forever is a gate that
gets switched off.

## Severity, waivers, and where the levels stack

Preferences already stack user → pack → project → sequence, more local winning
(`AGENT-FIRST.md` #36). Review criteria stack the same way, with one asymmetry: a more
local level may **raise** a severity freely, and lowering one — or waiving a check
outright — writes a reason into the artifact.

```json
"waivers": [{ "id": "no-tail", "reason": "this one is a two-parter; the tag is the bridge" }]
```

Silent suppression is what turns a review into decoration. A waiver with a sentence beside
it is a decision, and it is visible in the same place as the finding it answers.

## The artifact

One per sequence per export, beside `rendered.json`, stale by the same revision rule:

```
workspace/projects/<id>/reviews/<sequenceId>.json
```

```json
{
  "schema": 1, "sequenceId": "seq_…", "pack": "pashoai-shorts", "at": 1758700000000,
  "revision": 412, "verdict": "passed-with-findings",
  "checks": [
    { "id": "framing", "metric": "framing.worstDrift", "value": 11.4, "ok": true },
    { "id": "no-tail", "metric": "video.durationSec", "value": 68.2, "ok": false,
      "severity": "critical", "fix": "Cut after the last sentence; the tag runs long." }
  ],
  "rubric": [
    { "id": "chat-opens", "verdict": "holds", "evidence": "0.4s", "note": "the comment card is up before the first word" }
  ],
  "waivers": [],
  "skipped": [{ "id": "seam", "why": "this video is not a split" }]
}
```

It stays out of the EDL. The EDL is what the video *is*; a review is an observation about
one export of it, and putting it in the project state would make every review a revision
and every revision stale every review.

## Where it runs

Both interfaces, one implementation, as [SPEC.md](./SPEC.md#core-requirement-one-editor-two-interfaces)
requires: a `review.run` tool the panel calls and the agent calls.

- **Before the export**, the project-side checks run and a `critical` blocks the render,
  with the `fix` sentences shown. This is the only new gate; everything else reports.
- **After the export**, the pixel checks run and the judged pass follows them, because
  half the rubric questions are about what the frames show.
- `style.audit` stays what it is and stops deciding: it becomes the instrument the measured
  tier reads, with the numbers coming out and the thresholds coming from the pack.

## Trust

A rubric's `ask` and a check's `fix` are text from a stranger that reaches an agent, so they
are held to the same scan as `STYLE.md` — a size limit, and a refusal of lines that only
make sense as an attack. A pack whose review text fails the scan is refused whole, before
anything is copied, and `packs.inspect` shows every question and every fix sentence in full.
Thresholds are numbers and need none of this.

## What this is not

It is not a score. There is no number at the end that says how good the video is, because
nobody would agree on the weights and everybody would tune them until they passed.

It is not a gate on the person. A human export never blocks on a `suggestion`, and the one
blocking case — a `critical` before render — is a pack the person chose to install saying
something they can waive in a sentence.

And it is not the agent grading its own taste. Every judged answer carries a place to look.

## Status

Designed 2026-09-24. Not built. What exists today:

- `render/server/style-check.ts` measures the seven pixel metrics above and decides each
  one against a threshold written into the code.
- `templates/server/plan.ts` produces the planner warnings, which block nothing.
- `rules/server/registry.ts` lints a rule at save time; nothing lints a pack.
- `PackManifest` carries `style` and `examples`, and no `review`.

Decisions behind this: [AGENT-FIRST.md](./AGENT-FIRST.md) #71–#74.
