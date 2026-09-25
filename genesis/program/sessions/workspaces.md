# Isolated work sessions

Each coding task can use a recoverable source workspace that is isolated from
the canonical project and from other sessions.

## Sources

- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-sessions/src/server/sessionRenewal.js`
- `packages/vibe64-runtime/src/server/runtime.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `tests/server/assistantRoutingStateInventory.unit.test.js`
- `tests/server/vibe64SessionStorageLifecycle.unit.test.js`
- `packages/vibe64-terminals/src/server/sessionSource.js`
- `src/components/studio/vibe64-session/Vibe64WorkflowSelector.vue`
- `src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue`
- `src/components/studio/vibe64-session/Vibe64SessionToolbar.vue`
- `src/components/studio/Vibe64SessionPanel.vue`
- `src/lib/vibe64SessionInfo.js`
- `src/lib/vibe64SessionTooltip.js`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/composables/useArchivedVibe64Sessions.js`
- `src/composables/useVibe64SessionRenewal.js`
- `src/composables/useVibe64SessionRepositoryStatusRegistry.js`
- `src/composables/useVibe64SessionData.js`
- `src/composables/useVibe64SessionDialogs.js`

## Public contract

Each session owns a `drop-zone` directory alongside its runtime records, outside
its repository. New sessions and renewal successors start with an empty exchange.
Ordinary session archives and prepared renewal snapshots omit it. Failed archive
publication retains the closing session's exchange; successful publication removes
it, including when the remaining closing tree is retained for lifecycle work.
Project archival also excludes these temporary exchanges. New mutations are
rejected once closing begins; an admitted upload finishes under the mutation
lease before archival can detach the session tree.


People can create, select, inspect, and archive sessions. A new session receives
its own Git source and stable identity. Creation starts in Plan with review off.
The workflow picker previews the submitting user's Plan and Code destinations;
owner configuration opens in the same overlay. Accounts initializes only missing
roles as part of explicit creation. The central resolver chooses the user's
accessible Plan destination before creating the workspace, and its credential
identity is checked again. Native selection and the intended workflow are stored
separately, including when a member starts on another orchestrator's Shared backup.
The optional hosted branch choice is independent of that AI workflow and both
choices survive creation. Opening a pull request as a session keeps the selected
workflow and uses the PR head, without offering a second branch destination.
Its conversation, source location,
agent activity, workspace preparation, and repository status remain available
across UI refreshes. Archiving stops active work, removes its active workspace,
and preserves the read-only history needed to recover its conversation and
understand what happened. Session History reads lightweight archive indexes and
shows the most recently archived session first.

Routine session-detail refreshes read session and agent state without launching
Git source inspections. Source operations retain their explicit health checks;
chat updates do not need a new managed Git process to report activity.
Live OpenCode messages and turn activity, like Codex progress, do not reload the
project's session list. Routing progress refreshes the affected chat only. Durable
session changes and explicit list-refresh hints still update the session tabs and
creation policy.

Archive confirmation immediately selects the preceding available tab and leaves
the requested session gray and unavailable while its existing request runs.
Archive state and feedback belong to the project panel. With no selection, the
empty layout stays usable even when hidden runtimes are retained. Failure
restores the tab without stealing the current selection. A persistent line beneath
the tabs names each closing session, its last reported stage and elapsed time.
It starts immediately, survives reload through the stored operation, and does
not imply that elapsed time proves server activity. Completion removes the
progress line and the existing archive feedback announces the outcome.

Initial session loading stays visible until the session list resolves, including
when the remembered session's runtime mounts first. A mounted runtime alone does
not establish that session creation is unavailable.

The server records `session_archive_operation` before cleanup and uses the
closing marker to reject new work. Preview, active AI turns, and remaining tools
stop before resources and source are removed. Durable stopping, resources, and
source stages let startup resume interrupted archives. A failure retains its
stage and error for explicit retry; source recovery evidence keeps its protection
marker. Startup also finalizes interrupted archive publication from the immutable
closing tree. Start, each durable stage transition, completion, and failure publish `vibe64.session.changed` to
all clients with a list-refresh hint. Reconnecting clients read persisted state.

The session service exposes optional `setArchivePreparation(callback)` for host
preparation after terminal shutdown, under the existing agent-write lock and
before the next resource/source archive step. Every attempt invokes it, including
resumption at a later durable phase, so the callback must be idempotent and handle
already-removed source. Throwing or returning `ok: false` preserves the existing
archive failure/retry behavior. There is no default callback or maintenance policy.
This callback belongs to ordinary archival; renewal retains its own transaction.

The store's explicit `withArchivedSession(sessionId, operation)` serializes with
archive publication, rejects remaining active/closing trees, validates the
published archive and its archived status, and supplies full saved session
metadata plus temporary recovery paths. Extraction is removed after success or
failure. A scoped batch artifact publication capability copies verified regular
files into the extraction, validates and syncs a compressed replacement, and
publishes it atomically under the already-held archive lock. Hosts can preserve
native-only chat text in the canonical archive before provider retirement.
The archive's metadata, messages, index and original archival time stay unchanged.
This is an archive access boundary,
not proof of native-provider ownership, writer shutdown, transcript completeness,
or permission to delete provider history. Consumers retain those responsibilities.
The API contract and retry constraints are in `docs/session-storage-lifecycle.md`.
Explicit attachment expiry uses that same finalized archive boundary. It builds
and validates a compressed replacement, keeps text, descriptions and other
artifacts, requires host confirmation, then publishes with one atomic rename.
The archive index and original archival date remain unchanged. No automatic
expiry policy or timer is installed.
Exact-path artifact expiry reuses the same publication owner and confirmation
boundary; hosts choose recovery files while retaining permanent text artifacts.

The chat header shares its available width among up to three session tabs,
reserving extra room for the selected tab's Archive action. The new-session
plus is hidden when those visible slots are full and returns when a slot opens.
The standalone shell places that same creation button beside the project name,
including with no open sessions. Only the selected runtime, or the empty state,
supplies it. Hosted shells keep their existing placement. The relocation retains
creation permissions, pending feedback, the assistant dialog and the three-session
limit; compact Git controls leave space for the button on small screens.
Save sits directly beside the session actions so the tabs retain that space.
Each tab shows a basic-info tooltip after one second of hover or keyboard focus,
including its full name, status, assistant and model when available, save state, identifier,
branch, and creation time. A touch-visible info button opens the same tooltip
without selecting or archiving the session. This uses the loaded session data
and does not fetch or poll for details.
Selecting a tab dismisses its tooltip and suppresses automatic hover/focus
opening until the pointer leaves and enters that tab again from outside. The
panel shares click suppression across its retained session toolbars; revealing
a toolbar under a stationary pointer does not reset it. Hidden toolbars dismiss
their details and cannot open pending tooltips. A new keyboard-visible focus also
reenables the tooltip, while mouse-induced focus does not; the explicit info
button still works.

Renewal creates a fresh native assistant conversation. Its review step uses the
same workflow picker as creation, initially selecting the previous workflow when
available. Confirmation resolves its Plan destination for the confirming actor
before stopping the old session. It saves that native selection and the intended
workflow with Plan/review-off preferences in the durable renewal record. Successor
creation and replacement retries retain both values. Explicit API model choices
become Plan overrides in their chosen workflow. If the predecessor's model is
inaccessible or fails while preparing the draft, renewal presents the canonical editable
handover template so the person can still leave that provider. The fresh
provider history is the handover boundary: after it accepts the exact handover
prompt as its first turn, Vibe64 archives the predecessor and exposes the
successor even when authentication, quota, transport, or model execution
prevents an assistant reply. A failure before prompt admission, a reused
conversation, a changed source, or an unusable workspace still leaves the
predecessor available.

Every failed renewal exposes explicit Retry, including persisted failures whose
old error record says `retryable: false`. The renewal controller owns recovery
from the saved stage and rechecks its current prerequisites; an error flag does
not permanently remove that action. Unsaved or outdated source remains blocked
until Save or Update resolves it. A provider quota failure during generation
then reaches the existing editable manual handover and successor AI selection.
Ordinary Archive checks private renewal reservations under the predecessor's
agent-write lock before stopping tools or releasing resources. A pending or
activating successor keeps its predecessor visible and returns a Retry instruction;
archiving cannot leave a hidden successor as the project's only reserved session.
Before removing source, archive restores the checkpoint bundle into a temporary
repository and compares every checkpoint name and commit in one Git read. A
failed verification command is reported separately from a ref mismatch; both
preserve the original source for Retry.

The repository authority check supplies the handover's source identity from
project configuration and the verified Git commit. Renewal does not infer it
from legacy predecessor metadata or default a missing authority to local source.
An optional hosted `repository_branch` binding chooses a verified branch at
session creation. It survives renewal and archive indexing without changing
database ownership, preparation or session admission limits. Existing sessions
without it keep their current project authority; no cached source branch is
promoted into a new binding. PR metadata takes precedence over this binding.
The server-resolved PR source is an explicit session authority and survives
renewal and archive indexing. A new PR session clones its head commit and gives
the assistant the description as quoted background data on its opening turn.
Unchanged retries reuse the exact approved handover. When source identity or
conversation changes before confirmation or after a failure, renewal retains
the existing text, refreshes only its canonical source fields, and returns it
for review without another AI generation. A stale review cannot create a
successor until the person confirms the refreshed draft.

Repository status uses realtime changes as its primary signal and a bounded
freshness check as fallback. The fallback does no work while the page is hidden
and refreshes immediately when the person returns. Session-renewal recovery
also slows its checks when maintenance needs operator attention rather than
retrying continuously.
