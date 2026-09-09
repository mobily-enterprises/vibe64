# Save session work

People can deliberately publish the complete current session work to the
project's configured source authority without asking the coding agent to run
Git commands.

## Sources

- `packages/vibe64-runtime/src/server/sessionStore.js`
- `packages/vibe64-runtime/src/server/agentWriteLock.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-terminals/src/server/sessionWorkOperationCommand.js`
- `packages/vibe64-terminals/src/server/sessionWorkSave.js`
- `packages/vibe64-sessions/src/server/service.js`
- `src/components/studio/Vibe64TemporaryActionTerminal.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64SessionPanel.js`
- `src/composables/useVibe64SessionRepositoryStatusRegistry.js`

## Public contract

Save captures tracked, staged, unstaged, and relevant untracked session work,
asks the session's selected assistant to give that exact checkpoint a concise
commit subject, and publishes one ordinary commit to the exact configured
GitHub, managed-Git, or local-source authority. It refuses ambiguous authority,
changed session history, dirty local authority, or a moving canonical branch.
Worktree edits made after capture are left as unsaved work on top of the named
checkpoint. The non-force publication itself rejects a stale concurrent
publisher; Save does not inspect sibling worktrees first. Progress and bounded
command output remain visible across reloads. A verified publication advances
the session baseline and preserves any later session edits; an interrupted
Save is reconciled only when the canonical authority proves the privately
recorded prepared commit was already published. Disposable GitHub mirror
maintenance runs after Save completes and cannot change the Save result.

While Save runs, the workspace shows one compact progress line. Opening its
details reveals the bounded command progress; while work is active, Collapse
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

Each Save or Update attempt starts a fresh visible transcript. Retrying after a
failure does not mix the earlier attempt's errors into the new operation.
That shared activity remains visible while a Temporary AI repair is selected.
Checking the existing Update repair does not create a second temporary chat.

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

## Implementation map

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
