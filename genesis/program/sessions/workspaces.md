# Isolated work sessions

Each coding task can use a recoverable source workspace that is isolated from
the canonical project and from other sessions.

Main and temporary browser conversations request pages of ten real messages.
JSKIT's transcript reader counts a user request and an assistant answer separately;
reasoning and commentary remain visible without consuming this allowance. Its
opaque next-page cursor can split a stored turn, and browser page merging restores
that turn without dropping either half. No saved history is rewritten.

## Sources

- `packages/vibe64-sessions/src/server/actions.js`
- `packages/vibe64-sessions/src/server/inputSchemas.js`
- `packages/vibe64-sessions/src/server/inputPatterns.js`
- `packages/vibe64-sessions/src/server/assistantContracts.js`
- `packages/vibe64-core/src/server/actionContext.js`
- `packages/vibe64-core/src/server/projectState.js`

- Main: `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-sessions/src/server/sessionArchive.js`
- `packages/vibe64-sessions/src/server/Vibe64SessionsProvider.js`
- `packages/vibe64-sessions/src/server/connectedContributions.js`
- `packages/vibe64-sessions/src/server/sessionResults.js`
- `packages/vibe64-sessions/src/server/sessionRenewal.js`
- `src/components/studio/vibe64-session/Vibe64ConnectedReplacement.vue`
- `packages/vibe64-runtime/src/server/runtime.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `packages/vibe64-runtime/src/server/sessionLocks.js`
- `tests/server/vibe64Runtime.unit.test.js`
- `tests/server/vibe64SessionStore.unit.test.js`
- `tests/server/assistantRoutingStateInventory.unit.test.js`
- `tests/server/vibe64SessionStorageLifecycle.unit.test.js`
- `tests/server/vibe64SessionArchiveFailures.unit.test.js`
- `packages/vibe64-terminals/src/server/sessionNaming.js`
- `packages/vibe64-terminals/src/server/agentHelperCommand.js`
- `server/lib/agentSpecCli.js`
- `packages/vibe64-genesis/src/server/agentSpecs.js`
- `packages/vibe64-terminals/src/server/agentSpecs.js`
- `packages/vibe64-source-editor/src/server/agentSpecs.js`
- `tests/server/vibe64AgentSpecs.unit.test.js`
- `packages/vibe64-terminals/src/server/assistantHelperTurn.js`
- `packages/vibe64-terminals/src/server/agentSessionCommand.js`
- `tests/server/sessionNaming.unit.test.js`
- `tests/server/sessionRename.unit.test.js`
- `tests/e2e/session-naming.spec.ts`
- `src/components/studio/vibe64-session/Vibe64RenameSessionDialog.vue`
- `packages/vibe64-terminals/src/server/sessionSource.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-terminals/src/server/sessionGitCommandActor.js`
- `packages/vibe64-terminals/src/server/projectStackInspection.js`
- `src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue`
- `src/components/studio/vibe64-session/Vibe64SessionToolbar.vue`
- `src/components/studio/vibe64-session/Vibe64SessionArchiveDialog.vue`
- `src/composables/useVibe64SessionPanel.js`
- `src/lib/vibe64SessionRepositoryWorkState.js`
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
- `src/composables/useArchivedVibe64ConversationHistory.js`
- `src/composables/useVibe64SessionRenewal.js`
- `src/composables/useVibe64SessionRepositoryStatusRegistry.js`
- `src/composables/useVibe64SessionData.js`
- `src/composables/useVibe64SessionDialogs.js`
- `src/lib/vibe64SessionArchiveState.js`
- `src/composables/useVibe64SessionSelection.js`
- `src/composables/useStoredSelection.js`
- `src/lib/vibe64CurrentSessionPublisher.js`
- `tests/client/vibe64SessionCreateUi.vitest.js`
- `tests/client/vibe64SessionSelection.vitest.js`
- `tests/client/vibe64SessionCreation.vitest.js`
- `tests/client/useVibe64SessionData.vitest.js`
- `tests/client/useVibe64SessionDialogs.vitest.js`
- `tests/client/vibe64SessionArchiveState.vitest.js`

## Public contract

Connected source creation records the trusted creating user's Git actor through
the existing post-attachment actor owner, as PR source creation already does.
It reloads the newly attached session and uses its exact source path; replacement
contributions follow the same path. Contribution inspection can therefore reuse
that actor before any conversation opens, retaining ordinary access checks.
Inspection does not repair or invent actor metadata.

Connected contribution sessions distinguish their published incoming ref from
the receiving integration target. Once the current incoming head is integrated,
the existing explicit Update operation consumes the accepted target through its
normal checkpoint, conflict and preparation lifecycle. Save retains the incoming
destination and leases that exact observed published head. Internal connected
inspection reads that ref with receiving credentials, without another mutation
lock, and requires it in the selected source's history before reporting publication.
Neither updated canonical metadata nor a replaced Save task can masquerade as a
newly published contribution. Main Save's exact submitted-revision check also
requires the accepted target in the freshly authorized connected source HEAD;
missing or stale source evidence requires explicit Update, never an automatic rebase.
Read-only inspection may use a sole discarded head, or an exact existing Save
confirmation/originating submission after deletion, only with target-ancestry proof.
Update can consume that accepted target; publication still refuses removed refs.
Both active and discarded refs remain an unresolved discard, and absent refs with
unconfirmed prepared publication retain their original recovery block.

Source creation refuses any existing destination before preparing a Git baseline
or refreshing a mirror. An existing checkout, including one left unattached by
an interrupted attempt, is recovery work, not permission to reset its branch.
Contribution preparation must reuse the existing session through its lifecycle
owner; calling source creation again cannot replace commits, staging or files.

Internal contribution creation uses the ordinary Sessions admission and Runtime
source lifecycle with a reserved identity and exact base commit. Its new
`connected_contribution` metadata binds the receiving repository, integration
branch, base commit and random contribution ID before source creation. Core's
existing repository resolver clones the integration branch for preparation but
selects `vibe64-incoming/<id>` for publication. Invalid metadata, a changed
repository/target or mixed branch/PR authority refuses rather than falling back
to main. Renewal retains this binding. Preparation creates no remote branch.
Client-supplied creation arguments cannot grant contribution authority.

Explicit connected preparation allocates these sessions through the receiving
owner. Contribution publication and the retained-revision Main Save gate reuse
the original Git owner. Ordinary workspace preparation calls the same connected
preparation owner, then Project materializes its authorized per-session source
selection for the declared preparation recipe. Connected-first Save publishes
those owned contributions sequentially and leaves the main push to a separate
action.

Connected projects are prepared concurrently: each target resolves its receiving
source, reserves its binding and allocates its session independently. Binding
reservations are written one at a time, each containing every binding reserved
so far. Results are still evaluated in target order, so the first failing
repository is reported and earlier prepared sources are retained. The receiving
source reads only its integration branch from GitHub, not the full branch list.

Allocation also carries the originating session's display name (its label, or
its identity). The receiving session takes it as its label and records it as
`connected_session_name`; later allocations update the label only while it still
equals that recorded value, so a person's own rename is kept.

Every new connected binding reserves a fresh contribution UUID. Its receiving
session starts without the origin's connected-source or submission metadata;
receiving allocation does not recursively prepare more connections. Explicitly
preparing a receiver creates its own fresh child contributions. Repository-level
cycles therefore create distinct descendants, never a requirement edge back to
an existing ancestor. Retry reuses the reserved child; replacement creates a new
child and renewal preserves the existing logical contribution. No supported
operation attaches an arbitrary existing contribution as a dependency. Any
future operation allowing that attachment must check contribution cycles before
persisting the edge; renewal-chain cycle checks protect a different lifecycle.

Archiving one session remains local to its existing lifecycle owner. Connected
bindings and submitted revisions remain in the full archive metadata, while
commits, dirty patches and untracked files use the existing source-recovery
artifacts. Neither child checkouts nor incoming refs are removed by originating
session archival. A receiving contribution archived without a renewal successor
is unavailable for connected preparation and Save; it is not silently replaced.
Source recovery is explicit through the existing archive facilities.
Sources: `packages/vibe64-core/src/server/projectRepository.js`, the original
Sessions/Runtime/source owners above, and focused contribution cases in
`tests/server/githubPullRequests.unit.test.js`,
`tests/server/vibe64SessionsDirect.unit.test.js`,
`tests/server/vibe64SessionSourceGit.unit.test.js` and the Runtime test file.

Archiving never Saves. The archive confirmation receives the archived session's
repository work state from the panel's session list. Unsaved work, such as an
applied starter, is named with its change count and the confirm action reads
Archive without saving; an unconfirmed state says the work is not known to be
saved. Either way that work stays only in the source-recovery artifacts, which
the archived-session view cannot restore to the project, and a new session
starts from saved canonical source.

The Store retains its existing filesystem creation lock through Runtime source
initialization, outside the publication mutation queue so ordinary metadata
writes can finish. Session lists omit records whose creation lock still has a
live or unconfirmed owner. Success and recorded creation failure release the
lock and expose the original result; an abandoned lock does not hide a missing
checkout after interruption. No new persisted status or read-time repair is used.

Session URL selection initializes the current session and follows subsequent
navigation. Available-session reconciliation preserves a newer explicit tab
selection instead of repeatedly restoring the session from the earlier URL.

The session collection's existing completed-renewal reconciliation selects the
exact unique `renewed_from` successor, then replaces only the predecessor URL's
`session` query. It retains the path, hash and all other query fields. This owner
also handles a successor already selected by refresh: selection may deactivate
the predecessor runtime host before its dialog callback, so the host does not
own this URL synchronization. Ordinary tab selection still leaves the URL
unchanged. A temporary router guard checks the same confirmed renewal and exact
unique successor, current Working selection, project/API, original predecessor
URL and collection lifetime before committing navigation; it is always removed
on settlement. A newer explicit selection, project or route, disposal, ambiguous
or unconfirmed renewal cannot retarget the link. The original runtime-host
renewal selection callback and controller fences are unchanged.

The mounted runtime respects an explicitly empty navigation projection in both
the session toolbar and dashboard. Only an omitted projection uses the full
session list. Navigation does not mutate the authoritative session collection,
cancel its work, or replace the runtime's exact selected-session identity.

The panel lists, retains and selects only the project's own sessions through its project-scoped sessions
API; one load error covers its hosts. Ordinary New session, renewal and archive
are not lesson operations.

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
paths, metadata or logs. Its archive tool directs it to inspect saved-work status
first and, when work is unsaved or unconfirmed, to report the count, offer Save
and archive only after the user confirms archiving without saving; this is
Colleague guidance, not a server guard. An accepted preparation retry does not mean it finished.
Retry consults the existing preparation owner's current readiness when the stored
attempt succeeded, allowing changed recipes or resources through the same admission
guard. A still-current or unconfirmed success cannot be rerun through that path.
The creation dialog names the main AI that main chat runs on, the owner setup's
Senior, with a separate **Change main AI for all sessions** link to AI setup;
without one it offers AI account management and creation stays disabled. It
reads saved assignments without live model discovery. For whoever manages AI
(the main view's `canConfigure`), **Change** opens the chat's Custom picker for
this one session and loads its choices only then; creation sends that applied
selection as `assistantSelection`, resolved against the same live catalogue as
Custom's Apply, and the new chat starts Custom. Applying main chat's own model,
**Use main AI** or reopening the dialog keeps the main AI. Accounts initializes only missing roles as part of explicit
creation. The central resolver chooses the owner's accessible Senior destination
before creating the workspace, and its credential identity is checked again.
A team member cannot choose main chat's model: outside a lesson their session
records main chat's starting model only, and nothing runs as them. Learning
requests Junior, and an unavailable destination fails before session creation,
preserving an already reserved lesson attempt for its existing Resume path.
There is no Training-specific routing fork. The optional hosted branch choice is
independent of that AI choice and both survive creation. Opening a pull request
as a session uses the PR head, without offering a second branch destination.
Its conversation, source location,
agent activity, workspace preparation, and repository status remain available
across UI refreshes. Archiving stops active work, removes its active workspace,
and preserves the read-only history needed to recover its conversation and
understand what happened. Session History reads lightweight archive indexes and
shows the most recently archived session first.
If archiving fails after clearing the last selection, the original session is
selected again for recovery. A person already viewing another session keeps
that selection; the failed session's tab becomes available again.
Archived session detail reads the retained record and chat without asking a
native provider for live state; its source and native conversation can be gone.
Saved attachment reads likewise use the archive, without requiring a source
workspace. Expired payloads return 410 while their descriptions remain readable.

Routine session-detail refreshes read session and agent state without launching
Git source inspections. Source operations retain their explicit health checks;
chat updates do not need a new managed Git process to report activity.
When a source inspection does run, its unresolved-conflict listing is reused
until that session's `.git/index` file changes: Git records unmerged paths only
in the index and replaces that file on every write.
Both selected-session and toolbar work-status reads allow two minutes for the
sequential authenticated Git checks of connected repositories. Their existing
refresh queues and late-result guards remain authoritative; this per-request
deadline does not change the shared HTTP client's ordinary read timeout.
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
HTTP/action inputs cannot select that ID or internal commit. Every session
action names an existing session with one shared field (1 to 256 characters;
an optional one may be empty) and validates its complete input. A commit requires
the reserved ID and excludes caller branch/PR selections. Under the original
project policy lock, the store must prove creation state absent before any new
session metadata is written; missing authority or retained lifecycle evidence
refuses creation. The commit enters the existing source context, whose original
source owner materializes that exact object under its source lock after the
caller releases any earlier proof lock. The service still owns
actor, capacity, source preparation and publication policy. Setup or publication
failure does not falsify a session already saved. This seam alone adds no learner
start control or training operation.

The same `createSession` keeps a branch for a trusted server learning context
(a reserved internal ID, no raw source/branch/PR choices, Junior start and the
immutable binding created by Runtime/Store). No current route or Training
operation supplies that context: lesson preparation creates its practice
session through the ordinary source path with the ordinary Senior default, and
a lesson without an exercise creates no session. See
[Retained learning session binding](#retained-learning-session-binding).

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

Archive first checks pin and renewal protection under agent-write admission.
Pending Main and temporary routing is cancelled by its existing owner outside
that lock, so its own admission and completion callbacks can finish. The next
archive admission rechecks all guards; a newly replaced request requires Retry.
A stopped request retains its delivery evidence, but no longer blocks archive
once its routing helper and in-process task are cleaned up. Routing cleanup has
a 30-second response deadline; timeout preserves custody and the session for
retry. An already-closing temporary chat allows only routing-cancellation metadata
writes, without reopening it or admitting messages/selection changes.

The server records `session_archive_operation` before cleanup and uses the
closing marker to reject new work. Preview, active AI turns, and remaining tools
stop before resources and source are removed. Cleanup uses the saved session
context when interrupting its assistant,
including a cold manager after restart; cleanup must not default to another
engine merely because the conversation has not been opened in this process.
Durable stopping, resources, and source stages let startup resume interrupted
archives. An unreadable or unknown stage is refused with
`vibe64_session_archive_state_invalid` and kept as evidence; startup reports it
for that session and continues resuming the others. A failure retains its
stage and error for explicit retry; source recovery evidence keeps its protection
marker. Startup also finalizes interrupted archive publication from the immutable
closing tree, one session at a time: a session that cannot be published is
reported with its code while the others are published and open archives still
resume. Startup runs archive recovery and then renewal recovery, logs every
reported failure as the operational warning
`vibe64.sessions.recovery.session_failed` with its session and code, and stops
before the next step when the server shuts down. Archive tar work (check,
extraction and staging) keeps a refusal from the execution owner, such as a host
memory refusal, with its code and retryability; only tar's own failure reports
`vibe64_session_archive_invalid` for a check or
`vibe64_session_archive_read_failed` for an extraction.
Start, each durable stage transition, completion, and failure publish `vibe64.session.changed` to
all clients with a list-refresh hint. Reconnecting clients read persisted state.

Archive lives in Sessions' archive module, one function per durable phase;
connected-source orchestration lives in its connected-contributions module.
Both are composed into the one session service, as renewal is.

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

`vibe64-helper spec [<name>]` prints the exact contracts a coding agent
implements: every Stack section Vibe64 interprets, the Preview identity command
protocol, the managed app identity list, the integration setup command and the
teaching content format. It runs the release's `vibe64 spec` command, which
`bin/run.js` routes to `server/lib/agentSpecCli.js`. That root module only joins
the specs owned by vibe64-genesis, vibe64-terminals and vibe64-source-editor; it
reads no session state and needs no control socket. Without a name it lists the
contracts; an unknown name prints the list and exits 2. Field lists come from the
parsers' own tables, and a focused test parses every printed example.

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

Renewal creates a fresh native assistant conversation. Its review step
initially selects main chat's Senior and can choose another model instead.
Confirmation resolves the destination for the confirming actor before stopping
the old session and saves that native selection with its routing preferences in
the durable renewal record. Successor creation and replacement retries retain
both values. A model other than main chat's own makes the successor's chat Custom. If the predecessor's model is
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
AI choice, and a return to review requires renewed approval. The projection excludes
private renewal basis, provider bindings and actor metadata. Missing or empty
session IDs and missing optimistic guards fail at the canonical action boundary.

Repository status uses realtime changes as its primary signal and a bounded
freshness check as fallback. The fallback does no work while the page is hidden
and refreshes immediately when the person returns. Session-renewal recovery
also slows its checks when maintenance needs operator attention rather than
retrying continuously.

## Retained learning session binding

Learning v2 has no learning-scoped sessions: Colleague teaches every lesson in
its own conversation, a lesson without an exercise creates no session, and a
practice lesson's sessions are ordinary sessions of its practice project. The
numbered `20261022-learning-space-reset` upgrade retires old practice projects
and source-less lesson stores.

The Runtime and Store still accept a constructor-only practice `learningScope`
(`learnerId`, `attemptId`, complete opaque `pin`, `noExercise: false`, with its
actual session source root; the source-less `noExercise: true` scope is
retired) and validate the
immutable `learning_session` metadata (`schemaVersion:1`, that scope,
`conversationId:sessionId`) exactly as before, failing closed on claimed,
corrupt, foreign or mixed-source bindings. This is kept only so that the
published offline upgrades (`20261008-learning-practice-sessions` and
`20261008-learning-practice-history`) can read and verify historical bindings; no current route or host constructs
such a scope, and Project's `createSessionStore()` keeps its ordinary
selected-root requirement for every other store. Sessions' create path keeps
its refusal of source, branch, pull-request and commit options for a
learning-scoped context, which no current request produces.
Sources: `packages/vibe64-runtime/src/server/runtime.js`,
`packages/vibe64-runtime/src/server/sessionStore.js`,
`packages/vibe64-sessions/src/server/service.js`;
evidence: `tests/server/vibe64SessionStore.unit.test.js`,
`tests/server/stateUpgrades.unit.test.js`.

### Saved practice Learning admission

Learning v2 practice projects are ordinary projects and their sessions are
ordinary sessions: no host constructs a `noExercise:false` scope, and session
commands, Git, Preview and Database helpers run in the session's captured
ordinary project request context. The session store still accepts a `noExercise:false` scope with its actual
project session source root only so that the published
`20261008-learning-practice-history` readers and their tests can verify an
adopted historical binding; the store refuses that scope without a source root.
Sources: `packages/vibe64-terminals/src/server/agentSessionCommand.js`,
`packages/vibe64-runtime/src/server/sessionStore.js`.


### Offline historical practice binding

`SessionStore.prepareLearningSessionBindingUpgrade` is a typed offline staging
operation for the exact saved preparation initial session. It reuses the
original active/closing/archive inventory and original metadata reader body,
then applies the existing exact learning binding validator. Normal reads and
immutable binding writes retain their original refusal. The inventory's narrow
optional archive-record hook stages the matching original JSON index alongside
the tar; default existing upgrades are unchanged. Fully published archives
retain their original operation metadata, validated through the original
archive/status/identity boundary. Unfinished live archive or renewal state is
not a conversion shortcut.

The Training owner supplies durable learner/pin/project authority and validates
frozen after references; the original Core publisher verifies backups/hashes
and atomically publishes the prepared set. No ordinary source, native, history
or progress owner is replaced. Original Store and Learner companions preserve
ordinary writer refusal, source/native IDs, archived sidecar/history and actual
Preparation same-session resume; these are source-component proofs, not
multi-machine activation or all-provider acceptance.

The read-only runtime-root inventory and original project-slug validator are
owned by Core `projectState.js`;
`studioProjectContext.js` retains its existing export. Offline upgrades use that
small owner without loading live project execution or Genesis dependencies.


The session path contract also exposes `projectBackupsRoot` under the owning
project's runtime directory. This folder is shared across sessions, is excluded
from session archives by location, and is not removed by renewal or archival.
The Files owner manages its operations; hosted maintenance schedules retention.

## Pinned server-selected source

The session store owns one optional `sessions/pinned` symlink per source project,
using the existing relative active-session alias writer and conflict checks.
An absent pin keeps the original selection behavior; no existing records need
migration. Explicit pin writes update the existing `sessions/selected` source
link. Later browser selection publications retain the pinned target without
changing browser navigation. Session summaries project `pinnedSessionId` from
that single project record. Learning cannot create a source pin.

The existing alias mutation queue serializes pin changes, selection and project
close. Pinning requires an open project and active nonclosing, nonrenewing
session. Archive and renewal refuse the pinned source; moving a session to
closing checks again under the alias queue. Explicit project close holds the
same queue through shutdown and refuses any pin; idle cleanup skips pinned
projects. Idle cleanup reads every open session's goal and temporary-chat state
before closing; a session whose state cannot be read keeps the project open, is
named in the result, and is logged as the operational warning
`vibe64.project_runtime.dormant_close_failed` with the project and session IDs.
A session whose source was never created ran no assistant, so idle cleanup,
project Close and archive skip its assistant checks and shutdown. Daemon shutdown retains its original teardown path. Unpinning is
explicit and never saves or publishes work. Cross-project messages still target
the server-selected session, which is the pinned source while pinned.

The Sessions action and route own authorized pin changes; the pin button beside
Save uses the existing endpoint resource and error feedback, and refreshes the
session after acknowledgement. Another session cannot replace the pin until the
current one is unpinned. Host update cleanliness/origin checks remain independent.
Pin changes take the existing renewal-state and session-mutation boundaries, not
the assistant write lock. Assistant preparation therefore cannot block a pin;
closing rechecks the pin under the same session-mutation boundary before teardown.


## Replace a discarded connected contribution

The originating session's `connected.replacement.inspect` action reauthorizes
its configured receiving repository and reads the exact discarded contribution
through Incoming's existing Git owner. `connected.replace` repeats that review
under ordinary originating source-write admission, reserves a new binding before
allocation, then calls ordinary connected preparation. Retry reuses that binding.
Old receiving sessions and `connected_submissions` are preserved. The new binding's
optional `replaces` UUID identifies its predecessor; its base is the reviewed
published discarded commit, never the predecessor's dirty worktree. Allocation
checks the predecessor's saved repository/target and exact discarded ref before
creating source. Existing completed allocation remains retryable independently.

Core maps initial source preparation to that reserved discarded branch. The
existing clone/frozen-commit check rejects missing or unrelated history. A renewal
instead carries its already-confirmed owned authority ref and exact commit through
source context; it does not permanently clone the original discarded branch after
the replacement advances. Normal source preparation validates the ref allowlist.
Main Save still proves every old and new submitted revision integrated, then proves
the current authorized source for that repository includes the accepted target.
The UI explicitly explains preservation of unsaved predecessor edits and the need
to prepare the changed selection before testing. No push occurs during replacement.


Connected receiving lookup follows only the original renewal owner's completed
handover: archived predecessor, completed durable state, published successor,
matching renewal identity and reciprocal successor metadata. Every hop retains
the same exact contribution binding, and cycles or missing/incomplete successors
fail closed. There is no global session alias or rewritten source binding.
Work snapshots and visible source links use the actual current session ID;
contribution IDs and recorded submitted revisions remain unchanged.
