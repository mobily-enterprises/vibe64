# Persisted state upgrades

Historical metadata repairs belong in versioned upgrade scripts, not account
reads, request handlers, project opening, or ordinary server startup. Normal
writes create the current format. Runtime code may validate that format and
report a useful error; it must not accumulate old-format repair branches.

This applies to Vibe64-owned application data as well as small metadata files:
message histories, conversation records and other saved formats need a numbered
upgrade when existing records must change. Ordinary new writes use the current
format; a format change must account for existing installations in the same
release. Customer application databases retain their own migration owner.

The owner is `packages/vibe64-core/src/server/stateUpgrades.js`. Its ordered
registry imports scripts from `stateUpgrades/`. The release builder includes
the standalone `bin/upgrade-state.js` command in every runtime package. Hosting
operators own stopping services, invoking this command, and activating the
candidate release. This command does not start or stop services itself.
The CLI supplies the routing feature's upgrade operation to the Core runner;
Core does not import Accounts or Runtime. Call the assembled CLI for deployment,
so every registered upgrade has its owning implementation.

## Implemented API and backup responsibility

The current script interface is `{ id, run }`, with an async
`run({ systemRoot, apply, backupRoot, report })`. The runner invokes it with
`apply: false` for inspection and `apply: true` for changes. It supplies a private
backup destination, but **the script must create and verify its own backups
before modifying existing data**. The runner owns ordering, locking and the
completion ledger; it neither discovers affected paths nor automatically copies
them. It does not sandbox a script's filesystem writes or provide automatic
rollback. Review and focused tests must establish backup coverage and retry
behavior for each upgrade.

There is no runner-level directory manifest, `prepare()` callback or `backupPaths`
return value today. Returning such an object from `run()` has no effect on backup
behavior. Follow the implemented API below when authoring an upgrade.

## Operator workflow

Use the **candidate release's** executable and the actual installation's Vibe64
system directory, under the same OS identity that owns that state:

```sh
node /candidate/bin/upgrade-state.js --system-root=/absolute/vibe64/state --check
# Stop the service and every other writer to this state before applying.
node /candidate/bin/upgrade-state.js --system-root=/absolute/vibe64/state --apply
# Activate the candidate only after successful completion.
```

`--check` does not create installation directories or change metadata. Archive
inspection may use temporary scratch space outside the installation, removed
after inspection. It inspects every
pending upgrade and prints INFO and WARNING diagnostics. `--apply` holds an
exclusive lock, checks pending work again, then applies it in order. It records
each completed script atomically in `<systemRoot>/upgrades/applied.json`.
Completed entries are never run again during normal deployment. A fresh
installation records successful no-ops so later releases use the same history.

An ERROR exits nonzero and must block activation. Earlier completed upgrades
remain recorded; a failing upgrade remains pending. Correct the reported cause
and retry with writers stopped. Scripts must tolerate interruption between their
own write and the ledger write. There is no automatic downgrade: never restart
an older executable against partly upgraded state without assessing schema
compatibility and restoring a consistent backup where necessary.

`upgrades/apply.lock` excludes other apply processes. If a process is killed,
confirm it and all other writers have stopped before removing the stale lock.
Do not delete or edit `applied.json` to force a repair. Malformed, reordered,
unknown, or newer ledger history is an error requiring operator inspection.
Backups live below `upgrades/backups/<upgrade-id>/`, with private permissions;
they are recovery evidence and are never overwritten silently.

## Adding an upgrade

1. Add a uniquely numbered, descriptive script and append it to the registry.
   Use the established date-based ID with an ordering suffix when needed.
   Published IDs, ordering and behavior are immutable. Add a new corrective
   script if a released upgrade needs fixing.
2. Export `{ id, run }`. `run({ systemRoot, apply, backupRoot, report })` must
   inspect exact owned paths. With `apply: false`, inspect only; describe changes,
   skips and suspicious state. Check all relevant inputs before the first write.
   Preflight runs against the original installation, so accept documented input
   states that an earlier pending upgrade will transform.
3. Distinguish a supported old shape from corrupt or unsupported data. Throw on
   uncertainty that would risk data loss. Emit actionable warnings for supported
   unusual cases. Never include tokens, credentials, or full metadata in logs.
4. Apply only with writers stopped. Preserve an original backup before changing
   existing data; use atomic replacement, private permissions and the correct OS
   owner. Preserve unrelated fields. Make retries safe after every write, without
   generating a second identity or repeating destructive work.
5. Add focused tests for old/current/fresh state, check-only behavior, warnings,
   malformed input, interruption/retry and failure. Update affected Blueprint and
   Program explanations, this catalog, and any host operation needed by the new
   state owner. Keep migration logic out of normal application paths.

Do not use this mechanism to rewrite provider-owned credentials or repair source
permissions opportunistically. Project-specific upgrades must explicitly
enumerate their canonical state through its owning subsystem and report each
affected project; never infer it from the current editor tab.

## Example: changing saved message format

A message-format upgrade must discover the actual canonical stores through the
conversation subsystem, including archived conversations. Do not assume example
paths are the real storage layout or migrate only currently open projects.

During read-only inspection, identify supported old and current formats, report
affected stores and counts, and fail on unrecognised or corrupt data. During
apply, re-read inputs with writers stopped, back up affected stores, transform
into temporary files, validate the results, and replace originals atomically.
Preserve message IDs, timestamps, ordering, relationships and unrelated fields.
Large histories may be processed one conversation at a time. An interrupted
retry must recognise already-converted records without converting them twice,
and must retain the original backups rather than replace them with partly
converted data. Test mixed old/current stores and interruption between writes.

When exact resulting filenames are unpredictable, define a bounded owning
directory and back it up in full before changes. Do not follow links into
unrelated state or recursively copy the backup directory into itself. Database
stores need a consistent database backup/transaction strategy, not a blind copy
of live database files. Document the chosen recovery procedure in the upgrade's
catalog entry. These responsibilities currently belong to the script.

## Proposed backup declaration: not implemented

A discussed extension would split scripts into `prepare()` and `apply()`.
Preparation would discover affected paths and return a declaration such as:

```js
return {
  backupPaths: [
    "conversations/abc/messages",
    "conversations/xyz/messages"
  ]
};
```

These paths illustrate a proposal, not today's storage layout or supported API.
The intended entries are exact files or directories relative to `systemRoot`,
with directories backed up recursively by the runner before apply. A script
could declare a broader containing directory when it cannot predict individual
file changes; existing data would not need a different layout.

Implement and verify runner support before using this declaration. Such support
must define path validation, backup completion, interrupted retries and recovery;
a path declaration alone does not enforce a script's write scope. Until then,
the implemented script-owned backup contract above remains authoritative.

## Catalog

`20260925-native-conversation-lifecycle` records the additive native replacement
journal release boundary. Existing `assistant_changeover` records and archives
remain valid without the optional `replacement` and `retiredConversations`
fields. Absence means no replacement; there is no historical conversion or lazy
backfill. Check and apply change no application/native files, so this script
needs no backups; the runner only appends its normal completion ledger entry.
Retries are no-ops. The ledger lets an older candidate detect newer state rather
than silently ignore a partially completed replacement. New explicit replacement
operations journal their own transitions through ordinary metadata writes.
Archive attachment expiry retains the existing archive/description format and
is an explicit host lifecycle operation, not a historical metadata repair.

`20260923-codex-login-id` adds a random local UUID to an existing connected
`auth/codex/status.json` marker that lacks `loginId`. It preserves an existing
valid ID, timestamps, unrelated fields and auth-transition state. Missing or
disconnected markers need no change. Unsupported versions, invalid JSON and an
invalid existing ID block activation. The warning explains that old temporary
assistant ownership will not transfer to the new identity.

This ID belongs to the Vibe64 installation's Codex connection. It is not an
OpenAI account ID and is never written to native `auth.json` or sent as an
OpenAI authentication field. All projects using that connection share it; this
upgrade does not rewrite canonical project source or project metadata. New
successful sign-ins create their ID through the ordinary login flow.

`20260923-routing-v2` upgrades `ai-connections/routing.json` to workflow profiles
with Plan, Code, Economy, Router and shared Backup. It preserves exact saved
choices and seeds Router from the former classifier's Economy assignment. It
records conflicting legacy helper destinations for owner review before retiring
the native helper preference files and per-connection `helperModelId` fields.
Unrelated connection fields and credentials are preserved. Missing routing on
an existing installation receives included OpenCode defaults; additional workflow
profiles use exact selections evidenced by saved sessions. A new installation
with no saved state remains a no-op and uses ordinary explicit setup.

Project and session owners enumerate closed projects, active/closing sessions,
temporary chats, archives and prepared renewal archives. It also inventories the
store's pending renewal records and backs up changed ones: an approved historical
successor retains its exact model as a Code override, with review off and its own
evidenced workflow. Completed and cancelled renewal records remain unchanged.
Routing metadata gains
workflow identity and captured Router references. Legacy direct conversations
retain their exact model and editing behavior; temporary native IDs and scoped
changeover state remain intact. Old unfinished requests retain their original
actor, messages and receipts and require new admission before another inference.
Conflicting unfinished workflow evidence or corrupt/incomplete archives block
apply with a recovery error. No provider calls or native-history rewriting occur.

This script owns `upgrades/backups/20260923-routing-v2/manifest.json`, plus `before/`
and `after/` copies using paths relative to the system directory. All original
and replacement files are prepared and checked before publication begins. The
manifest records their checksums; a null original means the upgrade creates a
new file, and a null replacement means it retires a preference file. The routing
configuration is published first, session files next, and retired preferences
last. Retries validate every backup and destination, accept only the original or
prepared bytes, and finish the same conversion without selecting models again.
The script's private manifest is recovery evidence, not a generic runner API or
automatic rollback mechanism. Do not delete it to force a fresh migration after
partial publication.

Focused evidence: `assistantRoutingConfigurationUpgrade.unit.test.js`,
`assistantRoutingStateInventory.unit.test.js`, `assistantRoutingStateUpgrade.unit.test.js`
and `stateUpgrades.unit.test.js`, including the packaged CLI and interrupted
publication before ledger commit.

## Conversation working plans

Working plans are new conversation-owned artifacts, created only by explicit
planning work. They do not transform existing history or metadata and require no
historical backfill. The existing request record may carry a `workPlan` display
snapshot and approved content revision plus a `continuation: "plan"` for a blocked
coding handoff. Absence means there is no approvable plan, never inferred approval
from old conversation text. Existing admitted requests retain their receipts;
new Auto coding requires a current approved document. Main plans are stored under
`work-plan/plan.md` inside the session runtime, and temporary plans under the
existing conversation directory. Existing archive and explicit-close operations
own these files together with their surrounding conversation state.

A newly admitted cleanup request can carry `task: "deslop"` in that same request
record, while its resolved model role stays Plan. Mixed Auto requests use the
existing failed/unsent state with a `mixed_deslop_request` reason and fixed
explanation. These are new request outcomes, not historical transformations;
no old requests are reclassified or backfilled.
