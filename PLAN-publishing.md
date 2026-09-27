# Publishing from Agentcut

Status: **implementation plan, not shipped; product direction partially confirmed**.
Written and updated 2026-09-26. After the grill-me interview, the owner confirmed that
this feature must execute real publication, with a realistic draft → approved →
publishing → published lifecycle. iPhone Mirroring running on the local computer is
the primary delivery route to integrate first; it has already been used successfully
to publish through the existing workflow. Postgun and Postbridge remain in scope.
Unanswered policy choices below remain provisional. This planning conversation does
not select a particular video/account/batch for a live publishing run.

## 1. Product outcome

Finish a video, prepare its publication for several networks, place it on a calendar,
and execute it through Postgun, Postbridge, or an attended iPhone Mirroring session,
without leaving Agentcut. The human and agent use the same saved records and commands.

**Priority confirmed by the owner:** complete local iPhone execution through the
actual final submission and verification, not merely a checklist, export, caption
copying, or stopping before the Publish button. Reuse the working phone workflow and
integrate its state into Agentcut. API providers follow the same domain contract but
must not postpone proving the primary phone path end to end.

The ordinary flow is:

1. Create or edit any sequence, including a generated clip or a source-free video.
2. Open **Publication** in the existing editor.
3. Choose accounts. Generate or write the network-specific copy.
4. Reserve a suggested time, or choose one manually.
5. Review the actual export, copy, destinations, and times; approve one or a batch.
6. Send API destinations to their providers and prepare phone destinations together.
7. Follow each destination's confirmed result in the calendar and editor.

One publication is one editorial release with N destinations. A single-network
publication uses the same model. There is no new pack/bundle layer: Agentcut's packs
remain reusable templates, rules, assets, and recipes. A batch is a selection of
publications for an operation, not a campaign entity.

## 2. Interview decisions and their consequences

Confirmed: real publishing is required, the local iPhone route is the first priority,
and generated/approved/publishing/published must be visible lifecycle states. The
remaining defaults here are **provisional**, reversible before implementation. These
are product-policy choices, not missing technical research.

| Question | Proposed default | What another answer changes |
|---|---|---|
| What may AI do after clips are produced? | Confirmed: proceed through actual publishing, with drafts and approved videos preceding execution. Proposed trigger: Publish now or Schedule on an approved selected batch. | Whether approving a video alone should also auto-dispatch remains unconfirmed; do not invent that trigger. |
| What does manual iPhone publishing mean? | Confirmed: existing working Mirroring publication runs on the local computer and is the primary route. Proposed operating policy: attended execution of a bounded approved batch, including final submission. | Owner presence vs unattended operation remains unconfirmed; local execution does not itself answer that question. |
| Must publishing work while the Mac is off? | Yes after a provider or native app has confirmed its schedule. Local pending work waits. | Dispatching work not yet handed off needs an always-on runner/deployment. |
| How are slots chosen? | Weekly configured times, minimum spacing, explicit timezone, urgency followed by stable ordering. | Daily windows use the same planner with generated candidates; audience optimization requires analytics and an evidence history. |
| How many brands? | One workspace, multiple accounts per network, one default account selection; destinations may choose other accounts. | Independent brands add scoped preferences, schedules and ownership rather than just an account filter. |
| What happens after an approved video's edit? | Keep the approved export; show that a newer edit exists. Replacement is explicit and reapproved. | Always using latest edits makes approval unstable and requires dispatch-time resolution rules. |
| Import existing Cadence work? | Provide a previewable, one-time importer if its calendar remains active. Do not run it automatically. | Starting fresh removes migration execution, but preserves the import design as optional. |

Do not ask about names, file organization, icon choices, or vendor libraries. Resolve
those using this repository's conventions. Ask a second interview round only if the
owner's answers introduce a new architectural fork. Once answered, replace this
table's pending choices with the accepted decisions and their reasons.

## 3. Evidence and reuse assessment

### Agentcut today

- [SPEC.md](./SPEC.md#core-requirement-one-editor-two-interfaces) requires one editor
  and two equivalent interfaces. Publication must be reachable inside that editor.
- [SEQUENCES.md](./SEQUENCES.md) covers general sequences and generated clips. A
  publication references their existing stable ID; it must not create another editor
  or promote a clip merely because someone opened its publication panel.
- `src/modules/editor/server/store.ts` owns revision-checked EDL persistence;
  `src/modules/editor/lib/operations.ts` owns timeline edits. Publishing metadata does
  not belong in the rendering EDL.
- `src/modules/render/server/render-project.ts` calls the review gate, renders a
  saved snapshot, and records revision/file in `rendered.json`. That manifest is a
  latest-output index, not an immutable publication artifact registry.
- `src/common/server/db.ts` provides local SQLite; jobs/reaper and activity plumbing
  exist under `project/server`. Keep publication work from holding the editing lock
  while waiting on network uploads or the phone.
- `src/modules/agent/server/mcp.ts` derives tools from editor schemas and currently
  assumes project context. Workspace calendar/accounts tools need explicit workspace
  scope; do not invent a dummy project to satisfy that assumption.
- `src/modules/settings/server/workspace.ts` composes workspace settings; existing
  `common/server/secrets.ts` provides write-only provider-key plumbing.
- `src/modules/plan/types.ts` defines current sequence states as `pending`, `edited`,
  `approved`, `rendered`; `project/data.ts` labels them and `project/lib/overview.ts`
  counts them. Those are production/review states, not real social delivery states.
  In particular, rendered does not mean published. Preserve the reviewed approval
  while adding the real publication lifecycle below.
- `package.json` enumerates test files explicitly. New tests must be added to the
  test command; merely creating a test file will not run it.

### Cadence: reuse the useful pieces, not the application

Reviewed sibling sources under `../Cadence`:

| Source | Useful starting point | Required correction/adaptation |
|---|---|---|
| `src/modules/post/types.ts` | One post, N independently tracked destinations; revision checks. | Avoid storing hashtags both inside editable caption and separately as competing authorities. Link directly to Agentcut video/export IDs. |
| `src/modules/providers/types.ts` | Adapter boundary and per-destination results. | Capabilities must depend on route, account, network and format. Distinguish phone-assisted scheduling from headless execution. |
| `src/modules/providers/server/postgun.ts`, `postbridge.ts` | Account, upload, create, status and cancel mappings. | Verify current contracts, unknown-outcome handling, actual field support and provider credential boundaries. |
| `src/modules/calendar/lib.ts` | Calendar ranges and deterministic slot candidates. | Evaluate occupancy by account, reserve transactionally, test DST explicitly; do not silently move nonexistent local times. |
| `docs/PHONE-GROUPED-POSTS.md` | One download per video, attended session over all phone destinations, observed app traps. | It explicitly says grouped sessions are a plan, not implemented. Do not claim those APIs already work. |
| `tools/phonectl.swift` and phone flows | Existing input/screenshot primitives and app walkthroughs. | Visually driven decisions, account checks, device lock, resumability, evidence, no blind final tap. |
| Agentcut bridge | Origin matching and batch import concepts. | One-time migration, not a permanent second database synchronization. |

Check source license and required attribution before copying code, including the
phone tool's upstream license. Open source alone does not establish compatibility.
Keep licenses with vendored files. If a file's terms cannot be established, use the
behavioral specification and write the necessary implementation independently.

Do not copy Cadence's profile/analytics/memory framework wholesale. Reuse Agentcut's
preferences, glossary, agent harness, secrets and activity surfaces.

### External contracts checked for this proposal

- [Postbridge reference](https://api.post-bridge.com/reference) and its
  [OpenAPI schema](https://api.post-bridge.com/openapi.json), retrieved 2026-09-26:
  account listing/connect links, signed media upload, post creation, patch and delete
  exist. Configuration is platform/account dependent. In particular, a null schedule
  can mean publish immediately; never translate “remove local reservation” into that
  payload. The schema also exposes its own queue; Agentcut should pass explicit times
  to preserve its own slot decisions. These facts do not establish tested live access.
- Postgun's local `server/src/modules/post/post.controller.ts` exposes constraints,
  publish, read, cancel and reschedule operations. Immediate publishing has a distinct
  scope from scheduling. Validate the deployed instance's version against local code;
  a source checkout is not proof of production behavior.
- [Apple's Mirroring requirements](https://support.apple.com/en-us/120421): compatible
  Mac and OS, nearby locked iPhone, shared Apple Account with two-factor authentication,
  Bluetooth and Wi-Fi. Setup must check availability and explain failed prerequisites.
  Mirroring availability alone does not establish that an app's publishing flow works.

Exact network limits, eligibility, scheduling horizons and available fields must be
recorded from the selected provider/account and current official platform sources
during adapter implementation. Do not turn the owner's five hashtags, 39-minute
interval, Drive root, or one timezone into global product constraints.

## 4. Deliberately bounded first release

Include YouTube video/Shorts, Instagram Reels and TikTok video; multi-account selection;
Postgun, Postbridge and attended iPhone execution for the verified formats; editor copy
and scheduling; workspace calendar; batch preparation/approval; per-destination
recovery; immutable exports; optional Cadence import. General YouTube videos need
their own capability validation even if the same adapter handles Shorts.

Do not advertise an iPhone format as executable before its walkthrough is verified.
Unsupported combinations explain the missing support and allow another configured
route or a human checklist. Do not silently discard metadata to make a route work.

Exclude campaigns, social inboxes, analytics dashboards, audience prediction, direct
OAuth implementations for every network, teams/roles, a hosted service, automatic
Drive synchronization and a third-party plugin marketplace. Additional networks can
register schemas and capabilities later; no built-in assumption limits publications
to this owner's AI clips or three personal accounts.

All requested surfaces and transports belong to the final feature. The work order
below is implementation sequencing, not permission to call a partial feature done.

## 5. Architecture and ownership

Add one domain, `src/modules/publishing`, initially containing:

```text
types.ts                       schemas, commands, results and view models
data.ts                        built-in format descriptors and UI state labels
lib/resolve.ts                 content/time inheritance and outgoing preview
lib/validate.ts                shared constraints and readiness
lib/schedule.ts                deterministic slot planning
lib/status.ts                  aggregate status from destination facts
hooks/                         calendar and publication queries/commands
components/                    editor panel, destination form, calendar, phone session
calendar-view.tsx               workspace page view
connections-view.tsx            settings page view
server/store.ts                revisions, SQL transactions and migration
server/service.ts              authoritative commands and preconditions
server/tools.ts                schemas/dispatch exposed to all interfaces
server/pages.ts                route loaders
server/artifacts.ts            export references, immutable files and integrity
server/copy.ts                 existing harness + grounded context + draft proposals
server/runner.ts               durable dispatch, leases and reconciliation
server/providers/              registry, Postgun, Postbridge, fake provider
server/phone/                  readiness, primitives, sessions and evidence
server/import-cadence.ts        explicit preview/apply import
__tests__/                     domain, contracts, handoffs and recovery
```

The calendar is a projection of publishing records, not an independent scheduling
domain. Start with a single module; split only when real shared boundaries emerge.
Routes under `src/app` parse input/load data and render one view, with no SQL or layout.
All `.ts` imports are relative. Browser/Remotion-safe types and pure helpers never
import node services. Small provider wire-format types also live in `types.ts` or a
module type file consistent with the architecture test, not inline in adapters.

Existing files touched for integration: editor view/sidebar, project batch completion,
workspace navigation, settings overview, browser API client, agent/MCP/CLI registry,
render artifact capture, schema initialization and test scripts. Keep domain rules
out of those callers. Publication actions use their own revision, not project EDL
writes. Any needed actual video edit still goes through editor operations/store.

## 6. Minimal durable model

Use local SQLite with explicit schema version migrations at service initialization,
never a page loader that mutates projects. Back up before a migration/import.

| Record | Essential fields and purpose |
|---|---|
| `publication` | ID, project ID, sequence ID, internal label, base title/description/hashtags, default intended time, timezone, priority/expiry, revision, origin, timestamps. |
| `publication_destination` | ID, publication ID, account/connection binding, format, explicit overrides, intended time, approved payload hash, artifact reference, confirmed remote time, delivery state, remote ID/URL, evidence, last checked time and structured error. |
| `publication_artifact` | ID, project/sequence/revision, immutable file, SHA-256, size, dimensions, duration, encoding, generation time and review evidence. |
| `publishing_connection` | Provider, instance URL, secret reference, health and cached capabilities. No secret in returned records. |
| `publishing_account` | Connection ID, provider account ID, network, display identity, reconnect/disabled flags. Unique connection + provider account ID. |
| `publication_attempt` | Destination, action, approved payload hash, idempotency key, lease/owner, start/end, outcome and remote response reference. Durable dispatch journal. |
| `phone_session` | Publication, device lease, approved destination subset, artifact/location, progress, timestamps and evidence references. |

Store preferences in existing workspace preference plumbing where possible:
timezone, weekly times, minimum spacing, default account selection and writing
guidance. Do not create another memory system. Store structured destination-specific
options as versioned, validated JSON; reject unknown unsupported fields rather than
silently dropping them. Provider adapters receive a fully resolved payload.

Constraints and indexes:

- Unique destination per publication/account/format unless an explicit repeat is
  being created. Routine “prepare publication” is idempotent for a sequence's current
  working publication. An intentional re-release creates a new publication.
- Index intended and confirmed times, account/status, origin import IDs and pending
  attempts. Deduplicate imports by source workspace + source publication ID.
- Every mutation checks `expectedRevision`; conflicts return current state and a
  readable diff. No stale full-record replacement or silent AI overwrite.
- Reservations are destination/account scoped. Check minimum-gap conflicts inside a
  transaction; do not rely on a time equality unique index alone.
- Keep actual remote facts separate from intended local changes. Deleting a project
  must not cascade-delete published history or files still referenced by submissions.
  Use explicit detach/archive handling and nullable historical source links.
- Do not infer that matching usernames across providers are the same account. Allow
  explicit equivalence linking to prevent accidental duplicate delivery via two routes.

## 7. Copy and destination customization

Model `title`, `description` and ordered hashtags separately. A single shared resolver
composes the exact outgoing caption, including hashtags once. The preview uses that
resolver and the adapter serializes its output. Hashtags are not YouTube metadata
tags; model those separately only where supported.

| Format | Visible editing fields |
|---|---|
| YouTube video or Short | Title, description, hashtags; supported visibility/audience/disclosure and other required options. |
| Instagram Reel | Description, hashtags, and supported account-specific publishing options. |
| TikTok video | Description, hashtags, and supported privacy/disclosure/interaction options. |

Use a shared base plus nullable overrides. `null` means inherit; an explicit empty
value means intentionally empty and must survive serialization. Show whether each
field inherits and provide Reset to shared text. Applying base changes affects only
inheriting destinations; already approved/sent snapshots do not change silently.

AI reads the sequence's actual contents, source transcript where available, its plan,
project brief, glossary and writing preferences. Source-free sequences use titles,
visible text, plan and owner context; lack of a transcript must not block them. AI
returns structured proposals and reasons for priority/expiry, not arbitrary SQL.
Do not claim an event date or product fact without supplied context. Mark uncertainty
for review rather than adding unsupported facts to copy.

Generate on batch completion when enabled or on request, not on every keystroke or
calendar render. Deduplicate jobs by sequence/content revision and selected accounts.
Manual edits survive regeneration; offer per-field proposals/diffs. Generation
failure leaves editable drafts and does not fail successful video production.

Constraint resolution intersects format, provider and account restrictions. Record
source/version/check date for limits. Validate Unicode lengths in the units the
provider uses, required options, final composed caption, file properties and time
horizon. Unsupported required metadata blocks that destination with a specific remedy.

## 8. Scheduling without a second planner

`planSlots(input)` is a pure function. UI preview, batch preparation and agent tools
all call it. Persistence rechecks its assumptions under a transaction.

Inputs: explicit IANA timezone, weekly local times, target accounts, interval/range,
minimum spacing and daily caps if configured, reservations, confirmed remote entries,
content priority/expiry, pinned placements, route preparation lead time, format
granularity and scheduling horizon. Phone lead time is configurable and measured;
do not promise Cadence's fixed estimate applies to every batch.

Algorithm:

1. Produce candidates in the allowed range using timezone-aware calendar arithmetic.
2. Remove past, blocked, out-of-horizon or too-soon candidates.
3. Exclude collisions for any participating account, including adjacent dates.
4. Order videos by explicit priority, then impending expiry, then stable creation/ID
   order. Optional round-robin by source can be a preference, not an LLM guess.
5. Choose a common valid time for the publication by default. Include reservations
   made earlier in the same batch when assigning later videos.
6. If no common slot exists, return the reason and alternatives. Do not silently
   split networks across times, round phone times or push stale content past expiry.
7. Return proposed placements and reasons; apply with revision/occupancy checks.

Store UTC instants plus the IANA timezone and original local intent. Reject or require
an explicit resolution for ambiguous/nonexistent local times. The slot UI shows the
timezone. A timezone preference change does not silently shift saved instants.

Distinguish suggested, locally reserved and remotely scheduled placements. A planner
reservation requires neither an export nor publishing approval. Dispatch requires both.
Occupancy includes managed publications and provider events fetched for the planning
window when listing is supported. Such events are read-only external entries; phone
users can add an external busy slot. Show freshness/coverage: no system can guarantee
conflict freedom against unseen posts created directly in an app.

Moving a group preserves explicit destination offsets only after showing the result;
moving one destination creates its own override. For already sent entries, moving
starts a remote reschedule action and displays the old confirmed time until success.
It is never a cosmetic local calendar move.

## 9. Export identity and approval

The approved deliverable is `{artifact hash, account, route, format, resolved copy,
resolved options, requested time}`. Approval covers that exact payload. Changing any
field invalidates approval for unsent destinations; internal notes and labels do not.

Extend the render service to capture an immutable publication artifact while it still
owns the render lock. Do not copy an output after releasing the lock: another render
could replace the file between manifest lookup and copy. Use a managed, content-
addressed destination, hash verification and atomic file finalization. Existing EDL
and rendering remain authoritative; a publication does not assemble another video.

AI can draft/reserve before an artifact exists. Approval/dispatch requires an artifact
matching the chosen sequence revision and successful applicable review checks. Show
the actual video and capture output frames as part of verification. A newer project
revision is a signal to compare the sequence's content, not proof this sequence changed.
Prefer a resolved sequence content signature to avoid flagging unrelated video edits.

Editing after approval preserves the pinned export and shows “Newer edit available”.
Explicit replacement creates a new payload version and requires fresh approval.
For already scheduled destinations, apply a supported remote change or an explicit
cancel-and-recreate workflow. Never overwrite the old artifact or suggest a local edit
updated an already uploaded video. Published content remains history; reposting is
a new publication.

Artifact cleanup is reference-counted across publications, attempts and sessions.
Deleting source media or a project must warn about pending delivery and preserve the
approved export/history. Missing or mismatched artifacts stop dispatch before upload.

## 10. Execution, states and recovery

### The visible lifecycle requested by the owner

Show one understandable status in the video list, editor and calendar, resolved by
the same function from editorial approval and actual destination facts:

| Visible status | Meaning and transition |
|---|---|
| **Draft / Borrador** | Generated or still being edited; not yet approved from the clip/video list. |
| **Approved / Aprobado** | Owner accepted the video. No claim that upload or publication happened. Show missing copy/accounts/export/time as readiness details. |
| **Pending publication / Pendiente de publicar** | A concrete Publish/Schedule request is queued but has not started, for example waiting for the local phone. |
| **Publishing / Publicando** | The local phone session or API attempt is actively preparing/submitting the approved publication. |
| **Scheduled / Programado** | Every selected active destination confirmed a future schedule; it is not live yet. |
| **Published / Publicado** | Every selected active destination is confirmed live. Store observed publication time and URL when available. |
| **Partially published / Publicado parcialmente** | At least one destination is live and another remains scheduled, pending, failed or unconfirmed. Show the counts and next action. |
| **Needs attention / Requiere atención** | Execution failed or its result is unknown, with no fully successful overall outcome. Retain each destination's last confirmed facts. |
| **Cancelled / Cancelado** | Unsent work cancelled or remote cancellation confirmed for all remaining intended deliveries. Previously live posts stay in history. |

The common immediate path is Draft → Approved → Pending publication → Publishing →
Published. Native/API scheduling inserts Scheduled before Published. Pending can be
brief, but it is different from claiming that a sleeping Mac is actively publishing.

Aggregation rules: preserve live/partial facts first; all intended active destinations
live yields Published; some live yields Partially published; otherwise unresolved
failure/unknown/cancellation needs attention; then active attempts yield Publishing,
all confirmed future submissions yield Scheduled, outstanding dispatch intent yields
Pending publication, and no dispatch yields Approved or Draft from editorial review.
Show mixed scheduled/pending counts rather than promoting a partly submitted group
to Scheduled. Intentionally dropping a failed destination changes the target set only
through an explicit recorded action; it cannot hide a failed delivery automatically.

For a video with an intentional repeat publication, display the current release's
status and a link/count for earlier releases. Do not erase a previous Published fact
when a new draft release is prepared.

### Integrate the existing approval rather than create a second review queue

The existing list's Approve action remains the way to accept a generated video. That
approval must flow into publication readiness through the authoritative sequence
review state; do not maintain two independent “video approved” flags. Publication
approval binds the delivery payload (accounts, copy, media and time), not another
review of whether the clip was good. Present it as the Publish/Schedule action with
its resolved summary, not another compulsory approval stage for the same video.

If the selected payload/batch already has valid authorization, continue through the
final native Publish/Schedule tap without requesting confirmation for every network.
The remaining policy fork is only whether video approval itself should auto-dispatch;
the proposed default keeps an explicit Publish/Schedule trigger. Missing required
fields pause readiness with a concrete next action, not a permanent draft-only flow.

Migrate presentation without rewriting old video history: legacy pending/edited map
to Draft for the publication summary; legacy approved maps to Approved when there is
no dispatch; rendered remains an export fact and never establishes publication or a
new delivery authorization. Preserve legacy review behavior explicitly where rendered
was treated as approved, without granting permission to send that export to networks.
Update filters, counts, badges and agent summaries together. Keep legacy production
facts available as details; do not add remote states directly to the EDL enum and then
let a later render overwrite Published with Rendered.

### Durable delivery facts

Keep editorial readiness (draft, approved version) separate from delivery facts:

| Delivery state | Meaning |
|---|---|
| `not_sent` | Local record; reservation may exist. |
| `queued` | Approved durable intent waiting for processing or a phone session. |
| `sending` | Claimed attempt; submission in progress. |
| `scheduled` | Provider/native app confirmed the actual future time. |
| `published` | Provider/native app or explicit human verification confirms live. |
| `failed` | Definite failure; error identifies whether retry is safe. |
| `unknown` | Submission may have succeeded; reconcile before retry. |
| `cancel_pending` | Cancellation requested but remote effect unconfirmed. |
| `cancelled` | Confirmed cancellation, or unsent work cancelled locally. |

Derive the publication summary from its destinations. Never show partial success as
complete. Display counts such as “2 scheduled · 1 needs attention”. Elapsed time alone
does not make a scheduled destination published. Keep desired and confirmed times.

Dispatch protocol:

1. In one SQLite transaction, verify revision, authorization, artifact, capabilities
   and time; persist approved payload and dispatch intent.
2. A local runner claims a short lease and journals an attempt before network I/O.
3. Reuse an upload by artifact hash + provider connection where the remote upload is
   still valid. Do not upload separately for every destination unnecessarily.
4. Submit and persist each result independently; never hold a DB transaction over I/O.
5. Poll status with backoff while local runner is available; refresh on explicit request
   and startup. The provider owns the future firing after confirmed acceptance.
6. After crash/timeout, reconcile accepted work before retry. Idempotency keys help
   only when the provider honors them. Without a reliable lookup/key, mark unknown
   and require reconciliation instead of risking a second live post.

One explicit local runner invocation owns the queue with a renewable lease. It may
be started alongside the app by the launcher; do not use request lifetime, page loads
or an in-memory timer as the durable scheduler. On startup recover expired leases,
check pending remote states and report missed local deadlines. Never “catch up” by
publishing overdue work immediately without a selected policy.

Rate limits use provider retry guidance and bounded backoff. Authentication failures
mark the connection/account for reconnect. Validation failures return to editable
draft. Retry only affected destinations. Cancellation and rescheduling have their own
attempt journal; a cancel timeout also needs reconciliation. Switching providers is
explicit and cannot bypass an unknown previous submission.

## 11. Provider setup and contracts

Settings → Publishing shows connections, account identity, reconnect state and a
test-connection action. API key + instance URL config lives server-side. List which
capabilities actually work for each account; a configured key is not a tested route.
Reuse write-only secret storage, redact logs/errors, never send credentials to the
browser or attach provider bearer tokens to a signed upload URL's different host.

Postgun: connect with key and configurable base URL, list enabled integrations,
upload through its media service, map resolved text and per-integration schedule and
options, retain each returned post ID, poll/cancel/reschedule through its API. Test
immediate-vs-scheduled scopes against the deployed contract. Do not copy Postgun's
entire social integration backend into Agentcut.

Postbridge: connect with key, fetch all paginated accounts, optionally use connect
links, upload via signed URL, map platform/account configurations and preserve returned
IDs. Prefer one remote post per destination for independent recovery; cache the upload.
Use patch for supported changes; confirm how a given state permits edits. Never send
null `scheduled_at` to express local unscheduling. Keep `use_queue` off when supplying
Agentcut's resolved schedule. Verify account-level overrides rather than assuming a
generic settings object is supported everywhere.

Capabilities are resolved per route/account/network/format: schedule, immediate send,
remote update/cancel/status, supported metadata, file constraints, time precision,
horizon and whether execution requires a person. UI hides unsupported actions only
with an explanation; service validation remains authoritative. Unconfigured providers
do not block editing, local copy preparation or calendar planning.

## 12. One attended iPhone session per publication

Setup checks Mirroring prerequisites plus phonectl build, Screen Recording,
Accessibility, visible window and active account identities. Permissions are granted
through OS UI; do not attempt to bypass them. Non-Mac users retain API publishing and
manual checklists. The rest of the app must start without Swift or Mirroring.

Media location supports an explicit Drive folder/file reference or a user-verified
already-on-phone item. The first version does not need a Drive OAuth service. Offer
export/copy-location instructions and record which artifact was transferred. Name and
duration alone are not a byte-identity guarantee: compare available visual/metadata
evidence and keep uncertainty visible. Never select “the newest item” without checking.

Session protocol:

1. Claim an exclusive device lease. Freeze the approved subset/payload versions;
   API destinations in the same publication are handled independently.
2. Check source file, phone account, future times and sufficient preparation window.
   Display the batch scope before starting.
3. Transfer/download the video once and verify the selected asset.
4. For each destination, focus, capture, inspect, act and inspect again. Coordinates
   are hints, not a state machine. Verify selected account, thumbnail and video before
   filling fields; restored drafts must not hijack the session.
5. Paste once, wait, inspect actual field text. Resolve unexpected dialogs visibly;
   stop when account, permission or content identity is uncertain.
6. Set and read back the actual schedule. If an app only offers a coarser time, propose
   that adjustment; do not silently claim the original exact time was set.
7. Before final submission, revalidate approval and payload against the session
   snapshot. The default requires an attended session and an approved bounded batch,
   not a new confirmation for every ordinary tap.
8. Verify in the native scheduled/published list; save evidence and observed time.
   Keep `remoteId` null if unknown. A session/evidence ID must not masquerade as a
   network-issued post ID, unlike the synthetic ID suggested in Cadence's plan.
9. Continue only unfinished destinations. An uncertain final tap becomes unknown;
   inspect the app's list before any second submission.

Expose screen/tap/key/paste/scroll/home primitives through a session-bound service,
plus start/record/finish/abort/resume commands. The UI presents the same checklist,
evidence and manual record action. Do not equate agent-only low-level automation
with a human being unable to achieve the corresponding publication action.

Abort stops further actions and records last verified state; it cannot promise apps
were reset or previously scheduled posts cancelled. Cancellation requires a native
app action and confirmation. Once time passes, leave status unconfirmed until checked.

Store evidence under workspace-managed session folders with retention controls;
screenshots can contain private notifications. Never expose arbitrary local paths
through an evidence API. Measure transfer and per-app time on a small representative
batch before promising daily throughput. Cadence's timing estimate is not a benchmark.

## 13. Interface: three entry points, one publication form

Apply existing layout/writing/accessibility/UI skills and tokens during implementation.
No visual redesign is required for this feature.

**Library/home:** a visible Calendar entry next to the existing library/project
navigation. Week view plus agenda, with month view for overview. A date-range query
loads just the needed records. Include unscheduled drafts, timezone, account/status
filters and an attention count. Phone work due for preparation is distinct from
the time the posts will go live.

Group destinations sharing a time into one card. If destinations fall on different
days/times, show linked occurrences on each applicable day; an earliest-time-only
chip would hide future commitments. Each opens the same publication record.
Drag changes use the same move command as the explicit date form; provide keyboard
alternatives and show a diff before affecting confirmed remote schedules.

**Editor:** Publication panel reachable while previewing/editing the active sequence.
Show artifact/current-edit relationship, common copy, expandable per-network fields,
accounts, schedule, validation and state. Required fields and next action stay visible.
Advanced options disclose progressively. Keep the timeline central and avoid routing
to an isolated simplified composer. A publication details page may reuse the same
form, but editor access is mandatory.

**Settings:** Publishing connections and defaults: timezone, weekly slots, spacing,
accounts and copy guidance. Provider setup includes connection testing and reconnect
actions, not just a secret text field.

Project video selection supports Prepare publications, Propose times and Review batch.
Show every selected video's resolved content and destinations before approval. Surface
partial failures without clearing completed rows. Read-only calendar browsing must not
start generation, migration, uploads or phone sessions.

Status copy distinguishes “Reserved locally”, “Scheduled on Instagram”, “Waiting for
iPhone”, “Result unconfirmed” and “Published”. Never use “Scheduled” for a local draft
without qualifying it. Errors identify the destination and next step. Status is not
color-only. Verify keyboard navigation, focus return, screen-reader labels, zoom,
narrow screens and large batches; announce task completion without stealing focus.

## 14. Shared human/agent command surface

Commands live in publishing services, with schemas registered once for browser API,
hosted agent, MCP and CLI. Workspace tools do not require a fake project context.

| Commands | Shared behavior |
|---|---|
| `publishing.connections.list/check/save`, `publishing.accounts.sync` | Configure/check routes and refresh account facts; secrets write-only. |
| `publication.prepare/read/list/patch` | Create/reuse a draft for a video; read/edit shared metadata and overrides with revisions. |
| `publication.copy.propose/apply` | Structured proposals, selective acceptance and conflict protection. |
| `publication.artifact.pin` | Bind a verified saved render; never replace silently. |
| `publication.validate` | Exact readiness, resolved payload preview and field-level failures. |
| `publication.slots.plan/reserve`, `publication.move` | One deterministic planner; transactional reservation and explicit remote changes. |
| `publication.approve`, `publication.dispatch` | Approve payload versions and submit only approved current destinations. |
| `publication.refresh/reconcile/retry/cancel` | Recover individual destinations without repeating successful ones. |
| `publication.calendar` | Range/account/status projection with intended/confirmed times and freshness. |
| `publication.phone.start/resume/record/finish/abort` | Same bounded phone session and evidence for panel and agent. |
| `publication.import.preview/apply` | Idempotent one-time migration with per-row outcomes. |

Approval attribution comes from the authenticated interface/host context, not a model
claiming `approvedBy: human`. Ordinary agent tools may prepare and request approval;
approval from an agent requires an explicit recorded user grant covering that batch
and payloads. This is not an extra chat confirmation when the UI already approved it.

Batch commands return per-publication results and revisions. Local reservation/approval
can be transactional for a selected batch; external dispatch can never be all-or-nothing
across three independent networks. Make that distinction visible.

## 15. Optional Cadence migration

Implement preview and apply before moving any real calendar. Read a consistent export
or backup of Cadence's database. Do not read credentials or print private copy during
repository inspection. Migration is an explicit owner-selected operation.

1. Map publication origin to project/sequence IDs; report missing/deleted sequences
   and unmatched media rather than reconstructing timelines automatically.
2. Map connections/accounts explicitly. Configure secrets anew through settings;
   never copy raw credentials into the import report.
3. Preserve common copy, per-destination overrides, intended times/timezones and
   source provenance. Preserve remote IDs and evidence when valid.
4. Copy/register immutable artifacts with hashes. Missing files produce a draft
   requiring action, not a ready-to-send entry.
5. Reconcile known native-app schedules. Cadence's plan reports at least one real
   phone run still represented locally as draft; importing that draft as unsent would
   risk a duplicate. Mark uncertain rows for reconciliation, with dispatch disabled.
6. Preview counts, conflicts, occupied slots and required mappings. Apply locally
   without dispatching any publication. A second import must create zero duplicates.
7. At cutover, designate Agentcut the authority and stop Cadence dispatch for imported
   work. No bidirectional sync. Already scheduled provider jobs remain in place.

Rollback restores the pre-import local backup only before subsequent local writes,
or removes exactly untouched imported records through a scoped rollback. Neither
method claims to undo remote effects. Import itself must create no such effects.

## 16. Implementation order and completion gates

Work on `main`, by explicit file paths, respecting concurrent changes. No code changes
were made for this proposal. Before implementation read the relevant bundled Next.js
guides under `node_modules/next/dist/docs/` for route handlers, server/client boundaries
and data loading; do not apply remembered APIs blindly.

The following are dependency-ordered work packages within one complete feature:

| Order | Work | Exit evidence |
|---|---|---|
| 1 | Resolve interview defaults; verify licensing and provider contracts; add fake-provider fixtures. | Accepted decision record, supported format/route matrix, no invented provider capabilities. |
| 2 | Publishing schemas/store, revisions, resolver, validation, state reducer and immutable artifacts. | Domain tests, concurrent-write tests, pinned export integrity, existing editor unaffected. |
| 3 | Shared commands, workspace tool registration and editor Publication panel. | Human → agent → human edits preserve all fields; source-free sequence works; no EDL rewrite. |
| 4 | Deterministic planner, reservations, calendar and batch copy/preparation. | DST, collision, pinned-slot, mixed-time card and generation-retry tests; keyboard calendar flow. |
| 5 | **Priority: local iPhone execution**, durable runner/leases, working primitives, grouped session, real submission, evidence and UI recovery. | With an explicitly selected test batch, reuse the working phone flows through final Publish/Schedule; verify native outcomes and list/editor/calendar states. Interrupted sessions resume only pending work. This gate does not depend on API credentials. |
| 6 | Postgun/Postbridge setup, uploads, remote scheduling, polling and recovery against the same commands and states. | Contract fixtures and controlled authenticated validation, timeout/restart/partial-failure tests. API work does not delay validating the phone route. |
| 7 | Optional import preview/apply, cutover runbook and full end-to-end acceptance. | Repeat import no-op, known phone discrepancy retained for reconciliation, all requested surfaces reachable. |

Do not develop another feature on a red tree. Each integrated increment runs required
checks before committing; neither partial commits nor a fake-provider demo justify
marking publishing shipped. If authorization/credentials prevent a live publishing
test, record that limitation and keep the corresponding acceptance gate open.

## 17. Verification matrix

| Requirement / risk | Necessary proof |
|---|---|
| Same video, three destinations | One publication in editor; individually editable copy/time/state, same pinned artifact by default. |
| Owner's lifecycle and existing approval | Generated clip is Draft; approval from its list yields Approved; actual dispatch yields Pending/Publishing and then verified Scheduled/Published. Rendering alone never marks Published. No duplicate video-review queue. |
| Primary phone path really publishes | Local agent performs the final native submission for an authorized test publication, verifies the real outcome, and writes the matching state visible in editor/list/calendar; a dry run or stopping before Publish does not pass. |
| One-network/general-editing use | Source-free video and ordinary single-account publication traverse exactly the same commands. |
| UI/agent parity | Equivalent command inputs yield identical records, validation and outgoing payloads; test both handoffs and stale revisions. |
| Text semantics | Inheritance vs explicit empty, manual edits preserved, hashtags composed once, title separate from description, no silent dropped fields. |
| Scheduling | Same batch competes for slots, separate accounts don't conflict unnecessarily, DST fold/gap, midnight boundaries, insufficient capacity, expiry and timezone change. |
| Calendar accuracy | Reserved vs remote confirmed, per-destination dates, overdue phone preparation, external occupancy freshness, partial results. |
| Export safety | Re-render same sequence while pinning, edit after approval, deleted source, missing file, checksum mismatch, artifact retention. |
| Render parity | Shared saved revision through UI/agent export; inspect exported frames for actual intended content, titles/captions and aspect variants. |
| Provider setup | Pagination, revoked keys, reconnect accounts, schema limits, signed-upload headers, immediate vs scheduling scope. |
| Delivery recovery | Process crash before/after submit, unknown outcome, rate limiting, duplicate invocation, lease expiry, partial network success. |
| Remote changes | Cancel timeout, unsupported update, confirmed old schedule retained, null schedule never accidentally publishes now. |
| Phone workflow | Wrong account, restored draft, delayed clipboard, lost focus, unexpected modal, coarse time picker, failed transfer, uncertain final tap, interrupted session. |
| Phone grouping | One verified transfer for all phone destinations; API route can coexist; another session cannot claim the same phone. |
| Import | Dry preview no writes, deleted sequence, missing artifact, mismatched account, repeated import, already scheduled phone draft. |
| Accessibility/performance | Keyboard date alternative, focus restoration, non-color state, mobile agenda, range pagination, batch progress without blocking editing. |

Required repository checks during implementation:

```text
pnpm test
pnpm test:render
pnpm exec tsc --noEmit
```

Add new tests explicitly to the script. Use fake providers and fault-injecting HTTP
servers for destructive/error paths. Live publishing or native-app commit tests need
the owner's explicit test-content/account authorization; this planning request is
not that authorization. A dry run proves mapping and UI, not real delivery.

For this documentation-only proposal, validate file references and patch whitespace;
do not claim implementation tests or live publication tests were run.

## 18. Documentation and release accounting

The owner's confirmed publishing scope, primary phone route and lifecycle are recorded
in AGENT-FIRST decision 145. Remaining interview policies are still proposals. When
the owner resolves those choices, add the next free numbered Decided rows to
[AGENT-FIRST.md](./AGENT-FIRST.md) in the same commit as the corresponding accepted
design, covering publication/destinations, local-vs-remote scheduling, immutable
approval, shared commands and attended phone execution. Do not reserve a row number
now: another session may add decisions meanwhile. Until then, the remaining technical
and policy proposals must not be presented as accepted decisions beyond row 145.

Amend [SPEC.md](./SPEC.md) with optional local-first publishing and its actual status;
[EDITOR.md](./EDITOR.md) with publication controls/shared commands; and
[docs/SETUP.md](./docs/SETUP.md) with connections, runner and phone setup. Keep the
founding S1–S10 decisions and pack-registry publishing terminology distinct. Amend
promised rows when the full feature ships, citing the acceptance evidence.

The release is complete only when a user can prepare a publication inside the editor,
see all destinations on the calendar, configure both API providers, execute the
advertised attended phone flows, and recover failures with the same capabilities
available to the agent. Optional Cadence migration is complete only if requested and
verified against the selected existing data. This plan itself ships no capability.
