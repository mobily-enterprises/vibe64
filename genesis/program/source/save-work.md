# Review and publish session work

The existing session repository-state projection reads the session's work
inspection, whose `unsaved` and `updateAvailable` include its connected copies,
so a session whose only work is in a copy shows unsaved work without inventing a
changed-file count for its own repository. Running operations and failed/unknown
inspections keep their existing precedence. The temporary action terminal
retains viewed completed details only when status, stage or output remains.

A session tab shows the projection's **All work is saved** tick in the success
colour only while that tab reports no assistant work. During its existing
`agentThinking` state, the same one that pulses the tab's dot, the tick uses the
theme's disabled grey and its label says the work was saved at the last check
while the assistant is still working, because the turn can still change source.
The projection, other states' colours and the archive warning are unchanged.

**Repository needs help** comes from one shared reading of the stored Save and
Update records, `sessionWorkProblem()` in the terminals package's shared code: a
failed Save (other than a required Update) or a failed Update, the later one
when both failed. It returns that operation's own recorded message and a next
step naming the existing controls (Review resolved conflicts for a reviewable
Update conflict, Create draft PR for a required PR, otherwise Fix it with AI or
trying again). The projection carries both, so the tab icon's tooltip, the tab's
accessible name and its info's **Why** and **Next** facts show them on desktop
and touch screens. For the selected session the info also offers **Show Update
notice** or **Show Save notice**, which brings back a dismissed notice in chat;
the Save header's hint repeats the notice's "needs attention" reason. A stored
failure the notice mirrored leaves it once the record is no longer failed. The
same reading feeds the session assistant's `vibe64-helper session status`
(`repository`) and Colleague's work tool (`repositoryProblem`), so neither has
to guess. The failure does not disable Save: Save stays unavailable only when
there is nothing to save.

For Genesis projects with declared generated artifacts, Save and Update
regenerate them on the proposed tree (`regenerateDerivedArtifactTree`). Genesis
never stops either operation: when regeneration fails, for example over a Stack
missing an operation contract, the tree keeps the artifacts it came with, the
result carries `derivedArtifactsKept` with Genesis's code and message, the
activity records a `derived-artifacts-kept` progress note and the server logs
`vibe64.session_work.derived_artifacts_kept`. Source is never silently migrated;
the next Save or Update after a repair regenerates the artifacts.

Successful Save completion clears the current task's diagnostic code, including
an earlier optional naming failure. Progress history retains the fallback notice;
the verified publication result owns the final outcome. Publication failures keep
their own diagnostic, and cache-maintenance warnings remain separately recorded.

People can deliberately publish the complete current session work to the
project's configured source authority without asking the coding agent to run
Git commands.

## Sources

- `src/components/studio/Vibe64DashboardShell.vue`

- `packages/vibe64-execution/src/server/gitTurnCheckpoint.js`

- `packages/vibe64-core/src/server/projectRepository.js`
- `packages/vibe64-project/src/server/repositoryBranches.js`
- `packages/vibe64-project/src/server/projectActions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/registerRoutes.js`
- `packages/vibe64-terminals/src/server/sessionTurnCheckpoint.js`
- `src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue`
- `src/components/studio/ProjectSettingsPanel.vue`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `packages/vibe64-runtime/src/server/sessionRecords.js`
- `packages/vibe64-runtime/src/server/agentWriteLock.js`
- `packages/vibe64-terminals/src/server/serviceSessionWork.js`
- `packages/vibe64-terminals/src/server/serviceSessionWorkInspection.js`
- `packages/vibe64-terminals/src/server/sessionSaveCommitMessage.js`
- `packages/vibe64-terminals/src/server/assistantHelperTurn.js`
- `packages/vibe64-terminals/src/server/sessionWorkOperationCommand.js`
- Main: `packages/vibe64-terminals/src/server/sessionWorkSave.js`
- `packages/vibe64-terminals/src/server/sessionWorkInspection.js`
- `packages/vibe64-terminals/src/server/sessionWorkPublication.js`
- `packages/vibe64-terminals/src/server/sessionWorkSaveRecovery.js`
- `packages/vibe64-terminals/src/server/sessionGitCommandActor.js`
- `packages/vibe64-terminals/src/server/sessionWorkGit.js`
- `packages/vibe64-terminals/src/server/sessionWorktreeSwitch.js`
- `packages/vibe64-terminals/src/server/mainChatNote.js`
- `packages/vibe64-terminals/src/server/sessionWorkCommands.js`
- `packages/vibe64-terminals/src/server/sessionWorkAuthority.js`
- `packages/vibe64-terminals/src/server/githubRemoteHeads.js`
- `packages/vibe64-terminals/src/server/sessionWorkUpdate.js`
- `packages/vibe64-terminals/src/server/sessionWorkUpdateRecovery.js`
- `packages/vibe64-terminals/src/shared/sessionWorkProblem.js`
- `packages/vibe64-terminals/src/server/agentSessionCommand.js`
- `packages/vibe64-terminals/src/server/agentSessionStatus.js`
- `packages/vibe64-terminals/src/server/agentSessionCommandRun.js`
- `packages/vibe64-terminals/src/server/sessionConnectedCopies.js`
- `packages/vibe64-terminals/src/server/serviceSessionConnectedCopies.js`
- `packages/vibe64-terminals/src/server/sessionSource.js`
- `packages/vibe64-terminals/src/server/sessionSourceCommands.js`
- `packages/vibe64-project/src/server/localRepositoryRemote.js`
- `src/components/studio/repository/Vibe64LocalRemoteControls.vue`
- `src/components/studio/repository/Vibe64RepositoryWorkspace.vue`
- `packages/vibe64-sessions/src/server/sessionWork.js`
- `packages/vibe64-sessions/src/server/sessionWorkRecovery.js`
- `packages/vibe64-sessions/src/server/sessionRepositoryUpdates.js`
- `packages/vibe64-sessions/src/server/sessionWorkOperations.js`
- `packages/vibe64-sessions/src/server/repositoryUpdateProbe.js`
- `packages/vibe64-sessions/src/server/repositoryUpdates.js`
- `packages/vibe64-sessions/src/server/Vibe64SessionsFeature.js`
- `packages/vibe64-sessions/src/server/sessionActions.js`
- `packages/vibe64-sessions/src/server/inputSchemas.js`
- `packages/vibe64-sessions/src/server/assistantContracts.js`
- `src/components/studio/Vibe64TemporaryActionTerminal.vue`
- `src/components/studio/Vibe64TerminalSurface.vue`
- `src/composables/useVibe64TerminalMobileTakeover.js`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotSessionHeader.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotActivity.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotDialogs.vue`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64ShortActionDismissals.js`
- `src/composables/useVibe64SessionSaveWork.js`
- `packages/vibe64-ai-tasks/src/server/kinds/save.js`
- `packages/vibe64-ai-tasks/src/server/kinds/update.js`
- `src/composables/useVibe64SessionPanel.js`
- `src/lib/vibe64SessionRepositoryWorkState.js`
- `src/lib/vibe64SessionSaveTarget.js`
- `src/components/studio/vibe64-session/Vibe64SessionSaveTarget.vue`
- `src/components/studio/vibe64-session/Vibe64SessionToolbar.vue`
- `src/composables/useVibe64SessionRepositoryStatusRegistry.js`
- `src/composables/useVibe64SessionRuntimeHost.js`

## Public contract

Save, Update, update checks, inspection and Save recovery reach each connected
copy (`sessionConnectedCopies.js`) through the same engine as the session's own
repository. `connectedCopyWork` presents the copy as a GitHub session of its
repository (`https://github.com/<owner>/<name>.git`) whose source is the copy,
whose branch is the repository's main and whose base and canonical commits are
the copy's record; its mirror is optional, so no mirror maintenance follows. Its
Git commands run as the session's recorded Git actor for that repository
(`connectedCopyActorSession`), recorded first on a write when the session has none.
The terminals service supplies those commands, the commit records and workspace
preparation's connected step from `serviceSessionConnectedCopies.js`.

Prepare (`prepareConnectedCopies`) clones each missing copy from the repository's
default branch with the person's GitHub credentials, through `--reference` to a
registered project's verified GitHub mirror of the same repository when one
exists, then repacks and removes the alternates so the copy depends on nothing
else (`cloneCanonicalSource`). It checks out `vibe64/<sessionId>`, removes the
cloned default branch like any new source and records the copy at once. It never
fetches, resets or replaces an existing copy, and refuses the project's own
repository, an unrecorded folder at the copy's path and a recorded copy whose
folder is missing. A copy no longer listed is removed only when its worktree is
clean and it has no commit beyond its canonical commit. Each repository adds one
line to the preparation output.

Save (`saveConnectedCopies`) first runs the update check for every copy: a copy
behind its main refuses with `vibe64_session_save_update_required` (details
`connectedRepository` and `updateRequired`), even when it has no work. Then
`beforePush` runs the session's own check (`refuseBehindSessionSave`) when its
own repository has work, so a behind repository refuses before anything is
pushed. Each copy with unsaved work is then saved in list order through the
ordinary message preparation and native Save, recorded with Core's
`recordSessionConnectedCopyCommits` and its prepared ref retired, before the
next copy. A push refused because the main moved becomes
the same Update-first refusal; any other failure also stops there, before the
session's own Save. Copies always publish straight to their main; there is no
pull-request path for them. When only copies have work, Save returns their
results without saving the session's own repository. Creating a pull request runs
the same copy Save before pushing the session's own work to its branch.

Genesis's derived artifacts belong to a copy only when the copy is itself a
Genesis project, with a Blueprint (`copyDerivedArtifactPaths`). A plain
repository's inspection, Save and Update treat every path as its own work and
regenerate nothing, so they never require a Genesis Stack.

Update (`updateConnectedCopies`) runs the native Update for each copy before the
session's own. A copy that fails, for example with `vibe64_session_update_conflict`,
stays unchanged and is reported with its line, while the other copies and the
session's own Update proceed. Sessions records the session's own result and
prepares the workspace, then fails the Update task with that copy's problem
(`connectedUpdateFailure` in `packages/vibe64-sessions/src/server/sessionWork.js`),
a conflict before any other failure, recording `connectedRepository`. A copy's
conflict carries the native conflict recovery with its paths named from the
session's source (`../connected/<name>/<path>`), its repository in
`connectedRepository`, and `conflictMessage` naming that repository, so **Review
resolved conflicts** and the **Fix Update** AI task run unchanged. Rerunning with
the `reviewedConflictId` passes that recovery, with its own paths, to that copy
only (`conflictReviewFor`); the session's own repository gets none. Work
inspection's repaired-failure check reads that copy's checkout instead of the
session's (`inspectSessionUpdateFailure` with `connectedRepository`). Each copy's
prepared update is reported as `connectedUpdate` progress on the Update task until
it is recorded; interrupted Update recovery first recovers that copy with the
native recovery (`recoverConnectedCopyUpdate`) and records it, then recovers the
session's own repository, which stays retryable when it had not started.

Interrupted Save recovery (`recoverConnectedCopySaves`) first records, from each
copy's prepared-ref evidence for that operation, the copies whose push landed but
was not recorded, skipping a copy the Save never pushed
(`vibe64_session_save_interrupted_retryable`), then recovers the session's own
repository. A Save of copies alone prepares nothing in the session's own
repository; when that recovery finds nothing and neither the session's own
repository nor any copy holds unsaved work, the Save is complete
(`copiesOnlySaveRecovered`) and is recorded as recovered without a commit of the
session's own.

The update probe reads each copy's main head with the session heads, grouped by
repository and branch, and rechecks a session when any of them moved; the check
records each copy's observed main. Work inspection includes every copy
(`inspectConnectedCopies`), and `vibe64-helper session status --json`
(`readAgentSessionStatus`) lists them
under `repository.connected` with `name`, `path`, `behind` and `unsaved`. Each
outer assistant turn's checkpoint is also taken in every copy. The AI's managed
`git` runs in a copy as in the session's source: a working directory outside the
source that is inside a recorded copy (`connectedCopyAtCwd` in
`codexGitCommand.js`, which reads the copies only for such a directory) runs
Git's local commands there with no credential, confined to that copy. Commands
that reach the remote, and `gh`, are refused there
(`vibe64_codex_git_command_connected_remote`), because Save publishes copies and
Update brings in their main; any other directory stays refused. Sources:
`tests/server/vibe64ConnectedCopies.unit.test.js`,
`tests/server/codexGitCommand.unit.test.js`,
`tests/server/vibe64RepositoryUpdateProbe.unit.test.js`,
`tests/server/codexOuterTurnCheckpoint.unit.test.js` and
`tests/server/agentSessionCommand.unit.test.js`.

Native Save confirms a lost push acknowledgement when the remote contains its
exact proposed commit, then uses the original reconciliation path. An unreadable
post-push authority records `vibe64_session_save_publication_unknown` on the
existing Save task; its original operation ID and prepared Git refs remain
recovery evidence. Work inspection or an explicit retry resumes that verifier
after restart, without publishing again.
The open session view inspects work when it opens or changes session, when a Save
or Update starts, is replaced by another operation or ends, and on agent
checkpoints. Progress events of one running Save or Update update only the
displayed progress (`runtimeHostWorkInspectionRevision`), so a rebase costs one
inspection of each repository instead of one per event. Opening a session with
an interrupted running task still inspects it and therefore recovers it.
The view never reads its session's work itself: it asks the session panel's
repository status registry, which inspects every session's work, and receives
each of the registry's results for its session, including those the registry
started for a realtime change. The realtime event and the view's task revision
of one change therefore read the session's work once.
An unresolved unknown outcome cannot be overwritten by another Save.
Failed native publishing tasks also use that verifier before replacement, so a
post-push local write error cannot cause another publication. Proven unpublished
attempts retain their original rejection.
Within the native Save owner, a refusal before the first publication command
retires only that attempt's exact prepared ref while retaining its checkpoint.
This lets an unpublished first Save retry after its cause is fixed. Once push or
local baseline merge has been attempted, failure retains the prepared evidence;
remote absence cannot prove that a first push never succeeded or authorize
recreating a deleted branch.
A successful or recovered Save keeps its prepared ref only until the sessions
service has recorded the ready outcome; it then calls `retireSessionWorkSave`
to delete it, so no completed Save leaves evidence that later reads as a lost
publication. Retiring takes only the session write lock, which serialises it
with Save and recovery; it deletes a Vibe64-internal ref without touching the
worktree, so an assistant turn started right after Save does not block it.
Development consumption must use the project's explicit Stack contract for its
toolchain, across every supported stack; the connection file is not a
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
changes while saved temporary-chat history, an AI task's saved conversation and
plain draft text remain available through the short session-store path. An Update repair is an
[AI task](../conversation/ai-tasks.md) whose check records a request identity on the
existing background task, so a lost response or a restart recovers confirmed progress
without launching a duplicate Update. A Save repair is an AI task too: once the AI
finishes, its check runs Save to the destination a fresh inspection reports, which
pushes the work without another click. The check passes the task's identity, so the
repository-task refusal lets that one Save through. While either task runs, Save and
Update refuse to start.

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
GitHub, with the exact repository and branch shown once above the actions, in
the session tab's Saves to form (`Vibe64SessionSaveTarget`: short repository,
branch chip, marked when it is not the project's main branch). The review sent
back to the server stays the exact destination object.
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
The Save icon's hover hint includes the operation and the same Saves to text
alongside its current status. Update/rebase, status checks and unavailable
actions use their own status with "Saves to" and that text, without a save or
push label.
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
asks the actor's effective Quick helper model to give that exact checkpoint a concise
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
reconciled, while a message is being sent, and while a repository operation is
running.

Update and Save can run while the AI works; Save asks first because it includes
unfinished changes. Neither the header controls nor the server refuse during a
main-chat turn (`runSessionRepositoryWrite` in `serviceSessionWork.js` takes
`whileAssistantWorks` for both and for Save's recovery; Update's recovery and
source reads still wait). While the
main chat's turn is open the Save confirmation says "The AI is still working.
Save now, including its unfinished changes?" and its button reads Save now; that
confirmation is the only gate. The write lock and the project source lock still
make each operation exclusive. A write that runs while the AI works holds the
agent-write lock through the service state's `writesWhileAssistantWorks`
(`writesWhileAssistantWorks.js`): routing never makes Stop or a steer wait for it,
and the write lets the lock go only once their lock-free work is done (see Direct
chat).

Nothing written while either runs is lost, because neither replaces the
session's files wholesale. Both move the worktree with Git's two-tree switch
(`switchSessionWorktree` in `sessionWorktreeSwitch.js`: read the starting tree into
an index of its own beside the session source, refresh its file stats, then
`read-tree -m -u`), which changes only the paths that differ and refuses, changing
nothing, rather than overwrite a file that no longer matches its starting version.
Git takes a missing file for an unchanged one and replaces a file it ignores, so
the switch first refuses itself (`vibe64_session_worktree_written`) when a path it
changes was modified or deleted on disk (`git diff-files`) or a path it adds
already holds an untracked file, and refuses with
`vibe64_session_update_ignored_file`, naming the files, when that file is one Git
ignores (`git check-ignore --no-index`), since the checkpoint never captured it.
Its own index means the session's index, which the AI's git commands use, never
holds the checkpoint's untracked files; callers set it only once HEAD has moved.
Every session work Git command that finds the index lock held, as the AI's own
`git status` does for a moment, runs again for up to ten seconds (`git` in
`sessionWorkCommands.js`).

`switchSessionKeepingWrites` moves the files from one tree onto a commit while
keeping every file written since: the target is the commit plus those files as
they are now, so only paths nobody wrote change; a file written between reading
the session and switching it makes it read again, three times at most. Save's
commit is its checkpoint; Save's reconcile (`reconcileSession` in
`sessionWorkPublication.js`) moves the session from that checkpoint onto the saved
commit this way, so a regenerated file the AI wrote or deleted meanwhile stays as
the AI left it, as an unsaved change, and HEAD moves to the saved commit even when
files kept changing. Files written after the checkpoint stay unsaved and Save's
notice counts them (`unsavedPathCount`); `refreshedPaths` lists the files Save
changed on disk. Only a commit made in the session while Save ran leaves it on
that commit with the result `published_needs_reconcile`. Save records the
session's HEAD from its checkpoint onward (the `checkpointed` and
`message-writing` progress), so its recovery, which can run during a turn, also
leaves the session on a commit made since that Save. Update switches only the
paths the merge changes, so edits elsewhere stay as unsaved work; when a path
Update changes is written, deleted or renamed before or after its switch, Update
stops with `vibe64_session_update_worktree_changed`, switches those paths back to
the checkpoint unless they were written since (`undoSessionUpdate`), moves HEAD
back and restores the index, and says a file changed while it ran. When files keep
changing through every attempt to switch back, the session stays updated and HEAD
moves to the saved commit its files show. HEAD is read first and checked after
each move: a commit made in the session while Update ran leaves every file as it
is, sets the index to that commit and stops with
`vibe64_session_update_head_moved`. Fix Update waits and tries again on the
worktree-changed and head-moved codes, and a reviewed conflict's recovery
survives all three stops for the next repair check.

After a successful Update the main chat's AI is told which files changed
(the first twenty, with the full count), to re-read them before editing and
re-run checks that touch them; after a Save that moved the session onto its
commit, a working turn is told its work was saved as it was when Save started,
whether later changes stay unsaved, and which files Save regenerated, to re-read
them. The terminals' `noteMainChat` (`mainChatNote.js`) steers a running turn
through the ordinary routed steer (generated Junior work, so it never starts a
turn), marked `vibe64Note` so its turn is the app's (`actorId` "app") and the chat
shows it as a system row; a steer that may have reached the AI is never repeated,
and only one refused before sending (`not-sent`) falls back. Otherwise Update's
note waits in the session metadata `main_chat_note`, joined after any note still
waiting, and the main-chat dispatch puts it ahead of the next message sent there
(not a slash command), clearing it once that message is delivered. The chat keeps
showing what the person sent.
Naming resolves the actor's Quick helper (`commit_title`) before requesting
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
Upstream changes that publish no Vibe64 event, such as a push from elsewhere or
a commit in a local project folder, are found by the server's update probe.
While a project is in use, meaning a browser page has it open, in a visible or a
background tab, or an agent turn runs in one of its sessions, the server reads
its open sessions' authority branch heads every 30 seconds with one read per
authority repository, shared by every session and viewer. A GitHub repository
is read by the server itself with one Git protocol v2 `ls-refs` request to
https://github.com, which starts no process and no managed job; a managed or
local authority with one `git ls-remote`. So is a GitHub repository when the
server runs behind a proxy its own requests would not use, where Git would
(`HTTPS_PROXY` without `NODE_USE_ENV_PROXY=1`, or only `ALL_PROXY`, in either
case); that choice is made before the read, never after a failure. Both list only the named branches and
fetch nothing. It runs the ordinary forced check, with its fetch under the
project source lock, only for a session whose head moved; that check's realtime
result reaches every viewer and notifies sibling sessions as above. A session's
read also covers each connected copy's main, so a session is checked again when
any of them moves. A probe never overlaps itself, and a tick that passes while one runs
is skipped. A failed probe appears once on the affected sessions' repository
status, is retried every 60 seconds, and is cleared by the check that follows
recovery. The first tick that finds no watching browser and no running turn
reads no Git and leaves no timer; a starting turn or a returning browser
resumes the probe without probing more often than every 30 seconds.
A browser page watches its project over its realtime connection for as long as
it has the project open, whether its tab is visible or hidden, so a person who
returns to a background tab finds its state already current; leaving the project
or the page, or disconnecting, releases the watch, and a reconnected page
watches again. The same watch delivers the project's session summaries, which
carry the probe's results (Direct chat's session change delivery). Returning to a visible tab immediately
repeats worktree fallback inspection; it requests no canonical check of its own.
Explicit source and canonical-change invalidations still force a fresh check.
Switching session chips reuses a recorded canonical check instead of requesting
it again. A session
without a confirmed check still gets its first check, which also records the
session's Git actor; the probe reads a GitHub authority only with an actor that
such a check recorded, and leaves a session without one to that first check.
The registry inspects at most two sessions at a time, the selected session first,
and each session has at most one inspection running and one requested. A change
reaches a session as a burst of realtime events (a turn's checkpoint and idle
state, observed file changes, check results) plus the open view's refresh of the
same task revision, and every tab receives it. Each such request waits until the
session's burst has been quiet for one second, and never more than five seconds
after the burst's first request, then the burst reads the session's work once.
A change that arrives while that read runs may predate it, so it leads to
exactly one further read, which settles the same way. A request that needs the
state now (opening a session, returning to a tab, a Save or Update request, an
explicit refresh, a check's HTTP result) starts at once and takes the settling
requests with it. A change that starts a forced canonical check
(`repository-canonical-changed`, a pull request, a failed Save or Update) reads
the work once, after that check's result; only when no check result asks for
that read (the check failed, or it joined a running check whose forced recheck
failed) does the change ask for it itself. Tabs that receive the same burst
settle on the same events and issue their reads close together, where the
server's shared worktree read below can serve them with one inspection.
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
That shared activity remains visible above an open temporary chat.
An Update or Save task's Progress view offers that operation's own transcript in
a collapsed section. Checking an Update task runs in that task; it never creates a
second task or conversation.

Review resolved conflicts is available on the Update error and in the AI task
window's footer when an Update task's check is stuck on a conflict review. It
snapshots the current conflict review ID and affected paths for the person's
explicit acknowledgement. A changed review or session invalidates the open
confirmation. Confirmation runs the existing Update operation and locks with that
reviewed ID, independently of any AI outcome, and sends nothing to the AI. It
never publishes. An Update task's own check runs Update with the conflict review
the task recorded, through the same Update operation.

Work inspection also settles a failed Update that the session repaired outside
Save or Update, for example its assistant or a person rebasing with Git. The
terminals' read-only `inspectSessionUpdateFailure()` reports, from the session
checkout: whether HEAD contains the saved version the Update was trying to
reach (its recorded `conflictRecovery.canonicalCommit`); whether Update still
has anything to apply, by the check's own rule (the observed canonical commit,
which the failed Update's canonical read remembered, is not in HEAD, or the
saved history was rewritten); any unfinished merge, rebase, cherry-pick or revert
(their Git-directory markers, as `git status` reads them); and any unmerged path.
The sessions service, next to the Save-superseded case, records the failure as
resolved only when the target is in HEAD or nothing is left to apply, with no
unfinished operation and no unmerged path. It appends an
`update-resolved-in-repository` event, clears the code and error, records
`resolvedAtCommit` and keeps the checkpoint and conflict evidence; the write is
guarded to the inspected failed operation. Unreadable evidence leaves the
failure, and its reason, unchanged.

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
up to ten seconds for assistant-write admission before entering repository work;
Save and Update then run whether or not a main-chat turn is open. If preparation still owns the lock at
timeout, the failure identifies reconnection and offers a later retry. The lock
is never bypassed and the browser does not automatically resubmit publication.

An AI task's Cancel passes Update an `AbortSignal`. It stops the checkpoint,
prepare and regeneration stages, whose child forwards the stop to its own Git
process groups, and every later stage; Update then fails with
`vibe64_session_update_cancelled` and leaves the session unchanged, keeping the
conflict evidence a reviewed run was resuming. The apply stage, which changes
the session's files, never receives the signal and rolls back on its own. A Cancel
before Update holds the repository write records nothing. A regeneration stopped
part way leaves its `.vibe64-derived-worktree-*` checkout; the next regeneration,
under the same source lock, removes it and prunes Git's worktree list first.
A drain failure keeps its own code, naming what is still running.

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
acquisition and release are informational events. A caller that tries the lock
without waiting and always falls back or retries (temporary chats' saves and
reads) marks it `expectedRefusal`, and its rejection is informational too.

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
unavailable to catalogue projects, which choose a branch when opening a session.
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
continue using verified project authority. Catalogue rewritten history is
rejected unless the session itself adopted it: its HEAD contains the new
canonical commit and no longer contains its old base. Check, Update and Save then
treat the session as current, and the base moves to the canonical commit.

Switch branch and New branch review the original folder's current branch, HEAD
and configuration, require a clean tree and no merge/rebase/sequencer in progress,
and use native non-forcing Git switch. Creation starts at the reviewed HEAD and
does not set an upstream or push. Older sessions keep their original binding.

Catalogue session creation can list or create branches through the existing project
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
existing original-folder binding instead of using this catalogue override.

Codex, Claude and OpenCode observed writable session turns create private Git
recovery checkpoints on completion, interruption or failure. Temporary chats and
AI task conversations participate; scoped read-only helpers and naming profiles do not.
A Claude turn still running at server shutdown is checkpointed by the next
server's recovery, which interrupts it, not during shutdown, where the
checkpoint's managed job could outlast the shutdown deadline.
Checkpoints preserve the saveable files without advancing the project branch or
changing the index. A turn's ref and the latest pointer are published in one Git
transaction. If another writer advances latest, publication retries up to twice
with the same captured tree parented onto that checkpoint. Both turns remain
recoverable; unrelated Git failures stop immediately. The daemon runs a turn's
whole checkpoint as one command (one managed job under managed execution) under
its per-worktree lock, resolving the commit identity and disk budget before it
starts; each Git step keeps its 30-second limit and the job stops after two
minutes. A job the host refuses, kills or cannot drain fails the checkpoint with
the host's own message and code. A killed run's temporary index directory is
removed by the next checkpoint once it is 15 minutes old. A durable background-task
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
A local-source session's Save and Update exchange work only with the local
folder, so its Git work, the agent's Git commands included, runs as the local
command actor without the GitHub actor or a `gh` login, even when that folder's
own upstream (and so the session clone's origin) is on GitHub. Fetch, Pull and
Push of that upstream stay with the original folder.

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
- Save and Update refusals (`saveError()`) are AppErrors with their
  own code: a 409 conflict, or 400 for a bad request and 404 for a change that
  is gone. Git command and helper failures are 500s with
  their message shown. The repository helper process reports a refusal's
  status and message code, so `runSessionWorkOperation()` rethrows it unchanged.
- `codexGitCommand.js` reads a GitHub actor's token (`gh auth token`) as that
  person, a managed job, and keeps it in memory for five minutes per actor and
  tool home, so repeated session-work operations and the agent's GitHub Git
  commands reuse it. The update probe's GitHub head read uses it in this
  process, only as that request's Authorization header and only for
  https://github.com, the host Git's credential helper serves. A command or
  head read GitHub rejects as unauthenticated (401, failed authentication, bad
  credentials) drops that actor's token, so the next operation reads it again.
  It is never written to disk or logs; the actor authorization hook still runs
  for every operation.
- Writes that record commits (Save, Update and its recovery, in the session's
  own repository or a connected copy) ask `sessionWorkSaveContext()` with
  `createsCommits`; checks, probes and inspections do not and read nobody's Git
  identity. The author is a GitHub session's Git actor, whose credential
  publishes the commit, or for any other repository mode the person asking.
  Where each person has their own OS account (the user credential scope) these
  writes run as the workspace service, so the author's `user.name` and
  `user.email` are read as that person in their tool home every time such a
  write starts: Save Git identity applies to the next Save. Git's exit 1 (none
  set) leaves the gateway's stand-in, named after that person. A read that
  fails (a timeout on a busy host, any other error) uses that person's last
  answered read since the server started, kept in memory per person and tool
  home and replaced by every answer, "not set" included; with no answer yet the
  write is refused before a commit (`vibe64_session_git_author_unavailable`).
  Each failed read logs `vibe64.session_git_author.read_failed`, without the
  name or email. Where Vibe64 runs as the person, the gateway reads their Git
  config itself.
- `repositoryUpdateProbe.js` keeps one probe timer per project in use: a
  browser's realtime project watch, authorized as the `api`-only action
  `vibe64.sessions.project.watch` (a session watch starts no probe), or an
  agent turn that a
  turn-active session event announced and the probe still sees running. The
  sessions service's `probeRepositoryUpdates()` reads every open session's heads
  through the terminals' `readSessionAuthorityHeads()` (one head read per
  authority with a 20-second limit, made as a session's recorded Git actor
  without recording one: `githubRemoteHeads.js` posts one ls-refs request to a
  https://github.com remote with that actor's token unless
  `fetchReachesGithubAsGit()` finds a proxy the server's fetch would not use;
  any other authority, or that case, runs `git ls-remote`) and
  calls the ordinary forced `checkSessionUpdates()` for a moved head. It skips a
  session whose Save, Update or renewal is running. A failure publishes
  `session-repository-check-failed` with `repositoryUpdateCheckError` only when
  its message changes.
