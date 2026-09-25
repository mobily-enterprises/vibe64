# Session archive lifecycle extensions

These server-only operations let an embedding host prepare for ordinary session
archival and inspect a fully finalized archive. Standalone Vibe64 registers no
preparation callback and performs no automatic retention, provider deletion, or
native context replacement through these operations. They add no routes, timer,
environment settings, or persisted-state format.

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

## Focused evidence

`npm test -- tests/server/vibe64SessionStorageLifecycle.unit.test.js` covers
default behavior, ordering and current metadata, preparation failure and retry,
later-phase recovery, exclusion of competing writers, full archived metadata and
recovery access, preservation of archived History, temporary-file cleanup,
invalid/incomplete archives, and serialization across store instances.

This evidence does not establish end-to-end provider retirement or same-session
native context replacement. Those operations require separate implementation
and provider-specific acceptance tests.
