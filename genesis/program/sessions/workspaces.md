# Isolated work sessions

Each coding task can use a recoverable source workspace that is isolated from
the canonical project and from other sessions.

## Sources

- `packages/vibe64-sessions/src/server/actions.js`
- `packages/vibe64-sessions/src/server/inputSchemas.js`
- `packages/vibe64-sessions/src/server/assistantContracts.js`
- `packages/vibe64-core/src/server/actionContext.js`

- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-sessions/src/server/sessionRenewal.js`
- `packages/vibe64-runtime/src/server/runtime.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `tests/server/vibe64Runtime.unit.test.js`
- `tests/server/vibe64SessionStore.unit.test.js`
- `tests/server/assistantRoutingStateInventory.unit.test.js`
- `tests/server/vibe64SessionStorageLifecycle.unit.test.js`
- `packages/vibe64-terminals/src/server/sessionNaming.js`
- `packages/vibe64-terminals/src/server/sessionNamingHelper.js`
- `packages/vibe64-terminals/src/server/agentSessionCommand.js`
- `tests/server/sessionNaming.unit.test.js`
- `tests/server/sessionRename.unit.test.js`
- `tests/e2e/session-naming.spec.ts`
- `src/components/studio/vibe64-session/Vibe64RenameSessionDialog.vue`
- `packages/vibe64-terminals/src/server/sessionSource.js`
- `packages/vibe64-terminals/src/server/projectStackInspection.js`
- `src/components/studio/vibe64-session/Vibe64WorkflowSelector.vue`
- `src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue`
- `src/components/studio/vibe64-session/Vibe64SessionToolbar.vue`
- `src/composables/useVibe64SessionPanel.js`
- `src/lib/vibe64SessionPanelModel.js`
- `tests/client/vibe64SessionPanelModel.vitest.js`
- `tests/client/useVibe64SessionPanel.vitest.js`
- `src/composables/useVibe64SessionRuntimeHost.js`
- `src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue`
- `src/components/studio/Vibe64SessionPanel.vue`
- `src/components/studio/Vibe64UnavailableSessions.vue`
- `src/lib/vibe64SessionInfo.js`
- `src/lib/vibe64SessionTooltip.js`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/composables/useArchivedVibe64Sessions.js`
- `src/composables/useVibe64SessionRenewal.js`
- `src/composables/useVibe64SessionRepositoryStatusRegistry.js`
- `src/composables/useVibe64SessionData.js`
- `src/composables/useVibe64SessionDialogs.js`
- `src/composables/useVibe64SessionSelection.js`
- `src/composables/useStoredSelection.js`
- `src/lib/vibe64CurrentSessionPublisher.js`
- `tests/client/vibe64SessionCreateUi.vitest.js`
- `tests/client/vibe64SessionSelection.vitest.js`
- `tests/client/vibe64SessionCreation.vitest.js`
- `tests/client/useVibe64SessionData.vitest.js`
- `tests/client/useVibe64SessionDialogs.vitest.js`

## Public contract

Session URL selection initializes the current session and follows subsequent
navigation. Available-session reconciliation preserves a newer explicit tab
selection instead of repeatedly restoring the session from the earlier URL.

The mounted runtime respects an explicitly empty navigation projection in both
the session toolbar and dashboard. Only an omitted projection uses the full
session list. Navigation does not mutate the authoritative session collection,
cancel its work, or replace the runtime's exact selected-session identity.

The existing panel supports an optional Working/Learning purpose filter for
navigation and visible selected-session projection. Missing historical purpose
reads as Working without a state write. The original full canonical session
collection still governs mounted runtime retention, repository observation and
pruning; a filtered toolbar cannot unmount hidden work or erase drafts. A
wrong-purpose selected session is hidden without changing the original selection
or automatically selecting another identity. Omitted filters retain the original
behavior. This is a presentation prerequisite, not Training admission or completed
host mode/selection integration; there is one original panel, no alternate runtime.

The optional Learning resource contributes its canonical API-returned own learner
and safe saved session summaries to the same original Data collection. The
purpose filter changes navigation and reconciliation, never the full collection.
Two instances of the same original selection owner remember Working per project
and Learning per actual learner. Learning uses no storage while identity is
unconfirmed; it does not reuse Working selection or create an attempt-specific
picker memory. Existing Working URL priority remains unchanged while hidden.
Transient Learning read failures retain confirmed rows and fence new selection
and shortcut writes. Revoked access removes that learner's rows. Conflicting
Working/Learning identities report an error and retain the previous collection
only within the same project and learner; actor/project changes cannot inherit it.

The original Working sessions API path stays project-scoped. The visible Learning
selection uses its saved attempt under the same registered sessions/current
suffix. Working creation captures its original path, query and selector before
awaiting, so changing the visible filter cannot retarget its completion. The same
current-session publisher serializes all writes; configured Learning composition
coalesces only each path's latest pending selection so another scope cannot erase
its update. Omitted or false opt-in retains original global latest coalescing,
deduplication and disposal. Direct concurrent commands are unsuitable: the shared
command owner refuses a second run while busy. A configured full-list refresh
uses both original resources, with Working read only for an actual project.
Separate original Working and Learning load errors support retained keyed hosts.
The original archive dialog accepts an explicit optional eligibility gate; Data
disallows a Learning target without falsely marking its actual lifecycle archived.
Ordinary New session, renewal and archive are not lesson operations. These client
owner checks do not prove visible host mode controls, native teaching or browser
acceptance.

Session and temporary-conversation actions resolve their project and acting user
through the shared action boundary. The acting user is trusted context, never
an action argument. HTTP URL selection and explicit action selection must agree;
automation enters the same project context as HTTP. Hosts recheck authentication
and project access before each execution. Ordinary product handlers must invoke
their owning action; custom transports may retain their transport adapter.
Session actions validate complete operation arguments in create mode after the
HTTP adapter has combined route IDs with body/query fields. Patch transport
validation cannot make a required action target or guard optional.
The assistant capability catalogue is the exception to project scope: it uses
current actor access and does not need a project or coding session. Both the
existing session picker and the global Colleague picker call that same action.

Session creation is available through that same action to the product operator.
Its result reports the actual session identity and workspace preparation state;
starting preparation does not claim that the session is ready. The ordinary
source, resource, database-policy and assistant-access checks still apply.
The creation dialog uses its existing pending state to prevent outside-click,
Escape, Close and Cancel dismissal until creation succeeds or fails. Success
closes the dialog; failure leaves the selection available for retry or dismissal.

Session listing projects saved agent-run activity and its session revision into
`agentActivity`; unreadable activity remains unknown. The session-data owner
applies newer turn events to every listed session and refreshes on reconnect.
These project-scoped updates cannot be replaced by older responses or events.
Mounted runtimes still supply live conversation activity, and each toolbar
preserves other sessions' activity. Tabs therefore pulse even before being
visited and stop when their assistant finishes, without preparing unopened
chats or loading their conversation history.

The session inspection tool reports actual native turn activity and phase,
including its run identity and current routing status/mode. Main conversation
reading exposes up to six canonical turns per tool result, with bounded text,
explicit truncation and an older-page cursor. Neither result exposes private
provider bindings or raw session metadata. HTTP retains its existing full result
contract; these are action-owned assistant projections.
Open and archived session discovery expose sixty-item assistant pages using
`sessionOffset` and `nextSessionOffset`, with the complete session count and a
separate unavailable count. Native list order is preserved; new work or archives
can change pages between reads. Archived summaries include their archival time.
Ordinary action/HTTP results retain the full native lists. These are read-only
projections, with current project authority checked on every page.

Main Send/Steer and Stop are exposed through their existing named operations.
Send keeps the supplied message identity for normal retry behavior and returns
bounded admission/turn/routing facts; acceptance is not a completed response.
Stop affects that coding conversation, independently of Colleague and speech.
Required Main message and session identities are validated by the action's full
input contract, including for HTTP requests, before the service is entered.


Open-session and archive lists report unsupported runtime records and unexpectedly
missing open checkouts separately from usable sessions. The existing summary
reader can include these diagnostic entries for presentation; operational lists
retain only usable entries. Known source-creation failures and in-progress archive
operations keep their existing recovery paths. The UI retains an attention notice
with Check again and copyable project/session identifiers, paths and recovery
guidance for an administrator. A successful refreshed inspection clears a resolved
issue. Reads do not repair, migrate or delete anything, and these unavailable
records never become chat or Preview targets through the notice.

`inspectCanonicalProjectStack` is a neutral saved-source inspection capability.
Its caller holds the existing project source lock. It reuses ordinary Add session
source selection, resolves the configured branch to an exact commit, and returns
normalized Stack components plus repository/branch/commit/check-time evidence.
GitHub is freshly checked through the existing credential and command boundary;
mirror objects never replace that authority. No assistant session or full working
checkout is created. Only ordinary current-format Genesis Stack inputs are
materialized, bounded to 128 files and 1 MiB, and removed in `finally`. Git object
transfers use the normal repository machinery and command timeouts; that input
limit is not a quota on Git pack downloads. A caller owns interrupted scratch
cleanup. This capability adds no automatic maintenance or retention policy to
standalone Vibe64.


Each session owns a `drop-zone` directory alongside its runtime records, outside
its repository. New sessions and renewal successors start with an empty exchange.
Ordinary session archives and prepared renewal snapshots omit it. Failed archive
publication retains the closing session's exchange; successful publication removes
it, including when the remaining closing tree is retained for lifecycle work.
Project archival also excludes these temporary exchanges. New mutations are
rejected once closing begins; an admitted upload finishes under the mutation
lease before archival can detach the session tree.


People can create, select, inspect, and archive sessions. A new session receives
its own Git source and stable identity. Creation starts in Senior with review off.
Colleague can also rename, archive and retry preparation through those same
session actions and their current access checks. Its result projection contains
bounded session identity, lifecycle and preparation status rather than private
paths, metadata or logs. An accepted preparation retry does not mean it finished.
The workflow picker previews the submitting user's Senior and Junior destinations;
it reads saved assignments and connection access without live model discovery.
Uninitialized workflows use connected defaults to establish availability and say
“Recommended on creation”; creation discovers and saves the exact recommendations.
The picker shares the runtime's access and paired-backup rules, while creation
and dispatch still validate the destination against its current model catalogue.
Owner configuration opens in the same overlay. Accounts initializes only missing
roles as part of explicit creation. The central resolver chooses the user's
accessible Senior destination before creating the workspace, and its credential
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
Archived session detail reads the retained record and chat without asking a
native provider for live state; its source and native conversation can be gone.
Saved attachment reads likewise use the archive, without requiring a source
workspace. Expired payloads return 410 while their descriptions remain readable.

Routine session-detail refreshes read session and agent state without launching
Git source inspections. Source operations retain their explicit health checks;
chat updates do not need a new managed Git process to report activity.
Already visited sessions keep their runtime hosts mounted under `v-show`.
Selecting one no longer reloads conversation history or unconditionally reconciles
its provider. Actor-scoped assistant-access and model-routing resources remain
subscribed while their host is hidden, so selection does not re-enable their
queries. Archive state and actor identity still govern those resources.
Confirmed repository checks are reused across selection; first checks, explicit
Refresh, source/canonical changes and bounded checks for out-of-band Git work
remain. The assistant connection owner separately prepares an unverified provider
after first loading, a real reconnection or an assistant-configuration change.
An admitted internal creator can supply a server-reserved session ID and optional
verified complete Git commit through the service's second options argument.
HTTP/action inputs cannot select that ID or internal commit. A commit requires
the reserved ID and excludes caller branch/PR selections. Under the original
project policy lock, the store must prove creation state absent before any new
session metadata is written; missing authority or retained lifecycle evidence
refuses creation. The commit enters the existing source context, whose original
source owner materializes that exact object under its source lock after the
caller releases any earlier proof lock. The service still owns
actor, capacity, source preparation and publication policy. Setup or publication
failure does not falsify a session already saved. This seam alone adds no learner
start control or training operation.

The same `createSession` also accepts the existing Project runtime for a trusted
server learning context. It requires a reserved internal ID and refuses branch,
PR, commit and source options before source resolution. The original trusted
actor, workflow initialization, effective Senior/backup and selected connection
access policy still precede the write. Its one shared metadata body uses the
original fields; Runtime/Store alone creates the immutable learning binding.
After the store's real absence preflight, the original locked staged create owns
atomic publication and duplicate refusal. This branch creates no source,
workspace setup, development database slot or synthetic capacity policy; its
result is the actual public session view without `creation`/`limits` fields.
The common inspect and `session-created` publication sequence remains unchanged,
including truthful retention after inspection/publication failures. Ordinary
source creation retains PR/routing/runtime/policy/source/setup order and its
existing result fields. Browser purpose/scope/ID arguments do not enable learning.
Training must freshly authorize the actor, exact active attempt and installed
no-exercise pin before supplying the context; this internal creation adaptation
does not itself expose Main Learning mode or prove a native teaching trial.

Session text and metadata are replaced atomically, like the store's JSON records.
Concurrent readers see a complete previous or next value during assistant changes;
a failed replacement preserves the saved value. This does not make multiple
metadata files one transaction or change their saved format.

A scoped conversation write may supply captured turn metadata for a new
transcript block. Explicit message metadata and already saved block metadata
take precedence. Temporary native-history reconciliation uses this seam to retain
its request's answering AI and mode without changing the parent session or
rewriting historical attribution. The persisted metadata shape is unchanged.
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
Renewal invokes the same callback after predecessor shutdown and successor
acknowledgement, before source/archive preparation. It supplies `renewal: true`
and the existing renewal artifact reader/writer remains the persistence owner
for its quiesced predecessor. Callback failure uses the renewal rollback/retry
transaction. Successful committed maintenance publishes `session-archived` only
after removing the retained predecessor tree, making finalized archive access
available to embedding hosts.

The store's explicit `withArchivedSession(sessionId, operation)` serializes with
archive publication, rejects remaining active/closing trees, validates the
published archive and its archived status, and supplies full saved session
metadata plus temporary recovery paths. Extraction is removed after success or
failure. A scoped batch artifact publication capability copies verified regular
files into the extraction, validates and syncs a compressed replacement, and
publishes it atomically under the already-held archive lock. Hosts can preserve
native-only chat text in the canonical archive before provider retirement.
The archive's metadata, messages, index and original archival time stay unchanged.
An optional host callback checks capacity before extraction and replacement
compression under the archive lock; refusal preserves the published archive.
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
Session display names use the existing `label` metadata. After accepted delivery,
`createSessionNaming` checks the durable first user message, including rewound
turns, and claims the `session-name` background task once. The workflow's Helper
receives only bounded first-message text through the tool-free `session_title`
profile. Its owned conversation and scratch directory are cleaned through the
same naming lifecycle used by Save. Failed cleanup stays recorded for session
close; closing waits for an in-flight naming task. Subsequent messages and
restarts do not regenerate a name or backfill old chats. Unavailable Helper or
invalid output leaves the existing display name and ordinary chat usable.

Session details offer Rename on desktop and touch. `PATCH /sessions/:sessionId/name`
and `vibe64-helper session rename "Name"` use the store's label mutation and
publish a session-list refresh. The chat command uses the existing managed
session command listener with a separate, rename-only capability, checked against
its bound project, session, and listener generation. It cannot authorize shell
execution. Manual names may contain spaces and have a 120-character limit;
automatic names contain one word of up to 40 characters. The store checks for
an existing label under its mutation lock before applying an automatic name,
so a manual rename wins. IDs, directories, source branches and URLs never move.

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
available. Confirmation resolves its Senior destination for the confirming actor
before stopping the old session. It saves that native selection and the intended
workflow with Senior/review-off preferences in the durable renewal record. Successor
creation and replacement retries retain both values. Explicit API model choices
become Senior overrides in their chosen workflow. If the predecessor's model is
inaccessible or fails while preparing the draft, renewal presents the canonical editable
handover template so the person can still leave that provider. The fresh
provider history is the handover boundary: after it accepts the exact handover
prompt as its first turn, Vibe64 archives the predecessor and exposes the
successor even when authentication, quota, transport, or model execution
prevents an assistant reply. A failure before prompt admission, a reused
conversation, a changed source, or an unusable workspace still leaves the
predecessor available.

A session that has never acquired a Codex runtime can renew through the manual
handover without process-exit evidence for a nonexistent process. Closure still
requires verified shutdown when a cached provider, retained runtime owner,
recorded transport, or native thread exists; a failed stop cannot become an
unused session merely because its provider cache was closed.
After a restart removes runtime metadata, renewal can use the managed execution
owner's verified empty scope, as changeover does. Missing files or an incomplete
owner-drain result alone remain insufficient proof.

The Codex provider acquired for a hidden successor retains its exact renewal
reservation for internal authentication, control restoration and observation
checks. Those callbacks use the existing renewal reader only for that reservation;
normal requests still cannot read the hidden session. A different reservation or
an observation-loss barrier still rejects resume. Once the successor is public,
the callbacks return to ordinary session reads.
Post-commit proof release shares provider lifecycle serialization and retains a
runtime used by any remaining session, including the successor or Colleague.
Releasing the archived participant's proof never stops that shared process.
Hidden-successor cleanup reads and clears retained naming, prompt-suggestion and
database helpers through existing internal renewal store access. That access is
supplied only by validated renewal cleanup; ordinary session, background-task and
artifact reads remain private. Failed native deletion retains the helper's record
and working directory so Retry can finish cleanup without starting inference.

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

Colleague uses these same six renewal actions. Its inspection projection returns
the complete bounded handover and exact draft hash/revision; other operations
return concise status and guard values. Approval targets the reviewed draft and
workflow, and a return to review requires renewed approval. The projection excludes
private renewal basis, provider bindings and actor metadata. Missing or empty
session IDs and missing optimistic guards fail at the canonical action boundary.

Repository status uses realtime changes as its primary signal and a bounded
freshness check as fallback. The fallback does no work while the page is hidden
and refreshes immediately when the person returns. Session-renewal recovery
also slows its checks when maintenance needs operator attention rather than
retrying continuously.

## Source-less learning session foundation

`@local/vibe64-sessions/server/routes` exposes the original route registrar for
host composition. Its explicit `learningScoped:true` option reuses the original
HTTP validators, limits, input builders and responses under
`/api/learning/:learningAttemptId/vibe64`. The canonical Session action metadata
supplies the only allowlist. The transport binds the URL attempt, strips browser
user fields and retains the original local/hosted request gate. Source/setup/Git,
renewal and other project-only actions are not registered in this namespace.
The normal project route registration remains unchanged. Learning model catalogue
reads use fresh attempt observation authority and the same Session capability
reader; they do not grant access to another person's connections. Actual host
registration and installed/browser acceptance are separate requirements.

The original Store's `paths()` supplies its existing current-session alias owner
with `<private-learning-runtime>/sessions/selected` only for an admitted immutable
learning scope. The original atomic relative `active/<sessionId>` symlink, read,
conflict checks, selection validation and archive/closing clearing run unchanged.
Ordinary source aliases retain their existing path and source requirement. This
is new namespace composition, not a historical data repair. The canonical current
selection action declares control access: selection/clearing retains historical
identity without admitting work. Clearing needs no selected session ID; Stop and
presence still require theirs through the original action schemas, while sending
requires an exact confirmed active lesson/session. Store and canonical action
tests cover independent working selection, foreign binding refusal, missing
records, conflicts and lifecycle cleanup.

Sources: `packages/vibe64-sessions/src/server/registerRoutes.js`,
`packages/vibe64-sessions/src/server/actions.js`,
`tests/server/vibe64ProjectSessionsFeatures.unit.test.js`.

The existing Runtime and Store also accept a constructor-only `learningScope`
containing the authenticated `learnerId`, exact `attemptId`, complete opaque
`pin`, and `noExercise:true`. The composing Training owner must authorize the
actor, active attempt, installed pin and the lesson's genuinely no-exercise
descriptor before constructing this scope and its fixed private runtime root.
Runtime validates bounded identities/JSON shape and exact durable equality; it
does not reimplement Training validation or acquire content authority. Browser
arguments, creation metadata and a mode flag cannot enable this purpose.

Original atomic session staging creates one new immutable `learning_session`
metadata value (`schemaVersion:1`, that scope, `conversationId:sessionId`) and a
private `native` directory inside the original session tree. The existing
`genesis` runtimeKind remains a supported format sentinel, not a claim that this
session has a Genesis project. The new view reports purpose `learning`, companion
Learning, the exact binding, no source and no workspace setup. Ordinary absent
purpose remains working unchanged. Claimed, corrupt, wrong-owner/attempt/pin or
mixed-source bindings fail closed; normal metadata writers cannot alter/remove
that binding or attach source to it.

`getNativeExecutionRoot(sessionId)` reads that original session and permits only
a matching active, non-closing learning session with its original regular, non-aliased
`<runtime>/sessions/active/<sessionId>/native` directory. It never uses an archive
extraction/closing path as a new native cwd. Historical reads retain exact
binding without requiring that old directory to exist; archived views expose no
executable root and execution refuses them. The bounded store
`readSessionNativeDescriptor` reuses metadata/status readers without hydrating
history. For learning it reports the derived original active native identity even
when archived, with its explicit status/archived facts; this is not directory or
execution proof. Ordinary calls retain the original source descriptor exactly. Missing/aliased active directories
are unavailable, not recreated by reads. Source getters/inspection remain
truthful and source operations do not turn this directory into a source checkout.

One constructor-only `learningInstructions(sessionId)` reader is supplied by the
original Training owner. `getLearningInstructions` validates exact active durable
scope before/after awaiting it and returns a bounded nonempty string (the
original Brief128KiB bound). The owner independently refreshes attempt/content
permissions and pin/progress, without truncating or substituting project guidance.
Learning `renderPrompt` returns the actual normalized user request; it does not
read project Env, invoke Genesis or pretend the native cwd is project source.
Ordinary prompt rendering is unchanged.

This is a genuinely new optional explicitly admitted binding, not a changed
historical format or conversion: no prior working session or Colleague-teacher
history is inferred, migrated or lazily repaired. Future changes to existing
bindings require the numbered stopped-writer upgrade procedure. The same
original store leases, transcript, status and archive owners remain. Browser
admission, native provider/environment integration, learning renewal/selection,
teaching evidence and complete learner acceptance are separate unfinished work;
these constructors do not add a launch control or establish Main teaching.


The original session toolbar reads each saved row's purpose. Learning tabs retain
selection, information and supported scoped naming, but omit the unsupported
Working Archive action and source branch/repository status claims. Historical rows
with no purpose and explicit Working rows preserve their existing controls and
accessible status. This presentation does not introduce a Learning archive owner
or prove complete lesson controls, teacher admission or installed geometry.
The original Rename dialog captures the chosen saved row's own Learning attempt
path; Working rows use the original Working path exposed by the same Data/Host.
The currently selected attempt cannot retarget the named conversation.
