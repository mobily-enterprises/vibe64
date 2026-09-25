# Session storage lifecycle extensions

These server-only operations let an embedding host prepare for session
archival and inspect a fully finalized archive. Standalone Vibe64 registers no
preparation callback and performs no automatic retention, provider deletion, or
native context replacement through these operations. They add no routes, timer,
environment settings, or default retention period. Explicit replacement creates
an optional journal in existing changeover metadata; ordinary sessions and
existing archives require no conversion.

## Preparation before archival

Register through the existing `vibe64.sessions` service:

```js
sessions.setArchivePreparation(async ({ phase, runtime, session, renewal = false }) => {
  // Preserve any additional host-owned evidence before the next archive step.
  // Return normally on success; throw or return { ok: false, error } on failure.
});
```

Pass `null` to remove the callback. Other values are rejected. An ordinary archive
attempt retains the callback selected when that attempt began; renewal reads the
configured callback when it reaches predecessor archival.

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

Renewal invokes the same callback with `renewal: true` after predecessor shutdown
and successor acknowledgement, before preparing the predecessor source/archive.
Its existing workflow lock and quiesced state exclude ordinary session writes.
Use `store.readArtifactForRenewal` and `store.writeJsonArtifactForRenewal` for
host-owned evidence at this boundary; ordinary artifact access rejects quiesced
sessions. `phase` is `stopping`, or `source` when source recovery was already
prepared. Failure follows renewal's existing rollback/retry transaction. Do not
start new session processes from the hook. After committed renewal maintenance
removes the retained predecessor tree, the service publishes `session-archived`
for that predecessor. Hosts can then schedule finalized-archive inspection.
Neither archive path retroactively invokes preparation for historical archives.

## Access to a finalized archive

```js
await runtime.store.withArchivedSession(sessionId, async (session, { publishArtifacts }) => {
  // session.metadata contains the full archived metadata, not its list index.
  // session.sessionRoot and session.artifactsRoot exist only during this call.
  // Optional: await publishArtifacts([{ relativePath: "native/chat.jsonl", sourcePath }]);
});
```

The store holds its existing archive lock for the operation. A remaining active
or closing directory rejects access, including the retained predecessor during
renewal commit. Both published files must exist, the metadata must identify an
archive, tar validation/extraction must succeed, and the extracted session must
have archived status before the operation runs. The published metadata must
identify the exact requested session.

The callback's return value is returned to the caller. An exception propagates.
An optional third argument `{ beforeWork }` runs a trusted host callback inside
the archive lock before extraction and before replacement compression. It
receives `{ stage: "extract", archivePath }` or
`{ stage: "publish", archivePath, sessionRoot }`. Throwing defers work without
changing the published archive. Both prune operations accept `beforeWork` in
their input; native retirement forwards `beforeArchiveWork` to this boundary.
The host owns capacity estimates and any free-space reserve. Standalone access
has no new storage policy.
Both paths remove the temporary extraction and release the lock. Treat the
extraction as read-only and use its scoped `publishArtifacts(files)` capability
for explicit publication. Each of at most 1,000 files supplies a validated
relative artifact path and an absolute regular source file; symlink traversal,
duplicate paths and changed sources fail. A batch copies into artifacts, builds
and validates one compressed archive, syncs it, atomically replaces the published
tar and syncs its parent directory. The archive index, metadata, messages and
archival time do not change. The result is `{ ok: true, paths }`.

Await publication before authorizing destructive work. Failed preparation leaves
the published archive intact; an exception after successful publication does not
undo that publication. A failed batch invalidates its capability, so retry by
opening a fresh archive operation. Do not retain extraction paths or capabilities,
run unawaited work against them, recursively invoke this operation, or call a
separately locking archive mutation while holding this lock.

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

The pure `nativeConversationBindings(session, { retiredOnly? })` helper is
available from `@local/vibe64-terminals/server/nativeConversationBindings` for
host reference checks without provider I/O.

Discovery does not prove exclusive ownership. Arbitrary external CLI homes and
changed directories outside the evidenced scopes are not implicitly covered.
An empty scope list is not proof that there is no native history. The host must
check live **directories as well as IDs**, across projects and pending renewal
or recovery operations. A matching cwd alone is insufficient evidence.
Retirement rows expose ISO `createdAt`/`updatedAt` where the provider knows them:
Codex converts native seconds and OpenCode native milliseconds. Claude supplies
only `updatedAt` from the newest inspected transcript file modification time;
it does not invent a conversation creation time. Exact file identities retain
their original numeric `modified` timestamps for byte-preservation checks.

Retirement holds the archive lock or the open session's agent-write lock. Current
saved bindings are protected in an open session. The mandatory trusted
`beforeDelete({ session, archived, binding, conversations, readConversation?, exportConversation, publishArtifacts? })`
callback receives the complete deletion family. It must durably preserve chat
text, verify the host's compressed recovery copy, exclude external/native CLI
writers for the entire operation and check cross-project references. Only then
return `{ preserved: true, exclusive: true }`. Throw on uncertainty. The owner
inspects again after that callback, refuses a changed inventory, invokes deletion
and verifies absence. Do not take the same session/archive lock recursively.
For an archived session, `publishArtifacts` is the same scoped batch operation
described above. It lets the host publish retained text and recovery artifacts
inside the canonical session archive before returning its preservation proof.
Open accepted predecessors do not have this archived publication capability.

Codex includes active and archived CLI, app-server and subagent threads, discovers
spawned descendants before deletion, and refuses active members or a different
native directory. It supplies regular rollout paths with file identity, size
and modification time in each conversation's `files` array (including an existing
native `.jsonl.zst` sibling). `historyMode` and `nativePath` identify the native
storage contract; a paginated thread can have no materialized rollout file.
Retirement requires modern `paginated` history and fails before deletion for
legacy threads with upgrade/migration guidance. It does not migrate them.

For every Codex conversation, the callback must await
`exportConversation(id, async record => { /* durably preserve record */ })`.
The provider emits these records in order, with native payloads unchanged:

- `{ type: "thread", thread, text: [] }`
- `{ type: "goal", goal, text }`, including `null` when no goal exists
- `{ type: "turn", turn, text: [] }`, paged without loading turn items
- `{ type: "item", turnId, item, text }`, independently paged across the thread

Each `text` array contains `{ role, text, ...provenance }` entries from the existing Codex
user/assistant normalization, or the goal objective. It excludes attachment
payloads; the full native `item` may contain those payloads. Hosts can preserve
these readable chat entries under the conversation ID without parsing Codex
items. Tool output and reasoning remain in the native content export and are
not projected as chat messages. The completed export returns
`{ revision, historyMode, bytes, recordCount, turnCount, itemCount }`; `revision` is SHA-256
over canonical record JSON. Record callbacks are awaited for backpressure.
Cancellation stops provider reads and new records, but an admitted callback must
settle before export exits or releases the enclosing archive lock. The host owns
cancellation of its callback's writes; provider deadlines are checked between
awaited callbacks and do not abandon them.

The provider uses a separate read-only JSKIT connection, with a 64 MiB message
cap, 100 entries per page, 20,000 pages, 2 GiB serialized content and a five-minute
deadline for provider work per export. Cancellation immediately closes this
connection while awaiting any admitted host callback. An oversized single item,
unsupported API, invalid/repeated cursor, active goal, cancellation or sink
failure prevents retirement. It never
raises the shared observer's message limit. Every family export must finish;
the owner then reads it again and requires the same exact content revision,
rechecks native metadata and rollout identities, and calls `thread/delete`.
Native "not loaded" read errors count as absence only after a bounded inventory
of every source kind, provider, directory and archive state confirms the exact
ID is gone. Export revisions omit process-only thread status, direct-input
availability and loaded environments; unloading after a refused deletion does
not invalidate preserved conversation content. Active threads still reject export.

Modern Codex still writes rollout JSONL and projects readable history into
SQLite; paginated mode does not mean database-only storage. Preserve the native
API export and listed rollout artifacts as content-recovery evidence. They are
**not** guaranteed native-resume or importable database backups: fork/revert
lineage may reference other rollouts and the native API does not provide a
complete database export/import contract. Neither a rollout alone nor these
readable exports can be advertised as a full native snapshot.
The Codex text projection covers the currently visible native history. Older
rollouts retained by a previous revert are not all exposed by `thread/read` and
are not promised in this file inventory. Native deletion owns cross-thread fork
reference and writer-lock checks; a referenced rollout causes deletion to fail.

Claude supplies exact
session-owned transcripts, subagents, file history, image cache and uploads;
unsafe paths and ambiguous projects fail. Shared memory, settings, credentials
and unrelated conversations are preserved. OpenCode inventories children and
checks idle status through the client scoped to the saved native directory
before native session deletion. Its callback also receives
`readConversation(id)` for native session information and messages within
the inspected family. Both Claude and OpenCode now require the same
`exportConversation(id, recordCallback)` completion and exact revision recheck
before deletion. Claude emits `{ type: "frame", branchId, frame, text }` from
each inspected main, superseded, orphaned and subagent JSONL transcript, including
sidechains and retained rewind branches. It reuses the bounded native frame
reader (16 MiB per frame); malformed/truncated input fails preservation.
OpenCode emits `{ type: "thread", thread, text: [] }`, then
`{ type: "message", message, text }` using its authenticated server owner and
existing message text normalizer. Native `/session/:id/message` exports one
message per page, newest first, passing the opaque `X-Next-Cursor` header as
`before` until no continuation remains. Raw `{ info, parts }` records preserve
native IDs, timestamps and model attribution from `info.modelID`/`info.providerID`
or the user's `info.model` fields. The export rejects invalid pages, unknown
roles, foreign session IDs, duplicate IDs, repeated cursors, more than 20,000
pages, or a response over 64 MiB. Cursors are limited to 8,192 characters and
message ID suffixes to 256 characters so progress tracking also stays bounded.
A single oversized message fails preservation; no truncated history can
authorize deletion. The experimental V2 cursor endpoint is not used: on
OpenCode 1.18.31 it can return an empty projection while the stable endpoint
still holds messages written through the ordinary bridge. Ordinary conversation
reads retain their existing limits.
Both exports have a five-minute provider-work deadline and 2 GiB record cap,
with the same awaited callback ownership on cancellation. OpenCode storage reads
also enforce a ten-second request deadline and propagate caller cancellation.

All three owners project readable user/assistant text without attachment blocks.
Claude also projects goal conditions; Codex projects its native goal objective.
Reasoning and tool payloads remain only in native content records. Text entries
carry stable `branchId` and available `messageId`, `parentMessageId`, `turnId`,
timestamps and model/agent fields from that provider's native records. Missing
values are omitted; the current model is never invented as an old message's
model. Claude uses transcript-relative branch paths, so subagents and retained
branches cannot silently collapse into their parent. A bounded-export failure
must prevent deletion. SQLite
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

`runtime.store.pruneArchivedSessionArtifacts(sessionId, { relativePaths,
beforePrune })` uses the same archive publication owner for up to 1,000 exact
artifact file paths. It rejects traversal, links and directories, never expands
globs, and supplies `{ session, relativePaths, candidatePath }` to `beforePrune`.
Return `{ ok: true }` to publish. Its result is `{ ok: true, paths }`; absent
files are idempotent. Hosts select expiring recovery files and keep their text
artifacts; this public operation contains no retention dates or automatic policy.

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

OpenCode storage inspection uses its global persisted session inventory and native
record endpoint. Project-scoped listing and the workspace-resolving session endpoint
can lose archived conversations after source removal and a server restart. Native
status remains scoped to the saved directory; history paging and deletion use exact
conversation IDs. Storage inspection never recreates archived source.
