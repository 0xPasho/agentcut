# Publishing

Status: implemented; live acceptance remains open. Automated
fixtures exercise delivery contracts and recovery. They do not establish that an
actual phone or a deployed provider has published this feature's test batch.

## One release, independent destinations

`src/modules/publishing` owns publications, account connections, immutable exports,
calendar reservations, delivery attempts and attended phone sessions. It does not
add a second editor or a campaign/bundle hierarchy. One publication references one
existing project/video; repeat releases get new publication IDs. The existing video
review status remains authoritative for Draft/Approved. Delivery summaries derive
from individual destination facts, including partial success and uncertain results.

The editor's **Video → Publication**, project selection's **Review batch**, Calendar,
workspace MCP tools, CLI and browser API call `executePublicationCommand`. Metadata
is separate from the EDL. Approving the video calls the shared editor operations;
publishing never rewrites a timeline. Agent approval attribution stays `agent`.

Copy consists of a shared YouTube title, description and hashtags, with nullable
per-destination overrides. Null inherits; an empty override clears. Metadata tags are
separate from hashtags. Unsupported route options fail before queueing and use the
same contract function as serialization. AI proposes from the saved video, brief,
glossary and writing guidance. It does not silently replace manual changes.

## Exports and approval

Render and pin captures a managed MP4 under the render lock, records the saved
revision and content signature, probes it, and hashes its bytes. Later edits or
renders do not overwrite that file. Preview uses the pinned file. Dispatch and phone
session startup verify its checksum; missing/changed exports block submission.

Reviewing a video is not authorization to send any later metadata. A human can send
from the panel or authorize the exact publication revision for agent delivery.
Ordinary agent dispatch requires that stored grant. Any publication revision change
invalidates the grant. The phone session records frozen destination payload hashes.
A published/cancelled destination is historical and cannot be reset into an unsent
row. Failed siblings can change their own overrides without rewriting successful
ones. Before replacing a failed payload, its previous delivery facts are retained.

## Calendar and scheduling

Week, calendar month and agenda use the workspace timezone. The range command and
SQLite candidate filter avoid loading editor state for the entire publication
history; pages hold up to 100 publications by default (200 maximum). Per-destination
times appear on their respective days. Account/status filters, unscheduled selection,
attention state and phone preparation due are visible. Dragging a timed destination
opens an explicit change review; the destination form offers the keyboard equivalent.

The deterministic planner considers weekly slots, minimum spacing, preparation lead,
priority, expiry, account equivalence and other publications in the same batch. It
refuses DST gaps/folds. Existing shared reservations are preserved; destination-specific
reservations require explicit editing. Reservation is local and never claims that a
network accepted a schedule. Remote rescheduling retains the old confirmed time
until the provider confirms the replacement.

Refresh provider calendars explicitly in settings or Calendar. All pages must succeed
before a cached external schedule is replaced. Cached external occupancy participates
in reservations and shows its last-checked timestamp; it is not a live guarantee.
Native app schedules require inspection. Link equivalent accounts across routes to
avoid treating one real account as independent capacity twice.

## Durable delivery

The SQLite store journals attempts before submission and uses renewable leases.
The detached worker is started by dispatch and by `agentcut dev/start` on restart.
For direct `pnpm dev/start`, run `pnpm publishing:worker` to recover existing work.
The worker exits when no API work remains; phone sessions are never resumed unattended.

A timeout after possible acceptance becomes Unknown; the worker does not blindly
submit again. Known remote IDs can be polled. Definitely rejected rate limits use
bounded retries with provider Retry-After guidance. Authentication rejection marks
accounts for reconnection. Missed local deadlines fail visibly instead of publishing
immediately. Cancellation and rescheduling have attempt records. Concurrent stale
polls cannot overwrite a newer destination action.

Postgun uses its media upload, per-integration publish settings, post status,
reschedule and delete endpoints. Immediate posting needs its `posts:publish` scope
in addition to the relevant write scope. Postbridge uses signed uploads without
forwarding its bearer key, one remote post per destination, status polling and
explicit timestamp patches. Clearing a local reservation never sends a null remote
schedule. API secrets reuse the common workspace secret store and never appear in
read responses, agent context, logs or signed-upload headers.

Postbridge's reviewed API does not expose YouTube audience/visibility settings.
Its route requires explicit acceptance of the settings configured in Postbridge;
otherwise choose a route that can set them. Postgun's reviewed YouTube contract
cannot transmit synthetic-media disclosure. YouTube metadata tags over 500
characters are rejected instead of allowing provider truncation. Square/vertical
YouTube uploads up to three minutes are Shorts; longer videos cannot use that format.
Provider/account eligibility and native options can still cause remote rejection.

Contract references: [Postbridge OpenAPI](https://api.post-bridge.com/openapi.json),
[YouTube Shorts](https://support.google.com/youtube/answer/15424877), and the sibling
Postgun source controllers/DTOs examined on 2026-09-26. These are route contracts,
not certification against an authenticated deployed account.

## Attended iPhone sessions

Settings can compile Agentcut's original Swift input bridge or point to an existing
compatible `phonectl`. iPhone Mirroring remains a local macOS dependency; API use
and editing work without Swift. Start an attended session only after queueing the
reviewed payload and identifying its pinned export in Drive or Photos.

The host owns focus, screen capture and input. The existing vision harness receives
only session-bound action/record/abort schemas and exchanges request/response files.
Each run uses a new directory, so resume cannot replay prior request files. Actions
capture before/after screens. The device lease remains held until an in-flight
primitive returns, even if the owner stops the session. Only the approved destination
hashes are accepted. A new run inspects unknown outcomes before any possible resend.

The guide transfers one video for all destinations, checks account identity and
restored drafts, pastes once with a delay, distinguishes the YouTube title from its
description, reads back native schedules and executes the final submit. Completion
requires a captured screenshot and an observed Scheduled/Published result; upload
progress and elapsed time are insufficient. Native IDs stay null when unavailable.
Manual controls and result recording use the same session service. API destinations
can proceed independently of the phone destinations.

The owner can remove screenshots older than the saved retention period from settings.
Active sessions are excluded; delivery facts and immutable video exports remain.
A screen may contain notifications, so screenshots are workspace-managed and served
only through session/evidence IDs rather than arbitrary paths.

## Cadence cutover

Import reads a selected database snapshot or posts JSON, without reading credentials.
Preview maps account and project/video IDs, validates media hashes, and reports missing
sources. Apply saves a local pre-import publication backup, copies a single identified
video into immutable storage, retains original platform settings as provenance and
never sends anything. Review supported destination options before any later delivery.

Stable Cadence post IDs prevent duplicates even if the backup changes location.
Uncertain old drafts become Unknown, including the previously observed native-phone
schedule/local-draft discrepancy. Known remote facts survive. Untouched imported
records can be removed with scoped rollback; modified records block rollback.
Nothing in local rollback cancels already existing remote schedules. Stop Cadence
sending imported work when Agentcut becomes the authority. No bidirectional sync.

## Acceptance record

- Domain/contract tests cover inheritance, DST, batch collision, export tampering,
  optimistic conflicts, source-free videos, exact grants, partial recovery, unknown
  network results, phone evidence/lease rules, range projection, idempotent import,
  artifact migration/rollback and both API upload/schedule/move/cancel contracts.
- Render acceptance exports a real video, inspects a frame, changes the timeline and
  confirms the original pinned bytes remain unchanged. Render is never Published.
- Isolated browser acceptance saves copy, approves the video, pins an actual render,
  saves its phone source and opens monthly/mobile Calendar without page errors or
  horizontal overflow. It performs no social submission.
- Repository checks on 2026-09-26: `pnpm test` passed 538 tests;
  `pnpm test:render` passed 36 tests; `pnpm exec tsc --noEmit` passed.
  The publishing suite accounts for 20 domain/contract tests plus one real-render test.
- Still required: an owner-selected live video/account/time and attended iPhone test
  through native submission and verification; controlled authenticated checks on the
  actual Postgun/Postbridge connections. No real social post has been submitted as
  part of this implementation session. Do not mark these acceptance gates passed.
