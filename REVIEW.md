# What correct looks like

A template holds the mechanics of a video — where the hook sits, how the captions read,
what is cut. [STYLE.md](./PACKS.md#style-guide-and-references) holds the judgement — who
the videos are for, what a good one is, what the channel never does. Neither can be
checked. A template is what gets applied, not what gets verified, and prose is read by an
agent that has every reason to agree with it.

A pack's third file is what its videos must be true of: `review.json`. It is the part of
an editor's eye that can be written down as a number or as a question with an answer.

Built 2026-09-24. `review.run` holds a video to it, the editor's **What correct looks like**
panel is the same thing with buttons, and an export is refused when a critical check the
project already fails is not answered for.

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

| Metric | What it is |
|---|---|
| `video.durationSec` | How long the finished video runs. |
| `video.shots` | Shots on the main track. |
| `video.cutsPerMin` | Cuts per minute, silence cuts counted — two cuts that touch are one jump. |
| `video.longestShotSec` | The longest stretch with no cut in it. |
| `captions.on` | The video draws captions at all. |
| `captions.wordsPerSec` | Words drawn per second across the body. |
| `captions.positionY` | Where the band sits, 0 at the top. |
| `captions.crossesSeam` | A two-row line is cut in half by the seam of a split. |
| `captions.overPerson` | The band sits over the camera half rather than the screen half. |
| `hook.present` | There is a hook line to hold. |
| `hook.words` | How many words it is. |
| `images.perMin` | Pictures placed per minute. |
| `silence.longestGapSec` | The longest pause left in after the silence cuts. |
| `transitions.count` | Joints carrying a transition rather than a hard cut. |
| `layers.max` | The highest layer in use. |
| `endCard.present` | The video ends on a card. |
| `layout.isSplit` | The footage is stacked as a split rather than one crop. |

All of it is `review/lib/metrics.ts`, pure and off the EDL, so the gate can run on every
export without waiting for ffmpeg. What the template *planner* would say is deliberately
not in here: running it costs a plan and can reach the network, and its warnings are
already shown where a template is applied.

### From the pixels, after the export

Every one of these is a number `auditStyle` already computes. Today the limit beside it is
written into the code; this moves the limit into the pack and leaves the measuring where
it is.

| Metric | What it is | Built-in limit |
|---|---|---|
| `framing.worstDrift` | Worst mean-absolute difference, 0–255, between the rendered pane and the source region the layout names, over four moments with no push-in in them. | `≤ 18` |
| `hook.minOverFootage` | Least the hook band is drawn over the footage under it, across the body. | `≥ 20` |
| `hook.whiteShare` | Read instead when the band cannot be compared with its source: share of the strip that is ink. | — |
| `hook.goneAfter` | An opening hook is off the screen once its time is up. | `is true` |
| `hook.offCardShare` | Ink in the hook band one second into the end card. | `≤ 0.2` |
| `captions.litMinusDark` | The band on the longest spoken word, minus the band in a gap, both read against the footage. | `≥ 5` |
| `captions.bandLitMinusDark` | The same for a video whose band cannot be compared with its source: the band's own brightness. | `≥ 4` |
| `endCard.diff` | Difference between the last card frame and the card asset itself. | `≤ 12` |
| `endCard.playedDeltaSec` | How much of the card was cut off. | `≤ 0.2` |

The two caption readings are two instruments, not one with a fallback, because they are
not on the same scale: a pack that tightens one leaves the other where it is, and a video
is only ever read by whichever applies. The built-in limits are the ones `style.audit` has
always used, so a workspace with no pack in it says exactly what it said before.

A metric that cannot be read on a given video — no split, no hook, no card — is not a
failure. It is `skipped`, with the reason, the way `auditStyle` already skips a sequence
that was never rendered.

A pack's check **replaces the built-in one for the metric it names** and leaves the rest
alone: tightening the framing should not thereby stop anyone noticing that the end card is
cut off.

## Why the pack brings thresholds and nothing else

The alternative is an expression language: `duration > 60 && cuts < 3`. It is refused for
the same reason [packs never ship code](./AGENT-FIRST.md): the moment a pack can express a
condition, it wants to express a measurement, and then it wants a function, and then a
pack is a program you install from a URL.

A closed vocabulary also makes the pack checkable at import. `packs.inspect` resolves every
`metric` name and every limit (`review/lib/lint.ts`), and says so before anything is copied
— the same shape as the rule lint in `rules/server/registry.ts`, which already says when a
rule "judges but does not act". It catches a metric nobody can read, a check with no limit
at all, a number asked of a yes-or-no, a range nothing can be inside, a critical finding
with nothing to do about it, and two criteria sharing an id. A pack that promises a
standard nobody can hold it to is a defect of the pack, and the person installing it should
see that on the preview page, not discover it as a review that quietly never runs.

## The judged pass

The agent answers each rubric item, in order, into the artifact. An answer is
`{ id, verdict, evidence, note }`, where `verdict` is `holds`, `fails` or `cannot-tell`.

- Evidence is required and must be of the declared kind. "Yes" with nothing beside it is
  recorded as `cannot-tell`.
- `cannot-tell` on a `critical` item is a finding, not a pass. It says the video could not
  be verified, which is a different sentence from "the video is wrong" and should read that
  way in the UI.
- A rubric item the agent never reached is a failure of the review, reported as such
  ("The review did not reach this question"), not quietly dropped.

One pass. It reports and returns; fixing and running it again is the loop, and it is the
person's or the agent's to close. Nothing here retries on its own, because a gate that can
loop forever is a gate that gets switched off.

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
  "schema": 1, "sequenceId": "seq_…", "title": "Two kinds of engineer",
  "pack": "pashoai-shorts", "reason": "The video is made in stream-short, from the Pasho pack.",
  "at": 1758700000000, "revision": 412, "stages": ["project", "export"],
  "verdict": "passed-with-findings",
  "checks": [
    { "id": "framing", "metric": "framing.worstDrift", "severity": "critical",
      "value": 11.4, "limit": "at most 18", "ok": true, "fix": "" },
    { "id": "no-tail", "metric": "video.durationSec", "severity": "critical",
      "value": 68.2, "limit": "at most 62", "ok": false,
      "fix": "Cut after the last sentence; the tag runs long.",
      "waived": "this one is a two-parter; the tag is the bridge" }
  ],
  "rubric": [
    { "id": "chat-opens", "ask": "Does the clip open on the comment being answered?",
      "severity": "critical", "verdict": "holds", "evidence": "0.4s", "ok": true,
      "note": "the comment card is up before the first word", "fix": "Extend the head." }
  ],
  "skipped": [{ "id": "seam", "why": "captions.crossesSeam cannot be read on this video" }]
}
```

`stages` says which tiers were actually taken, so "it passed" never means "nothing ran".
A waived finding keeps `ok: false` and carries the reason: the waiver decides the verdict,
never the record.

It stays out of the EDL. The EDL is what the video *is*; a review is an observation about
one export of it, and putting it in the project state would make every review a revision
and every revision stale every review.

## Where it runs

Both interfaces, one implementation, as [SPEC.md](./SPEC.md#core-requirement-one-editor-two-interfaces)
requires. Every button in the panel calls the tool an agent calls:

| Tool | |
|---|---|
| `review.run` | Hold a video to the standard and write the artifact. `rubric:true` also asks the questions, which costs an agent run. |
| `review.read` | The last review of a video, or of every video. |
| `review.criteria` | What this video is held to, and why that pack. |
| `review.catalogue` | Every metric a pack may name. This is what a `review.json` is written against. |
| `review.waive` / `review.unwaive` | Let a finding stand, with the reason, or stop letting it. |
| `review.severity` | What a finding is worth here; `null` gives it back the pack's. |
| `packs.review.get` / `packs.review.set` | A pack's own standard, with whatever is wrong with it. |

- **Before the export**, `renderProject` runs the project tier and refuses on a `critical`
  it finds, naming each one and its `fix`. Nothing there reads pixels, so exporting never
  waits on an audit. This is the only new gate; everything else reports.
- **After the export**, the pixel metrics join in — `review.run` asks `style.audit` for
  them, and skips them by name on a video nobody has rendered.
- The judged pass runs last, because half the questions are about what the frames show.
- `style.audit` stays what it is and stops deciding on its own: the numbers now come out of
  it, and the limits beside them come from the pack.

The waiver goes through `plan.patch` and `sequence.plan.patch` like any other edit, so it
is revisioned, undoable, and visible as something somebody did.

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

## Where it lives

```
src/modules/review/
  types.ts                 the standard, the artifact, and what a finding is
  data.ts                  the metric catalogue and the built-in limits
  lib/metrics.ts           what a video measures, off the EDL, pure
  lib/evaluate.ts          checks against measurements, waivers, severities, the verdict
  lib/lint.ts              what is wrong with a pack's standard
  server/criteria.ts       which standard applies, and reading and saving a pack's
  server/review.ts         running it, the judged pass, the artifact
  server/gate.ts           the one refusal, and the sentence it refuses with
  server/waivers.ts        letting a finding stand, through the plan operations
  components/              the editor panel and the pack editor
```

`render/server/style-check.ts` now returns its numbers alongside its own checks;
`PackManifest` carries `review`; `ProjectPlan` and `SequencePlan` carry severities and
waivers. Tests: `src/modules/review/__tests__/review.test.ts`, in `pnpm test`.

## Status

Built 2026-09-24. What is not done yet:

- No pack that ships with the product carries a `review.json`, so out of the box every
  video is still read against the built-in limits.
- The judged tier is asked for explicitly (`rubric:true`); nothing asks the questions on
  its own after a render.
- A waiver is per project or per video, never per export, so re-cutting a video keeps the
  waiver its plan already carries.

Decisions behind this: [AGENT-FIRST.md](./AGENT-FIRST.md) #71–#74.
