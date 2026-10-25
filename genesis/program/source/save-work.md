# Review and publish session work

The existing session repository-state projection treats `connectedSaveRequired`
as unsaved work without inventing a main-repository changed-file count. Running
operations and failed/unknown inspections keep their existing precedence. The
temporary action terminal retains viewed completed details only when status,
stage or output remains; a connected Save with no origin operation therefore
cannot leave an empty "Working…" card after success.

A clean Main Save checks retained submitted revisions before reporting that there
is no work to save. Its existing preparation job receives the freshly authorized
connected snapshots and reuses the native integration gate on the no-change path;
no naming or publication follows a pending requirement. Dirty Save retains its
final publication-time gate and fresh snapshot recheck.

Receiving-status failures preserve the originating repository's work inspection
and ordinary Main Save presentation. The Save operation rechecks connected
authority and work before publication, so an unknown or inaccessible receiver
still blocks the main push with an actionable error.

For Genesis projects with declared generated artifacts, the managed `save-message`
operation inspects the current selected Stack through the existing Genesis owner
before capturing/naming work. Missing operation contracts fail read-only, before
optional inference or publication. Source is never silently migrated. This is an
early check; final map regeneration on the proposed tree and publication checks
still apply, including when source changes after preflight.

Successful Save completion clears the current task's diagnostic code, including
an earlier optional naming failure. Progress history retains the fallback notice;
the verified publication result owns the final outcome. Publication failures keep
their own diagnostic, and cache-maintenance warnings remain separately recorded.

People can deliberately publish the complete current session work to the
project's configured source authority without asking the coding agent to run
Git commands.

## Sources

- `src/components/studio/IncomingChangesPanel.vue`
- `src/components/studio/Vibe64DashboardShell.vue`

- `packages/vibe64-execution/src/server/gitTurnCheckpoint.js`

- `packages/vibe64-core/src/server/projectRepository.js`
- `packages/vibe64-project/src/server/repositoryBranches.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/registerRoutes.js`
- `packages/vibe64-terminals/src/server/sessionTurnCheckpoint.js`
- `src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue`
- `src/components/studio/ProjectSettingsPanel.vue`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `packages/vibe64-runtime/src/server/agentWriteLock.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-terminals/src/server/sessionSaveCommitMessage.js`
- `packages/vibe64-terminals/src/server/sessionNamingHelper.js`
- `packages/vibe64-terminals/src/server/sessionWorkOperationCommand.js`
- Main: `packages/vibe64-terminals/src/server/sessionWorkSave.js`
- `packages/vibe64-terminals/src/server/sessionWorkGit.js`
- `packages/vibe64-terminals/src/server/sessionWorkAuthority.js`
- `packages/vibe64-terminals/src/server/sessionWorkUpdate.js`
- `packages/vibe64-terminals/src/server/sessionIncomingContributions.js`
- `packages/vibe64-terminals/src/server/sessionSource.js`
- `packages/vibe64-project/src/server/localRepositoryRemote.js`
- `src/components/studio/repository/Vibe64LocalRemoteControls.vue`
- `src/components/studio/repository/Vibe64RepositoryWorkspace.vue`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-sessions/src/server/actions.js`
- `packages/vibe64-sessions/src/server/inputSchemas.js`
- `packages/vibe64-sessions/src/server/assistantContracts.js`
- `src/components/studio/Vibe64TemporaryActionTerminal.vue`
- `src/components/studio/Vibe64TerminalSurface.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64SessionSaveWork.js`
- `src/composables/useVibe64TemporaryAiRepairs.js`
- `src/composables/useVibe64SessionPanel.js`
- `src/lib/vibe64SessionRepositoryWorkState.js`
- `src/composables/useVibe64SessionRepositoryStatusRegistry.js`

## Public contract

Core validates optional session `connected_submissions` metadata: schema one
contains exact contribution identities and submitted commit IDs, without queue
status. The original Save Git owner carries those bindings into managed native
operations and fetches current receiving refs immediately before publication.
The exact submitted revision must be an ancestor of the configured target;
pending, discarded, interrupted-discard, inaccessible and incomplete-history
evidence refuse publication. Retained ancestry can prove integration after a
queue ref is deleted. Later unrelated branch commits do not invalidate that
proof. Feature-branch creation checks the same requirements. Renewal preserves
them; reading or removing connection-file entries cannot erase them.
Explicit replacement after discard preserves those requirements. Acceptance is
checked for every exact submitted commit, while accepted-source consumption is
checked against the current authorized source for that repository and target.
Contribution UUIDs remain immutable across renewal; the authorized work snapshot
identifies the actual receiving session that currently owns the source.


Explicit `vibe64.sessions.connected.prepare` now reserves source identities in
the origin session's `connected_sources` metadata and dispatches receiving
inspection/allocation through the original action catalogue. Each receiving
operation authenticates the original connection and authorizes that project
again. Projects checks fresh repository write access and its integration target;
Sessions reuses normal capacity admission and source creation. A lost response
retries the reserved session identity and refuses a different existing binding.
Trusted contribution creation allocates the receiving checkout without starting
that receiving session's workspace setup. The originating Stack recipe treats
its finite direct source map; allocation cannot recursively traverse receiving
connection lists or cycles. Ordinary session creation still starts setup, and
an explicit receiving-session Prepare remains its own operation.
The Git checkout stays under the receiving project's managed session source root.
Renewal retains these source bindings as well as exact submissions.
Preparation failures retain completed receiver summaries, including when a later
action throws. An unready source returns a failure with its existing receiving
session identity; allocation does not replace it or claim preparation succeeded.

Automatic preparation, standalone connected-project ownership, task execution
selection and Stack-declared development placement/treatment remain incomplete.
Connected-first Save now records each confirmed receiving commit before moving
to the next repository. The main Save action accepts the exact reviewed connected
destinations; this mode never publishes the main project. Each receiving action
reauthenticates and checks its immutable source binding before using native Save.
A retry skips unchanged completed sources and recovers a missing origin record
from the receiving session. Main Save checks for new connected work before
checkpoint preparation and again under the publication lock.
The latter authorized inspection returns ephemeral receiving source snapshots
through the existing internal action. Only those source roots enter the managed
Save command. After preparing the main commit and checking exact submitted-SHA
integration, native Save repeats the existing worktree-tree, HEAD and observed
canonical reads immediately before publication. Changed or unreadable sources
refuse publication and retain the main checkpoint. Browser Save input cannot
supply these snapshots. This closes preparation-time staleness, not the interval
between the final read and push: no receiving locks, cross-repository transaction,
or persisted snapshot ledger are introduced.
The coordinator reinspects each receiver immediately before its turn, retaining
earlier confirmed results if later inspection fails. Native Save confirms a lost
push acknowledgement when the remote contains its exact proposed commit, then
uses the original reconciliation path. An unreadable post-push authority records
`vibe64_session_save_publication_unknown` on the existing Save task; its original
operation ID and prepared Git refs remain recovery evidence. Work inspection or
an explicit retry resumes that verifier after restart, without publishing again.
The open session view inspects work when it opens or changes session, when a Save
or Update starts, is replaced by another operation or ends, and on agent
checkpoints. Progress events of one running Save or Update update only the
displayed progress (`runtimeHostWorkInspectionRevision`), so a rebase costs one
inspection of each repository instead of one per event. Opening a session with
an interrupted running task still inspects it and therefore recovers it.
An unresolved unknown outcome cannot be overwritten by another Save or treated
as a completed connected contribution.
Failed native publishing tasks also use that verifier before replacement, so a
post-push local write error cannot cause another publication. Proven unpublished
attempts retain their original rejection. Receiving Save carries the authenticated
action context into its own connected checks, without recursively submitting its
dependencies or weakening their gate.
A receiving Save still marked running blocks Main Save even if its native child
has already made the receiving worktree clean; metadata/finalization must finish
before that source is considered reconciled.
Within the native Save owner, a refusal before the first publication command
retires only that attempt's exact prepared ref while retaining its checkpoint.
This lets an unpublished first contribution retry after its prerequisite is
fixed. Once push or local baseline merge has been attempted, failure retains
the prepared evidence; remote absence cannot prove that a first push never
succeeded or authorize recreating a deleted branch.
A successful or recovered Save keeps its prepared ref only until the sessions
service has recorded the ready outcome; it then calls `retireSessionWorkSave`
to delete it, so no completed Save leaves evidence that later reads as a lost
contribution publication.
The chat Save control uses a branch icon and connected destination review while
submission is required, including when the main source is clean. It reports
confirmed receiving pushes on success or partial failure, then returns to ordinary
Main Save after submission. Accepted-source reconciliation remains incomplete.
Existing sessions without
these new metadata fields retain their original behavior; no read creates inferred
bindings. Development consumption must use the project's explicit Stack contract
for its toolchain, across every supported stack; the connection file is not a
package-manager prescription.

Each outer assistant turn owns one private Git checkpoint. Later failed,
cancelled or interrupted observations of the same session and turn validate
and reuse the first checkpoint's exact tree, commit and recorded outcome.
Outcome is an observation, not another identity. Confirmation projects that
recorded outcome into the existing background task and clears a failed retry's
warning; it does not replace source or move a newer latest ref backwards.
Validation still requires the complete canonical checkpoint message for that
session and turn and a supported recorded outcome. Foreign or malformed refs
remain errors.

Colleague can inspect work, Save, check for updates and apply an Update through
the same session actions as the UI. Its bounded results include changed-file
names, repository status, operation progress and exact destination/history
review identities, without file contents, diffs or internal recovery records.
Save requires the complete destination from a current inspection and the user's
instruction to publish there. The action validates its shape; the existing
repository owner checks its current identity under the publication lock.
Rewritten local history requires the exact reviewed commit/tree identities and
the user's instruction to reconcile them. Conflict repair is delegated to a
coding conversation and retains the existing conflict-review guard.
Colleague reports publication that still needs reconciliation separately from
a completed Save. After an uncertain result it inspects the saved operation
before retrying. Update does not publish work and may restart workspace
preparation; acceptance of either operation does not establish completion.
Save and Update retain their source coordination for assistant and repository
changes while already saved temporary-chat history and plain draft text remain
available through the short session-store path. An Update repair records a
request identity on its existing background task, allowing the chat to recover
confirmed progress after a lost response without launching a duplicate Update.

Colleague can read saved branches and open a session on an existing branch or
create a new named branch through ordinary session creation. Branch discovery
returns at most ten exact names/commits with a continuation offset; an exact-name
query can find a choice beyond the first page. The ordinary unpaged UI keeps its
complete list. Pages are sorted by exact name, and session creation rechecks the
reviewed source commit, so a stale choice cannot silently use newer source.
Creation checks session capacity before creating a branch and never replaces an
existing target name. Its typed branch selection requires a name and source
commit; `fromBranch` distinguishes a new branch from an existing one. This starts
from saved repository source, without copying unsaved work or chat history.
Colleague must explain that source and cannot silently Save to include changes.
If later workspace creation fails, it inspects branches and sessions before retry.

File Save writes only that file in the session. The compact Save changes review
shows the changed-file count, View diff and captured destination, with a short
reminder to save open editor changes first.

The confirmation is Save for local and Vibe64 Git projects, or Commit & push for
GitHub, with the exact repository and branch shown once above the actions.
GitHub also offers Create draft PR. The existing project `requirePullRequest`
setting makes it primary and disables direct publication until a session has
a numbered PR; otherwise Commit & push is primary. Project settings exposes
the same choice as Allow direct commits and pushes or Require pull requests.
This setting applies only to GitHub projects and never overrides GitHub rules.
A PR session names its head destination and base.
An explicit GitHub "Changes must be made through a pull request" rejection
returns `vibe64_pull_request_required` with the provider's reason and keeps the
session work intact. The failed Save offers Create draft PR through the existing
dialog when the session has no PR. Other branch-rule and credential errors
retain their original classification; a generic protected-branch error does
not establish that a PR will resolve it.
The PR form keeps its destination, title, description and draft choice, with
publication details collapsed. Repository automation is explained in those details.
The header Save icon is a floppy disk for local and Vibe64 Git destinations;
GitHub combines a floppy disk and Git commit symbol with partial transparency
so both remain visible. Update uses a branch-sync icon, distinct from the
pull-request icon used for Create/View PR.
The Save icon's hover hint includes the operation and repository/branch alongside
its current status. Update/rebase, status checks and unavailable actions use their
own status with the repository/branch, without a save or push label.
Update session labels name the session's bound branch. This action loads newer
commits from that same branch; bringing a PR's target branch into its source is
the separate Update branch action in PR details.
Ordinary sessions do not repeat this destination above chat;
PR sessions retain their separate PR context banner.
The browser retains the reviewed destination across refreshes; the server
rechecks session, mode, repository and branch before preparation and under the
publication lock. A stale review requires a new review. These commands do not
require an AI connection; server write admission still rejects active work.

The internal Save operation described below is this explicit publication action.
Save captures tracked, staged, unstaged, and relevant untracked session work,
asks the workflow's effective Helper model to give that exact checkpoint a concise
commit subject, and publishes one ordinary commit to the exact configured
GitHub, managed-Git, or local-source authority. It refuses ambiguous authority,
changed session history, dirty local authority, or a moving canonical branch.
Assistant naming is optional: provider, account, invalid-title, or cleanup failures
produce a visible fallback notice and a deterministic checkpoint-based subject.
Members can Save when the main chat's current connection is personal-only.
Repository Save and manual pull-request creation do not require AI access;
their source-operation and GitHub permissions still apply.
The chat-header Save control also remains usable after AI access is denied or
startup fails. It still waits while assistant activity is unknown or being
reconciled, and while a turn or repository operation is running.
Naming resolves Helper, including an eligible shared Backup, before requesting
its bounded tool-free profile. Its scoped conversation never changes the main
chat's binding or history. Repository authorization and write admission still apply.
The existing Save task retains the helper scope, exact selection, connection
identity, native conversation/turn IDs and managed execution ID until deletion
is confirmed. A new Save preserves that reference across its task reset and
retries cleanup before another naming request; session close also retries it.
Failed cleanup does not prevent repository persistence. Git authority and
checkpoint checks still apply.
Worktree edits made after capture are left as unsaved work on top of the named
checkpoint. The non-force publication itself rejects a stale concurrent
publisher; Save does not inspect sibling worktrees first. Progress and bounded
command output remain visible across reloads. A verified publication advances
the session baseline and preserves any later session edits; an interrupted
Save is reconciled only when the canonical authority proves the privately
recorded prepared commit was already published. Disposable GitHub mirror
maintenance runs after Save completes and cannot change the Save result.

Contribution sessions retain their validated `connected_contribution` binding
through the same managed command boundary. The native child receives the saved
integration target and resolves the reserved incoming destination again. A first
Save uses the bound base when neither remote contribution ref exists, prepares
the ordinary Save commit, and creates the incoming ref with an absent-ref lease.
Later Saves use an exact observed-head lease after the existing ancestry checks;
they cannot recreate a branch removed by a racing discard. No preliminary empty
branch or PR is published. The project's PR preference continues to govern
ordinary sessions; contribution submission targets its separate incoming ref
and still obeys GitHub's actual branch rules.

An existing discarded ref refuses publication; both forms require interrupted-
discard recovery. A missing ref after recorded or prepared publication remains
unknown and refuses automatic recreation. The existing checkpoint and prepared
ref retain work after failures, and recovery reconciles a lost acknowledgement
only when the remote proves the exact prepared commit. These are contribution
publication primitives, not the connected-first coordinator or main Save gate.

Incoming inspection also uses this Git owner and its managed command boundary.
It resolves the receiving project's configured target independently of the
selected session's Save destination, enumerates only reserved UUID branch names,
and fetches exact reviewed refs into operation-owned temporary refs. A changed
head, incomplete history or unavailable remote fails rather than classifying an
unknown result as integrated. Complete Git ancestry classifies current heads as
pending, merged or discarded; both active/discarded refs require recovery.
An integrated discarded head still reads as merged. Pagination includes all
classified states, with commit titles, bounded changed-file lists and optional
bounded review diffs. Reads preserve source files, index, branch, origin and
remote refs, and do not replace FETCH_HEAD. There is no queue record.
Receiving mutations use the same managed boundary and project source lock. They
require the exact reviewed repository, target and contribution heads. Merge
fast-forwards when possible or uses the existing tree-merge owner to create an
ordinary two-parent commit. Before a divergent merge, the existing derived-path
tree owner replaces contribution artifacts with the reviewed target's artifacts;
only authored paths can require repair. The existing Save/Update regeneration
owner rebuilds artifacts in a temporary worktree from the complete proposed
merged source. Generated-only conflicts therefore need no AI. Regeneration
failure leaves receiving source and remote heads untouched. Final merge parents
remain the original target and contribution, not the temporary normalized input.
Authored conflicts retain a private checkpoint through the original Update checkpoint
owner before offering the existing Temporary AI workspace in the receiving
session. Incoming's explicit repair review reuses Update's conflict-path tree
overlay; it changes neither the real index nor worktree. The candidate combines
only conflicting local paths with the native merge result for other files, then
regenerates artifacts. Both review and final Merge recompute that generated tree;
the reviewed identity covers the complete candidate, including its artifacts.
The shared overlay treats selected paths literally, including filenames with
Git pathspec syntax, so a conflict filename cannot select unrelated work.
The transient review carries exact candidate, source tree, HEAD and index
identities, recomputed by the server rather than trusted as client evidence.
Final Merge rechecks those identities and both remote heads, then creates the
ordinary two-parent commit. Temporary AI starts with Senior and does not run
Update or publish on completion. Restart/reload preserves the existing chat and
checkpoint owners; fresh Git/source review replaces the transient candidate.
No Incoming queue, repair-status store or second Git engine is introduced.
The contribution branch remains after integration. Discard uses a guarded atomic
create-and-delete push; only an explicit lack of atomic support permits copying
and verifying the discarded ref before deleting the exact active head. An
interrupted copy leaves both refs available for a fresh reviewed retry. A
different discarded head or a racing contribution update is never overwritten.
Project-level Incoming actions use an existing session only for source storage.
Projects checks the current actor's GitHub write access and configured PR policy;
Terminals records that actor before mutation and retains session admission and
the project source lock. The dashboard defaults to pending contributions, links
interrupted discards to recovery, exposes history filters and exact-head review,
and confirms Merge or Discard. Its badge is replaceable Git-derived observation.
Logical API failures remain failures even when HTTP delivery succeeds. Conflict
failures expose Fix it with AI and Review resolved conflicts; uncertain actions
require Refresh before retry. Candidate review never refreshes publication state.
HTTP review includes a bounded diff; Colleague receives bounded summaries and
exact confirmation identities without source contents. Mutations refresh the
shared GitHub observation; a notification failure cannot negate a confirmed push.
Configured GitHub receiving projects are supported here. Local-folder receiving
target resolution and origin exact-submission gates remain separate work.

The shared terminal surface gives operation cards a subtle theme-aware background
in both compact and expanded states, separating them from the conversation.
While Save runs, the workspace shows one compact progress line. The output includes
only events with readable messages; helper lifecycle records stay in the stored
operation without producing timestamp-only lines. Opening its
details keeps the same card, heading, status and progress line, with controls
beside the description, and reveals
the bounded command progress; while work is active, Collapse
returns to the compact line and Dismiss is unavailable. After the operation
finishes, Dismiss removes it. The browser remembers a dismissal across reloads
for that exact Save or Update attempt without changing its result; a new attempt
is visible again. A successful Save disappears on
completion; a failed Save remains visible with its recovery actions until
dismissed. The selected session's icon-only Save or Update action stays in the
chat header beside the session it will affect, rather than occupying the
application-wide toolbar. A failed Save or Update retains the current incoming-
version requirement, so the header continues to offer Update until the session
actually includes the latest saved version.
After another session saves, its canonical-change notification immediately
switches sibling tabs and their header action to Update. The pending incoming
version survives older work inspections and canonical-check responses until an
inspection confirms the announced version. The header observes the same
pending state as the session tabs, including while follow-up checks run.
Selecting a session also shows Update as soon as the canonical check confirms
incoming work, without waiting for another full worktree inspection. The check's
HTTP response and realtime notification carry the same dated result; the shared
registry applies it once and schedules one background work inspection. Older
check results cannot replace a newer confirmation, and pending incoming work
survives an older work inspection until that inspection sees the announced
canonical commit. An initially unknown file-change list does not hide a
confirmed Update action.
Returning to a visible tab requests a normal canonical check, allowing the
server's 25-second shared result cache to serve sibling tabs. Explicit source
and canonical-change invalidations still force a fresh check. Worktree fallback
inspection on visibility remains immediate.
This visibility recovery refers to the browser document. Switching session chips
reuses a recorded canonical check instead of requesting it again. A session
without a confirmed check still gets its first check, and the existing five-minute
canonical fallback detects upstream Git changes that publish no Vibe64 event.
Clicking the muted repository action explicitly forces a server update check through
the same registry and waits for the work inspection to settle. A visible
“Checking…” hint and busy state last for that request, with repeated clicks
suppressed. The refreshed state may enable Save or show Update, but checking
never invokes either operation. Archived sessions, suspended source access and
active repository operations retain their disabled controls.
Concurrent worktree reads for the same runtime, session, source path and recorded
base/canonical commits share one repository inspection. Each response rereads
durable Save/Update operation status after that inspection. Completed and failed
inspections are removed immediately, so a later read inspects current files;
different project roots and changed source metadata cannot join an older read.
The same authority check returns the verified source mode, repository, branch
ref and commit to session renewal, so handover creation uses the project
configuration that Git actually checked.
Missing configured branch or repository authority fails before Git runs;
legacy source metadata cannot supply a replacement canonical authority. GitHub
PR sessions instead use the server-resolved repository and head branch bound at
creation or PR publishing. Save, Update, history and renewal use that same
explicit authority. Canonical notifications reach only sessions on that source
branch. Fork sessions do not refresh the base project's clone cache.

Each Save or Update attempt starts a fresh visible transcript. Retrying after a
failure does not mix the earlier attempt's errors into the new operation.
That shared activity remains visible while a Temporary AI repair is selected.
Checking the existing Update repair does not create a second temporary chat.

Review resolved conflicts is available on the Update error and in an open Update
repair tab. It snapshots the current conflict review ID and affected paths for
the person's explicit acknowledgement. A changed review or session invalidates
the open confirmation. Confirmation uses the existing Update operation and locks,
independently of any AI outcome; it may also report the result into the existing
repair chat without sending an automatic follow-up. It never publishes. Check
Update remains an unacknowledged retry; automatic AI completion submits its own
recorded runConflictId through the same check/result owner.

Conflict recovery accepts a shrinking subset of the original conflict list only
while the base, canonical commit, HEAD and index identities remain unchanged.
Every still-conflicting authored file must have changed since the failed
checkpoint; changes to other originally conflicting files are allowed. Declared
derived artifacts are regenerated and do not invalidate that authored-file
comparison. Unreviewed conflicts, new conflicts, changed repository identities,
or unrelated authored edits refuse the recovery shortcut and retain source work
for another check. Application tests do not replace the actual Update check.

Save and Update use the mounted assistant connection's existing readiness state.
Reconnection is visible and disables both the header action and an already-open
Save confirmation. The server remains authoritative: a repository request waits
up to ten seconds for assistant-write admission, then rechecks active assistant
work before entering repository work. If preparation still owns the lock at
timeout, the failure identifies reconnection and offers a later retry. The lock
is never bypassed and the browser does not automatically resubmit publication.

Before Update replaces source, including interrupted Update recovery, it
invalidates the session's workspace preparation. That durable write must
succeed before source changes; an unchanged setup recipe must run again for
the updated source. An already-current Update leaves preparation intact.

An admission failure with no server operation identity is dismissed by clearing
that request's local error. It does not borrow an identity from older history.
Switching sessions retires pending local replies, including when the person
returns before the old request finishes. Normal data refreshes retain the
current request. Active work cannot be dismissed.

The shared short-action banner assigns explicit grid positions to its optional
status, message and controls. Its layout follows the available pane width;
narrow panes put actions on their own wrapping row. Errors wrap in full instead
of truncating the explanation, and recovery controls remain separately usable.

The current activity is causally bound to the Save or Update command the person
actually invoked. If admission fails before that command creates a durable
operation, the failure is shown without borrowing the label, icon, or transcript
of an older completed repository operation.

Assistant-write lock diagnostics use the normal service logger. Acquisition,
release, contention and rejection name the requesting operation, project and
session, and a unique attempt ID. A blocked request records the holder's
operation, attempt ID, PID, process-identity status, acquisition time and lock
age, together with its own wait budget and elapsed wait. These log records
survive removal of the live lock directory. Named operations include Save,
Update, assistant verification, temporary chat, source editing and preparation.
Waiting emits one initial contention event and a final acquisition or rejection,
not an event for every poll. Prompts, file contents, credentials and the private
lock-release token are excluded. Diagnostics do not change admission or retries.
Contention and rejection are warnings, retained at the default log level;
acquisition and release are informational events.

After a reload, current activity is restored only from the server's exact live
operation identity. Durable task status and timestamp order are not treated as
proof that an operation is still running; interrupted work is reconciled by the
server before it reports the session state. Completed task records remain
diagnostic history and are never selected as current activity.

After a successful reconciled Save, the chat offers a behavior-preserving
Deslop of that exact published commit. Accepting sends one ordinary visible
message through the session's existing assistant path; declining only hides the
offer and records no preference. A Save that still needs reconciliation does
not offer cleanup yet.
The offer uses the theme surface and a filled primary action so Deslop remains
readable when disabled during active assistant work.

For standalone local folders, Fetch checks the original project's configured
upstream and push destination; it never uses a session clone's internal origin.
The standalone project shell shows one branch dropdown beside the project name
and new-session button, with no separate Git row. A badge shows the total
incoming/outgoing count, or an error marker when a check fails. The button's
accessible name and hover title include the full branch and sync status; small
screens use a Git icon. The dropdown contains status, Switch branch, New branch,
Fetch, Pull and Push with
nonzero commit counts, full branch and remote names, the last check time, any
fetch error and Remote settings. Pull/Push close this menu before opening their
existing review dialog. Long branch names truncate in the header; details wrap.
Pending actions use stable labels.
The toolbar refreshes while visible, at most once per minute in the background,
and supports explicit Fetch. Transport failures show unknown counts and retain
the last successful check time. Native branch upstream and push configuration,
including a separate push URL, determine the displayed destinations. Missing
or ambiguous destinations require Remote settings or terminal Git; the UI does
not guess a remote or branch. Settings change ordinary Git configuration.

Pull requires a clean original folder and a reviewed branch, HEAD, configuration
and remote commit. It fast-forwards or, after explicit review, merges divergent
history. Conflicts leave the working files untouched for terminal resolution.
Push publishes the original folder's saved commits to its exact reviewed push
branch, never force-pushes, and verifies the remote result. Save remains local;
unsaved session changes are not pushed. Existing session checks then offer
Update when the local baseline advances. The original-folder controls are
unavailable to hosted projects, which choose a branch when opening a session.
Remote operations use the execution gateway and existing project source lock.
Logs identify action, project and attempt, without recording remote credentials.

A local history rewrite returns an explicit recovery review: old baseline,
current canonical commit, session HEAD, complete current tree and up to 100
changed paths. Reconcile rechecks those identities and applies only the session's
delta from its old baseline using an explicit merge base. Old baseline commits
are not replayed. Existing checkpoints, conflict repair, preparation invalidation
and interrupted Update recovery remain the owners of source changes. An explicit
repair check may reuse a reviewed conflict while its base, canonical version,
HEAD and index remain unchanged. A changed baseline requires a new review.
New local sessions remember their original project branch and refuse to retarget
when the opened folder switches branches. Legacy sessions without this marker
continue using verified project authority. Hosted rewritten history is
rejected unless the session itself adopted it: its HEAD contains the new
canonical commit and no longer contains its old base. Check, Update and Save then
treat the session as current, and the base moves to the canonical commit.

Switch branch and New branch review the original folder's current branch, HEAD
and configuration, require a clean tree and no merge/rebase/sequencer in progress,
and use native non-forcing Git switch. Creation starts at the reviewed HEAD and
does not set an upstream or push. Older sessions keep their original binding.

Hosted session creation can list or create branches through the existing project
owner. The dialog's Work on selector offers the project branch, a new branch,
or an existing branch without an advanced switch. Creating asks for the name
and source branch, rejects an already listed name, and states where changes
will be saved. Listing and selection both use the project service's configured
GitHub credential mode; neither silently substitutes the process environment.
A selection carries its observed commit, which the server rechecks under
the project source lock. Creating a branch is absent-only; opening an existing
branch clones that branch's verified commit. No current worktree is retargeted.
The optional `repository_branch` metadata explicitly overrides the project branch
for source inspection, publication, Update and renewal. Legacy sessions without
it retain their existing project authority. Notifications only affect sessions
sharing the same mode, repository and branch. Local sessions retain their
existing original-folder binding instead of using this hosted override.

Codex, Claude and OpenCode observed writable session turns create private Git
recovery checkpoints on completion, interruption or failure. Ordinary temporary
conversations participate; scoped read-only helpers and naming profiles do not.
Checkpoints preserve the saveable files without advancing the project branch or
changing the index. A turn's ref and the latest pointer are published in one Git
transaction. If another writer advances latest, publication retries up to twice
with the same captured tree parented onto that checkpoint. Both turns remain
recoverable; unrelated Git failures stop immediately. A durable background-task
failure appears as a compact chat notice with collapsed, scrollable technical
details; the files remain but a successful recovery point is not claimed. This is not continuous
backup of arbitrary terminal edits, unsaved editor buffers or database contents.

GitHub project owners can require PR publication through
`settings/repository-workflow.json` in private project runtime state. Absence
means false and reads never create or rewrite a file. The owner-only command
atomically replaces the validated setting. Direct publication is rejected
unless the session has a numbered PR; server-owned PR creation may publish its
head first. This is checked again immediately before publication. Existing
session destinations are unchanged. Native GitHub rules remain the authority
for pushes made outside this workflow. No historical data upgrade is needed:
the optional setting and branch binding have no historical rewrite.
The Git workflow setting has its own Project settings section. Its existing
project event carries the changed boolean to open session reviews without a Git
inspection or account refresh. Work and Changes reads both carry the policy and
the complete reviewed repository/branch, including across the Git subprocess
boundary. Local Git operations can establish their local command identity
before any AI conversation has started.

## Implementation map

- The internal `runSessionSourceReadExclusive(sessionId, operation)` facility
  admits a server-owned snapshot callback through the original repository
  admission owner and then the existing project source lock. It reloads the
  exact session and resolves its source through the original managed source
  authority. Active turns/native goals, unfinished replacement/rewind,
  routing/helper cleanup, temporary work, closing/renewal and running Workspace
  setup remain fenced by their existing owners. A persisted running setup is
  also refused until explicit recovery confirms completion. The callback may
  validate and install content elsewhere; it receives no model-supplied path
  and exposes no action, shell command, publication or preview control.
- `packages/vibe64-execution/src/server/gitTurnCheckpoint.js` captures private,
  non-advertised worktree checkpoints without changing the user's index. Each
  checkpoint retains the preceding checkpoint as recoverable history while its
  tree reflects the current saveable worktree, so a newly ignored local file is
  left on disk without remaining in later checkpoint trees.
- `packages/vibe64-project/src/server/projectSourceMutationLock.js` serializes
  canonical source mutations across processes.
- `scopedSessionWorkCommand()` assigns one semantic operation identity plus
  project and session ownership to repository operations. Inspection and update
  checks enter the managed host once through `runSessionWorkOperation()`. Save
  uses one managed checkpoint-and-summary job before its temporary naming turn
  and one managed publish-and-reconcile transaction under the project source
  lock. A deterministic private prepared-commit ref supplies restart evidence;
  disposable mirror refresh is deferred until after Save.
