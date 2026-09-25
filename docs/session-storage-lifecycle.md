# Session storage lifecycle extensions

These server-only operations let an embedding host prepare for ordinary session
archival and inspect a fully finalized archive. Standalone Vibe64 registers no
preparation callback and performs no automatic retention, provider deletion, or
native context replacement through these operations. They add no routes, timer,
environment settings, or default retention period. Explicit replacement creates
an optional journal in existing changeover metadata; ordinary sessions and
existing archives require no conversion.

## Preparation before ordinary archival

Register through the existing `vibe64.sessions` service:

```js
sessions.setArchivePreparation(async ({ phase, runtime, session }) => {
  // Preserve any additional host-owned evidence before the next archive step.
  // Return normally on success; throw or return { ok: false, error } on failure.
});
```

Pass `null` to remove the callback. Other values are rejected. An admitted
attempt retains the callback selected when that attempt began.

The callback runs under the session agent-write lock, after the ordinary
terminal/output shutdown stage and before resource release or source archival
continues. It receives a freshly read session. New chat work is already blocked
by the session's closing marker. This does not independently prove the absence
of native CLI writers or untracked provider child processes.

`phase` is the existing durable archive phase: `stopping`, `resources`, or
`source`. At `stopping`, shutdown has returned but the next phase has not been
recorded. Resumption at later phases does not repeat shutdown. A previous archive
attempt may already have removed source before publication was interrupted;
the callback must handle that existing evidence, not assume a worktree exists.

The callback is invoked again on retry. It must be idempotent, and must durably
record any host-owned work that needs to survive a crash. An exception or a
structured `{ ok: false, error, code? }` result stops progress and uses the
existing failed-archive state and explicit retry. This hook does not create a
separate completion ledger, retry worker, or historical backfill.

Use preparation to preserve or reconcile evidence. Do not delete native history
here: Vibe64's archive has not yet been published. Do not recursively call
`archiveSession` or acquire the same agent-write lock from this callback.

Renewal uses its separate transaction and does not invoke this callback. An
embedding host must not assume it captured every renewal or historical archive.

## Access to a finalized archive

```js
await runtime.store.withArchivedSession(sessionId, async (session) => {
  // session.metadata contains the full archived metadata, not its list index.
  // session.sessionRoot and session.artifactsRoot exist only during this call.
});
```

The store holds its existing archive lock for the operation. A remaining active
or closing directory rejects access, including the retained predecessor during
renewal commit. Both published files must exist, the metadata must identify an
archive, tar validation/extraction must succeed, and the extracted session must
have archived status before the operation runs. The published metadata must
identify the exact requested session.

The callback's return value is returned to the caller. An exception propagates.
Both paths remove the temporary extraction and release the lock. Treat the
extraction as read-only; changes to it are not republished. Do not retain its
paths, run unawaited work against them, recursively invoke this operation, or
publish the same session's archive while holding this lock.

An embedding host decides when to call this operation and how to record failures
and retries. No post-archive callback is implicitly scheduled, so a process crash
cannot be mistaken for successful host maintenance. Explicit inspection can be
retried against finalized ordinary and renewal archives without reopening them.

Archive validity proves that Vibe64's saved records can be read. It does not prove
that all native messages or attachments were reconciled, that a provider has
stopped writing, or that a native conversation belongs exclusively to this
archive. A consumer must establish those facts through provider lifecycle owners
before any destructive cleanup. This API performs no provider cleanup itself.

## Native inventory and explicit retirement

The existing `vibe64.terminals` service supplies these server-only operations:

- `listAgentConversationStorage(sessionId, { runtime })`: saved native bindings
  in a finalized archive, or accepted predecessors in an open session.
- `scanAgentConversationStorage(sessionId, { runtime, session? })`: query each
  evidenced native home/directory and return `{ scopes, conversations }`.
  `tracked: false` identifies additional candidates such as native `/new` and
  forks. It is read-only; archive preparation may pass its current session
  without reacquiring that callback's agent-write lock.
- `retireAgentConversationHistory(sessionId, { engineId, conversationId,
  discoveredIn? }, { runtime, beforeDelete })`: retire an archived native binding
  or accepted predecessor. A native-only candidate requires its exact
  `discoveredIn` scope from a finalized archive. The provider independently
  verifies the native directory.

Discovery does not prove exclusive ownership. Arbitrary external CLI homes and
changed directories outside the evidenced scopes are not implicitly covered.
An empty scope list is not proof that there is no native history. The host must
check live **directories as well as IDs**, across projects and pending renewal
or recovery operations. A matching cwd alone is insufficient evidence.

Retirement holds the archive lock or the open session's agent-write lock. Current
saved bindings are protected in an open session. The mandatory trusted
`beforeDelete({ session, archived, binding, conversations, readConversation? })`
callback receives the complete deletion family. It must durably preserve chat
text, verify the host's compressed recovery copy, exclude external/native CLI
writers for the entire operation and check cross-project references. Only then
return `{ preserved: true, exclusive: true }`. Throw on uncertainty. The owner
inspects again after that callback, refuses a changed inventory, invokes deletion
and verifies absence. Do not take the same session/archive lock recursively.

Codex includes active and archived CLI, app-server and subagent threads, discovers
spawned descendants before deletion, and refuses active members or a different
native directory. It supplies regular rollout paths with file identity, size
and modification time, then calls native `thread/delete`. Claude supplies exact
session-owned transcripts, subagents, file history, image cache and uploads;
unsafe paths and ambiguous projects fail. Shared memory, settings, credentials
and unrelated conversations are preserved. OpenCode inventories children and
checks idle status through the client scoped to the saved native directory
before native session deletion. Its callback also receives
`readConversation(id)` to export native session information and messages within
the inspected family; a bounded-export failure must prevent deletion. SQLite
deletion does not promise immediate disk reclamation.

Known missing data is idempotent; unknown APIs, connection failures and uncertain
responses remain errors. Keep the preservation receipt on failure, including a
lost response after native deletion. Re-enumerate the receipt's members on retry:
a missing parent does not prove that every child disappeared. These hooks do not
compress native files, import native-only chat text into History, prove complete
attachment preservation or exclude unmanaged processes. The host owns those
steps and its retry ledger. No live rollout is rewritten or compressed in place.

## Replace native context within one open session

`terminals.replaceAgentConversation(sessionId, { operationId,
expectedConversationId, handover }, { runtime, vibe64User })` requires a stable
operation ID, exact predecessor ID and a nonempty briefing of at most 65,536
characters. Normal assistant access applies. Active turns, open native terminals,
workspace preparation, pending delivery/routing/helper cleanup, incomplete Undo,
unfinished goals and active temporary work block replacement. The operation does
not generate a summary or start inference.

The optional `assistant_changeover.replacement` journal is saved before shutdown
or binding changes. `preparing` blocks ordinary admission and startup recovery
until the exact operation is retried. Confirmed shutdown precedes clearing old
resume bindings and agent-run thread pointers. Session ID, source, visible chat
and attachments remain intact. `ready` causes the next ordinary Send to deliver
the briefing plus recent visible messages to a fresh native ID; terminal/goal
entry waits for that briefing. Existing admission receipts recover lost responses
without repeating inference. Confirmation records `accepted` and adds the old
binding to `retiredConversations`; it does not delete it. Explicit successful
retirement removes that ownership record. This is summarized continuity, not
exact native resumption. Timing and user-facing notice belong to the host.

## Expire archived attachment payloads

`runtime.store.pruneArchivedSessionAttachments(sessionId, { beforePrune })`
holds the finalized archive lock. It removes only regular
`artifacts/attachments/<uuid>/file` payloads from temporary extraction, creates
and validates a compressed replacement, then invokes
`beforePrune({ session, attachmentIds, candidatePath })`. The host checks its
expiry policy, records its receipt and returns `{ ok: true }` to permit a single
atomic rename. Failure before publication leaves the original archive intact.

Chat text, attachment descriptions and message references, other artifacts, the
archive index and the original archival date stay intact. Repeating expiry when
no payload remains succeeds without rewriting the archive. Unknown entries and
unsafe paths fail. Temporary paths are valid only during the callback. The host
owns retention dates and expired-attachment presentation; no timer is added.

## Focused evidence and acceptance limits

`npm test -- tests/server/vibe64SessionStorageLifecycle.unit.test.js` covers
default behavior, ordering and current metadata, preparation failure and retry,
later-phase recovery, exclusion of competing writers, full archived metadata and
recovery access, preservation of archived History, temporary-file cleanup,
invalid/incomplete archives, and serialization across store instances.

Archive tests also cover atomic attachment expiry, unchanged text/descriptions
and failure/retry. `assistantChangeover.unit.test.js` covers native replacement,
interrupted writes, fresh successor checks and lost admission receipts.
`nativeConversationRetirement.unit.test.js` covers native inventories, complete
families, preservation-before-deletion, changed files, unsafe paths, removed
source and confirmed absence. The numbered upgrade records an additive release
boundary without rewriting application state.

Mocked responses prove control flow, not pinned-provider runtime compatibility.
Before enabling a host policy, verify native `/new`, fork and child discovery,
compressed-copy completeness, native-only text retention, external writer
exclusion, partial deletion recovery, account changes and continued archive
reading against installed providers. These tests do not establish live provider
retirement or production retention rollout.
