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

## Colleague assignment records

Colleague's optional `assignments` list is created only by an explicit assignment
request. Existing schema-version-1 conversation records remain valid unchanged;
absence means no assignments, and no historical message is inferred to authorize
one. Assignment-linked watches and receipts are new writes in the existing private
conversation record. This addition needs no historical transformation or numbered
upgrade. Runtime interruption handling observes retained operation/message IDs;
it does not backfill assignments or repeat unconfirmed sends.
Optional communication links, dependency IDs and relay receipt references are
written only by new explicit coordination operations. Their absence means no
coordination authority or dependency; old assignments need no conversion.

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

## Teaching pinned snapshots

The schema-version-1 cache under `training/content/<topicId>/<commit>/` is created
only by an explicit admitted owner installation. The new installer uses the
existing pin/bundle shape; no existing snapshot needs conversion or a numbered
historical repair. Readers never create or repair snapshots. Matching verified
retries remain unchanged, while corrupt or conflicting state requires deliberate
operator inspection. A future stored-format change needs a new numbered upgrade
and script-owned backup proof before modification.

Per-revision files under `training/.install-locks/` are persistent OS lock
identities; do not unlink them to clear contention. Interrupted private UUID
staging can be inspected and removed only after its writer is known to have
stopped. Installed content is reconstructible from its exact Git revision and
trusted course pin. This cache policy does not back up learner progress: durable
`training/users` state has a separate recovery requirement and is not yet provided
by this installation facility.

## Private lesson reservations

New schema-version-1 records under `training/users/<authenticated-user-key>/`
are created only by an explicit admitted reservation operation. No existing
application history is transformed and no numbered historical repair is needed
for this new namespace. `progress.json` owns reservation identity/revision;
`active-lesson.json` is a derived summary, not another progress authority.

Ordinary reads never write. Explicit reserve/resume can reconcile a missing or
semantically identical stale valid summary from durable progress under its
persistent user lock. This is operational recovery of the same reservation,
not historical backfill. Corrupt, newer, cross-learner or conflicting records fail
closed. Future stored-format changes still require the normal numbered offline
upgrade and script-owned backups. The store has no automatic backup service;
project archives do not cover this state. The explicit stopped-writer
[learning-state recovery procedure](training-state-recovery.md) preserves private
checkpoint bytes and validates a staged restore through these same readers.
Its focused proof covers filesystem interruption and persistent lock contention,
not actual fleet stopping, off-host retention or future coordinated project restores.

## Training provenance and preparation compatibility

`20261006-training-preparation` records the new-write release boundary for
optional immutable project `training` provenance and learner preparation's
saved initial session identity, `preparing`/`ready` phases and bounded failure
observations. Ordinary project records without provenance and untouched reserved
attempts remain valid and retain their exact bytes. Absence does not authorize
inferred identities, preparation or historical repair.

The script only reports this boundary. Check and apply convert no application
files, invoke no project/session operation and require no data backup. The
existing runner records its ordered completion once; interrupted or completed
retries make no application changes. A candidate whose registry predates this
entry refuses the newer ledger instead of accepting fields/phases it cannot read.
This is a compatibility boundary, not training activation or a permissions grant.
Use the candidate command's normal check, stopped-writer apply and successful
ledger completion before any future release activates these new training writes.
Learner-state backups remain the separate stopped-writer recovery procedure above.

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

## Known routing format compatibility

`20261006-routing-format-compatibility` corrects the upgrade owners' handling of
state already written by a newer supported routing format. Published numbered
scripts remain unchanged. The existing V2 and role-name delegates validate exact
known schema 3/4 configurations and captured routing instead of rejecting them
as legacy Plan/Code settings or downgrading their version. The Helper delegate
also accepts valid current Custom selections and retains its original walk of
owned Helper execution-profile fields. A legacy profile name still follows that
conversion; current format validation does not exempt it. Unknown versions,
unknown roles, invalid selections and incompatible captured configurations still
block preflight.

Schema 4 Senior, Junior, Auto and Custom records already using current routing
and profile names retain their original bytes, model, actor, messages, native
identity and delivery receipts.
They do not gain legacy fresh-admission flags. Actual older state still uses the
original conversions and recovery rules. A terminal `done`/`cancelled` request
with an explicit legacy schema 1/2 tag and no captured configuration retains
its status and receipts, but gains the existing `admissionRequired: true`
restriction after its legacy assignments are validated. The later role/Helper
conversions preserve that restriction when advancing the tag to 4. It is needed
to distinguish this original migration path from an incomplete native schema 4
record; it does not reopen the terminal work or invent a configuration. An
unrestricted native request with missing configuration still fails validation. Current settings that coexist with
retired helper preferences require inspection rather than guessing which choice
should replace the other. This is explicit stopped-service upgrade work; ordinary
reads and startup do not backfill state.

The correction runs read-only validation through all three existing routing
upgrade owners on both `check` and `apply`. It creates no application replacement
or backup; actual legacy conversion and interrupted publication remain owned by
the earlier, separately recorded numbered upgrades. Existing current records
retain their bytes, inode and modification time. Read-only `check` never records
completion; only successful explicit `apply` appends the validation boundary to
the ledger. Existing installations that already completed the old numbered
scripts still run this new validation boundary. An interruption before ledger
publication safely repeats the same read-only validation.

Focused evidence remains in the original routing configuration, routing state,
role-name, Helper and state-upgrade test files, including native pending/completed
receipts, Custom choices and corruption carrying a current version tag.

## Senior, Junior and Intern role names

`20260926-assistant-role-names` changes routing configuration and request snapshots
to schema 3. It renames the `plan`, `code` and `economy` model roles to `senior`,
`junior` and `intern`, and `planCodePair` to `seniorJuniorPair`. The actual Auto
working document remains `workPlan`; its return-to-planning continuation is
`planning`. Runtime parsing and APIs use only the new role names.

The upgrade preserves exact assignments and configuration revision. It visits
main/temporary preferences, request and goal snapshots, renewal successor settings
and transcript attribution in active, closing, archived and prepared sessions.
Message text, native histories, actor identity, pending delivery receipts and plan
documents stay intact. Existing V2 upgrades use their frozen validation and score
format, so an older installation first completes those published operations.

The script reuses the routing upgrade's verified before/after publication engine
with its own `upgrades/backups/20260926-assistant-role-names/manifest.json`.
Preflight is read-only; malformed or ambiguous role records and symlinks block
publication. Interrupted writes resume from the same verified replacements.
Focused evidence: `assistantRoleUpgrade.unit.test.js` and the packaged CLI in
`stateUpgrades.unit.test.js`.

## Conversation working plans

`20260928-completed-discussion-plan` repairs one verified completed-plan incident
that the old Auto discussion path reset to drafting. It matches the exact session,
request identity, plan checksum and display snapshot. Changed plans and later
requests are not reclassified; conflicting snapshots block repair. It restores
only the document status and matching snapshot/revision, preserving all plan
body text, messages, source and actor information. No inference is made from prose.
The existing routing publication engine backs up and verifies both files before
writing, and resumes interrupted publication from its before/after manifest under
`upgrades/backups/20260928-completed-discussion-plan/`. Apply requires stopped
writers. Other installations are no-ops. The runtime fix prevents recurrence;
ordinary reads do not perform historical repairs.

20260929-plan-history moves existing work-plan/plan.md into plans/current.md
inside each conversation runtime. Explicit implemented status becomes completed;
drafting, ready, blocked and paused become active. The document is authoritative:
a routing snapshot inferred from a successful turn never completes the plan.
Body text and messages remain unchanged. Display snapshots are reconciled from
the document, with old receipts and actor attribution preserved. Conflicting old
and new documents or malformed status fail preflight with an actionable error.

The upgrade uses the existing session inventory for active, closing, archived and
prepared-renewal state and temporary conversations. Verified before/after backups
live under upgrades/backups/20260929-plan-history; retries resume publication from
the same manifest, including an interruption between moving the current file and
removing the old path. Check is read-only; apply requires stopped writers. There
is no request-time conversion. New writes use only active/completed and managed
plan commands. New archive snapshots live in plans/archive and are retained by
the existing conversation/session lifecycle. Historical plans without checklists
remain readable; Senior reconciles their checklist on the next requested edit.

A newly admitted cleanup request can carry `task: "deslop"` in that same request
record, while its resolved model role stays Senior. Mixed Auto requests use the
existing failed/unsent state with a `mixed_deslop_request` reason and fixed
explanation. These are new request outcomes, not historical transformations;
no old requests are reclassified or backfilled.

## Helper assignment and execution profile

`20260927-assistant-helper` advances routing configuration and request snapshots
to schema 4. The former `intern` assignment becomes `helper`, retaining the exact
model, thinking, scores and selection provenance. The retired direct-chat choice
becomes Junior for future requests. Already accepted requests and goals retain
their model, actor and receipt identity; historical transcript attribution becomes
Helper without rewriting authored text or native history.

The upgrade converts `economy` execution-profile identifiers, including the
incorrect `intern` classifier identifier, to `helper` in owned snapshots. It
visits active, closing and archived sessions and prepared renewal archives,
including temporary chats, background tasks and prompt-hint cleanup artifacts.
Codex ownership files move to `codex-helper-thread-ownership` with ownership
fingerprints and cleanup references retained. Provider defaults become
`defaultModelId`; those defaults do not select the workflow's Helper model.

The existing verified publication engine backs up every changed file before
publication under `upgrades/backups/20260927-assistant-helper/`. Read-only preflight
reports affected projects; corrupt or conflicting settings and symlinks block
apply. Interrupted publication resumes from the same checked replacements.
Earlier upgrades retain frozen validation, so upgrading from older releases
continues through the ordered ledger. Runtime readers accept only current names.

Focused evidence: `assistantHelperUpgrade.unit.test.js` and `stateUpgrades.unit.test.js`.

## Custom chat selection

`custom` is a new chat mode using the existing exact `override` selection in
`assistant_routing`. It is written only after an explicit Apply. Existing
Senior, Junior and Auto records and pending requests are unchanged, so this
addition requires no historical transformation or numbered upgrade. Custom
requests use the current request schema and the existing native context handoff.

## Independent native provider verification

`20260927-native-provider-readiness` records the release boundary for Claude-only
external connections. Existing saved keys already passed Codex verification and
retain their exact bytes and Claude readiness. New writes may set the optional
`codexDisabled` flag when the selected Claude check succeeds and the independent
Codex check fails. Absence means Codex is enabled. The script performs no
conversion, provider call or backup; ordinary reads never rewrite credentials.

## Mandatory Auto review

New Auto requests always capture the Senior review handoff. The existing
`assistant_routing.review` preference now controls only optional Deslop during
that review; the persisted shape is unchanged. Existing request records retain
their captured handoff decision and are not replayed or backfilled. This is a
new-request policy change and requires no historical transformation.


## Auto implementation continuation

`20260930-auto-implementation-continuation` records the additive release boundary
for new Auto requests' `autoExecution`, outcome and implementation-message fields
and pending/sending/uncertain continuation states. Only a new explicit request
creates this authority and its bounded counters. Existing requests, archives,
plans and native histories retain their exact bytes; absence means no automatic
implementation continuation. No historical conversion or lazy backfill occurs.
The script has read-only check/apply behavior and requires no backup because it
mutates no application files. The runner records the ordinary ordered ledger
entry, preventing older candidates from accepting this newer release boundary.
Retries are no-ops. Delivery and cleanup use the existing request/receipt owners.

## Colleague common conversation runtime

`20261002-colleague-conversation` changes private Colleague records from schema
version 1 to 2. It retains the canonical transcript, model choice, watches,
observations and assignments. The old native conversation/run identity and last
operation receipt move to `retiredConversation`. An executing operation becomes
unknown; interrupted work is not resumed. Native history files are untouched.

The Colleague package owns validation and conversion; the candidate CLI supplies
that operation to the ordered runner. Check is read-only. Apply requires all
services and native writers stopped. Every original `conversation.json` is backed
up under `upgrades/backups/20261002-colleague-conversation/<user-key>/` before the
first replacement. Conflicting backups, changed originals, invalid histories and
symlinked histories fail explicitly. Publication is atomic per record, and retry
keeps already upgraded records and original backups. The upgrade opens no native
conversation, sends no model request and changes no credentials.

## Colleague retained conversations

`20261006-colleague-conversation-history` adds schema version 3 to the existing
private user record. It preserves the active public scope and its exact original
backend identity, transcript, native journal, selection, watches, observations,
assignments and unrelated fields. An empty previous-conversation list adds no
historical chat and starts no work. Only a later explicit Start fresh operation
creates a new chat identity and retains its predecessor; old native files remain
untouched. Older candidate readers must not run against the new format.

Check is read-only and accounts for the earlier pending schema/native upgrades.
Apply requires all services and writers stopped. The owning Colleague operation
validates every record before publication and backs up each complete original
`conversation.json` under
`upgrades/backups/20261006-colleague-conversation-history/<user-key>/` before the
first atomic replacement. Retry retains the exact native identity and original
backup; conflicting backups, malformed active or archived records, links and
changed originals fail. Earlier published scripts remain immutable; their mutable
owners strictly recognize the known new format without rewriting it. No reader,
request or startup path performs the conversion.

## Native delivery journal

`20261003-conversation-native-journal` upgrades existing Colleague runtime
metadata from version 2 to 3 after the outer conversation-schema upgrade.
It preserves conversation identity, configuration, native bindings, predecessor
segments, written history and product data. The last delivered engine is derived
from accepted, nonsuperseded transcript turns. No engine starts during conversion.

An older pending native request has no saved rendered prompt. The upgrade marks
it inspection-only using its exact saved native identity. The runtime may inspect
native delivery evidence; it must not reconstruct or replay that request. Check
reports this condition as a warning. Missing identities, conflicting native fields,
unsupported versions and unfinished Undo operations fail preflight.

OpenCode bindings from an earlier development candidate that lack a saved
`databasePath` are not converted by this step. Their private native database must
be assessed and converted offline before this release can accept them. Preflight
blocks rather than guessing a database location, discarding history or opening a
replacement conversation. Do not remove the binding or edit the upgrade ledger
to bypass that failure. This candidate provides no private-database conversion.

JSKIT owns the pure metadata transformation; Colleague owns enumeration and file
publication. Check is read-only. With services and native writers stopped, apply
backs up every affected original `conversation.json` under
`upgrades/backups/20261003-conversation-native-journal/<user-key>/` before replacing
any record. Publication rereads the original bytes and uses an exclusive temporary
file and atomic rename. A retry retains already converted records and their
original backups. Invalid histories, symlinks, conflicting backups or a writer
changing a record cause an actionable failure. Native databases, credentials and
history files are never changed by this upgrade.

## Main and temporary conversation records

`20261002-session-conversations` converts each main and temporary chat to one
`conversation-log/transcript.json` record. It preserves messages, timestamps,
message IDs, attachments, attribution, answering-model metadata and hidden rewind
turns. Native histories and application admission records are unchanged. Existing
integration setup decisions stay in their application-owned files.

Runtime owns conversion and session/archive inventory. Core's shared file
publisher retains the existing verified before/after manifest procedure. Check
is read-only; apply requires stopped services and native writers. Active, closing,
archived and prepared renewal histories are included. All originals are backed
up under `upgrades/backups/20261002-session-conversations/before/` before any
replacement. Archives are backed up and replaced as complete files. Old message,
attachment, metadata and derived index files are retired after the new record is
published; they remain available in the backup.

Retry validates the original and replacement copies and completes the same
prepared conversion. Conflicting data, invalid records and symlinks stop the
upgrade with an error. Restore damaged backup copies from the operator's backup
before retrying; do not delete the manifest or edit live histories to force an
upgrade. Runtime readers report that an offline upgrade is required when legacy
history remains. Opening a chat never performs historical conversion or sends a
model request as part of the upgrade.

New writes use JSKIT's shared transaction implementation under the existing
session lease. A failed callback or record replacement leaves messages and runtime
receipts unchanged together. This storage upgrade does not by itself migrate
main chat's engine orchestration to the common conversation runtime.

## Conversation Undo retirement

`20261003-conversation-undo-retirement` performs read-only inspection before the
release that removes conversation Undo. It uses the existing session inventory,
including temporary chats, closing sessions, archives and prepared renewal
archives. An unfinished or malformed `assistant_changeover.rewind` blocks the
upgrade before any pending upgrade is applied. Complete the unfinished operation
using the previous release, then stop services and retry the candidate's check.
Do not erase the marker to bypass the check: native and application history may
still disagree.

Completed historical markers, messages, receipts and native history are retained
unchanged. The step changes no application files and therefore needs no data
backup; successful apply only records its completion in the upgrade ledger.
The common runtime's separate native-journal preflight also refuses unfinished
historical Undo operations without replaying or changing them.

## Native speech output identity

New message writes may include JSKIT's optional `outputId` when the native owner
has observed the exact relationship between a live output and its saved message.
This presentation identity does not replace message IDs, turn IDs, native history
keys or delivery receipts. The canonical record stores it with that message so a
read during playback preserves the identity already being spoken.

Existing records remain valid and unchanged. No correspondence is inferred from
old text, no alias table is created, and reads do not backfill the field. Messages
without it retain the existing voice projection. This new-write-only addition
requires no historical transformation or numbered upgrade. Colleague's selected
`interimReply` is separate transient presentation and is never persisted.


## Personal assistant preference boundary

`20261006-personal-assistant-preferences` records a prospective compatibility
boundary for explicit personal avatar/voice writes. The hosted settings owner
uses `assistant-preferences/<authenticated-UID-base64url>/colleague.json` and
`coding.json`, each a schemaVersion1 envelope containing exactly avatar and voice.
Legacy `assistant-settings.json`, including its shared Colleague name, is retained
unchanged. Missing personal profiles use defaults without creating files; corrupt
or unsupported profiles fail closed in the original settings reader.

Apply this boundary through the candidate command with writers stopped before
activating personal writes. It changes only the ordered completion ledger and
requires no data backup: no existing application file is converted or repaired.
Retry is safe after interruption before ledger publication. An older registry
refuses the newer ledger, so do not remove completion entries to bypass downgrade
protection. Focused registry fixtures prove that refusal; they are not evidence
of a deployed old release or live host activation. Avatar/voice preferences do
not change conversation/session identity, microphone state or project access.

## Training assessment compatibility boundary

`20261006-training-assessments` is an appended prospective boundary for optional
schema-version-1 `learning` fields on the existing learner progress and active
summary. Admitted writes can retain pinned assessment evidence, immutable
submission references and the current lesson resume checkpoint. Existing records
without these fields remain valid. Check/apply uses the candidate's original
ordered registry with every learner-state writer stopped before activation.

The script changes only the completion ledger. It reads or converts no application
record, needs no data backup, and is safe to retry before ledger publication. The
prior registry refuses the newer ledger; do not remove ledger entries to enable a
downgrade. This is not a historical repair or proof of a running lesson. The
separate [learner-state backup/recovery procedure](training-state-recovery.md)
continues to preserve the complete private state tree. No request handler, normal
startup or project opening adds absent assessment fields.


## Training attempt-history compatibility boundary

`20261007-training-attempt-history` is appended after the assessment boundary for
explicit new schema-version-1 attempt retirement/history and the empty active
summary. Existing one-attempt reservations remain valid without an `ended` field;
no project or learning history is converted or adopted. Apply the coherent
candidate's complete ordered registry with every learner-state writer stopped
before activating these writes.

The script changes only the completion ledger. Check/apply reads or modifies no
application record, requires no application-data backup and safely retries before
ledger publication. A prior registry refuses the newer ledger; that focused proof
is registry-version refusal, not a deployed old executable or a live upgrade.
Keep the separate stopped-writer [private recovery procedure](training-state-recovery.md)
for ordinary progress protection. Do not drop history or ledger entries to enable
a downgrade. The boundary performs no Stop/archive/delete and activates no lesson
discard/restart control.


## Training question-admission compatibility boundary

`20261007-training-question-admission` is appended after attempt history. It
records the prospective new-write boundary for optional checkpoint
`pendingQuestion.assistance` and `issuedRevision`, native
`turn.metadata.trainingQuestionDelivery` in prepared/delivered phases, and
canonical user `data.trainingQuestion`. Delivered question metadata retains the
actual saved assistant `outputId`; an admitted user snapshot retains the exact
question and its delivery `conversationId`, `turnId` and `outputId`. These facts
associate an answer with a question; they do not grade it or prove a pass.

Configured Learning Main new writes also retain the accepted message and actual
native thread/turn/outer-turn tuple on this optional delivery metadata, together
with the original application-tool and retained Helper receipt formats in the
same canonical transcript. Server-bound Send preserves explicitly captured
`data.trainingQuestion` through ordinary admission and uncertain receipt repair.
These additions are prospective only: existing deliveries without the actual
tuple remain unconfirmed for Main, and absent user associations remain ungraded.
There is no historical reconstruction, replacement native history or lazy repair.

Apply the complete candidate registry with all learner and conversation writers
stopped before activating these writes. Check is read-only; this script reads or
converts no learner, message or turn record. Only the ordered ledger changes, so
no application-data backup is required for this step. Interrupted ledger
publication safely retries. Existing bytes, modes and identities remain intact;
missing historical provenance stays missing and ungraded. No request, account
read, project opening or startup backfills it.

The previous registry refuses the newer completed ledger. The focused test proves
registry-version refusal, not operation of a deployed older artifact or live host
activation. Keep normal stopped-writer backups for application-state protection;
do not delete ledger entries or invent old output associations to bypass the
boundary. This step starts no conversation, sends no message and enables no tool.

## Personal voice policy compatibility boundary

`20261008-personal-voice-policy` is appended after question admission. New explicit
personal preference writes may retain optional `readAloud` for Colleague and
coding assistants, and optional `vocalizeThinking`, `vocalizeInterimTurns` and
`thinkingSounds` booleans for coding assistants only. Existing schema-1
avatar/voice-only profiles remain valid and byte-identical until the person
explicitly saves a preference. Missing fields use the owning host's defaults;
reads, realtime hydration and ordinary startup create or repair no profile.

Apply the candidate registry with preference writers stopped before activation.
This prospective script reads and converts no application file and needs no
application-data backup. Check is read-only; apply changes only the original
ordered ledger. Interrupted publication safely retries, and the previous registry
refuses the newer ledger. The original tests preserve profile bytes, modes,
inodes and timestamps through check, interruption, retry and refusal; this is
registry-version proof, not a claim of live host activation. Published scripts
remain unchanged and the runner's normal backup/locking contract is unchanged.

## New source-less learning session bindings

Constructor-authorized new learning sessions can atomically write the optional
`learning_session` metadata field through the original session staging owner.
It retains schemaVersion1 plus the exact learner, attempt, opaque installed pin,
no-exercise purpose and conversation identity. It contains no absolute execution
path and cannot be changed through ordinary metadata writes. Archive summaries
retain that same binding through their existing metadata whitelist.

Working sessions without it keep their original bytes and behavior. No working
session, old Colleague teaching record, archived transcript or reservation is
inferred to be a learning session; no historical transformation or numbered
repair is needed for this new explicitly admitted namespace. Reads validate,
never create or repair, and refuse a claimed foreign or malformed scope. Future
format changes or adoption of existing history still require the numbered
stopped-writer upgrade procedure with script-owned backups. This prospective
format support alone activates neither a Main launcher nor a lesson.

## Optional learning Codex tool schema identity

An explicitly supplied learning Main tool configuration can write
`codex_conversation_tool_schema_identity`, a lowercase SHA256 hash, in the same
original metadata mutation as its native Codex thread/workdir identity. It
records that native binding's tool entry points, not permission to execute them.
The original binding replacement retires the optional field with its predecessor.
Ordinary unconfigured native identity writes do not add it.

Existing metadata and native histories remain unchanged. Reads validate the
matching native thread and workdir, never stamp a missing hash or reconstruct a
catalogue. A retained thread with absent or differing identity refuses a new
nonempty manifest through the shared native owner before resume. This is a
new-write-only attribute with no historical conversion or numbered repair;
authorized recovery and activation of actual lesson tools remain separate work.

## New source-bearing Learning session boundary

`20261008-learning-practice-sessions` follows personal voice policy. New trusted
constructor scopes can explicitly retain `noExercise:false` in the same immutable
`learning_session` binding, alongside the original real project source metadata.
The original source creator, source descriptor, Genesis environment, conversation
history, Git inspection and archive owners remain in use. A false scope without
its actual configured source namespace is refused; the private native directory
for no-exercise lessons is not a substitute checkout.

Apply the candidate registry with session and learner writers stopped before
activating these new writes. The script reads or converts no application file;
only the ordered ledger changes and no application-data backup is needed for
this prospective step. Check is read-only, interrupted publication safely retries
and the previous registry refuses its newer completed ledger. Existing Working
and no-exercise Learning bindings, metadata and progress are unchanged. There is
no historical adoption, inference or lazy repair. Full practice preparation,
teacher transport and installed learner acceptance require their own proofs.


## Historical preparation-owned practice binding

`20261008-learning-practice-history` is appended after the unchanged prospective
practice boundary. The assembled candidate CLI supplies the Public Training
operation; Core retains registry/lock/ledger ownership. Check and apply require
the exact original saved learner, exercise attempt/pin, immutable managed-project
marker and preparation-owned initial session. Normal and isolated author-preview
state are inventoried separately; conflicting claims block activation. Preview
validation permits drafts only in that existing isolated owner, never for normal
learners. No model/browser path or account claim supplies upgrade authority.

This explicit historical policy adopts only that exact initial session as
source-bearing Learning. Older absence meant Working, so it does not convert every
session in a practice project or infer lesson intent from a name. Unrelated
Working sessions remain unchanged. Source files, Git commits, provider/native
identities, transcripts, learner progress, active summary and assessment receipts
are retained. Preparing does not become ready, ended does not become active,
and a missing ready session is never replaced. Missing preparing effects are
reported without manufacturing them. Corrupt pins/progress, incompatible markers,
multiple incarnations and unsafe aliases refuse the upgrade.

The original Runtime offline owner stages the immutable `learning_session` field;
ordinary reads/writers still refuse historical adoption. Archived initial sessions
require both the tar and its original JSON index. A successfully published
archive may retain the original running/source archive-operation marker; exact
published pair/status/identity supplies completion, not an invented cleared
marker. Active/closing unfinished archive operations and retained renewal state
require inspection through their original owner before conversion. This bounded
upgrade neither adopts a renewal successor nor interprets completion from its
raw marker.

Every changed file has original and replacement copies verified through the
existing upgrade-owned backup manifest before publication. Training revalidates
saved ownership against the frozen replacement binding/archive pair on every
retry, including when the publisher resumes a partly published pair without
calling its preparation callback. Changed authority, modified backup or current
bytes matching neither saved side blocks activation. Keep all writers stopped;
retry the same candidate with the same backup. Never edit the ledger, remove
history or restart an older release against partial state to bypass the error.
Existing native-tool compatibility/replacement recovery remains separate; this
upgrade changes neither installed tool manifests nor native histories.


## Paired Plan and Progress

`20261008-plan-progress` appends the paired work-plan format boundary. With all
session/plan writers stopped, the candidate command reuses Runtime's original
active/closing/scoped/archive/prepared-renewal walk and Core's verified before/after
backup publisher. It inventories exact current and history files, retains original
Markdown/status/inline evidence, legacy archive IDs and times, publishes immutable
plan documents and one atomic paired record, then retires the old path. Separate
progress is absent for old records; no historical evidence is inferred or split.

Check is read-only. Apply creates and verifies this script's before/after backups
under `upgrades/backups/20261008-plan-progress/` before any original is replaced.
The existing publisher's manifest resumes interrupted publication against exact
original/prepared bytes; conflicts, corrupt records, links and changed writers
block activation. Existing current paired records are validated and preserved.
Reads/startup never migrate data. A prior candidate must not run against the newer
ledger/layout. Fresh explicit new Plan writes create empty Progress; replacement
archives both old documents, and Make current restores the exact pair as Active.

The committed paired owner has focused lifecycle, reader, viewer and numbered-
upgrade backup/retry evidence. Those controlled checks do not establish activation
of an existing installation. Before activation, run the candidate's read-only
check, stop all writers, apply and verify the upgrade, and confirm the installed
Plan/Progress and native review lifecycle.

## Retained original native Claude continuity (prepared)

`20261009-colleague-native-continuity` follows the earlier Colleague schema and
native-delivery upgrades and appends after the locally committed Codex tool-policy
row. The separately prepared provider-credential reset is not registered by this
composition and is not a prerequisite; this operation never clears credentials.
It is prepared and focused-tested, not applied to live
installations. Run the candidate command as the original daemon with its original
HOME/configuration; stop all services and native writers before apply.

Only a current, settled original native Claude/Anthropic chat with unchanged
selection and no common runtime or fresh-chat transition is eligible. The
application verifies its actor-private scope, original completed scoped receipt,
single original account pin, original UUID, exact trusted physical HOME and
complete unambiguous native transcript. A newer user, partial tail, active goal,
foreign Colleague claim or unfinished effect blocks conversion. Existing common
bindings and fresh-chat histories are retained. Other retired providers are not
converted by this increment. No model/auth request, native-history move or old
request replay occurs. Original receipts and all canonical messages remain.

Check accepts earlier pending outer schemas read-only; apply requires those
earlier upgrades to have completed schema3. The original backup publisher creates
private verified before/after copies under
`upgrades/backups/20261009-colleague-native-continuity/` before replacing product
records. Native history and scoped receipts remain read-only and are not backed
up by that publisher. On retry, the owner reinspects native evidence against the
original backup and requires the full expected product to match the immutable
replacement, including UUID, account, paths and history cursor. Changed evidence,
backups or product bytes blocks retry. Resolve the reported cause; do not edit
the ledger, force a new account pin or start an older candidate against partial
state. Fresh native account validation still runs before subsequent work.


## Known old Colleague Codex tool policy (prepared)

`20261010-colleague-codex-completed-policy` appends to the published registry.
Neither the separately prepared independent-credential reset nor native-Claude
continuity is a prerequisite. Review the candidate's complete ordered registry
before any apply; preparing this correction does not authorize clearing saved
credentials. It is not a request-time repair.

Only a current Colleague binding with the exact original three-tool discovery
manifest is retired. Current empty/inert bindings, other engines and previous
chats remain unchanged. Missing or unfamiliar retained policies, foreign private
scope paths, pending delivery/replacement/Undo, active saved application turns and
uncertain effects block publication. Apply requires earlier outer-schema and
native-delivery upgrades. Check is read-only, creates no installation or backup,
and reports the affected actor without private message or credential contents.

Run the candidate command with every application, watch and independent product
writer stopped throughout publication. The existing host release mutex excludes
cooperating activation; the original runner's `apply.lock` excludes concurrent
upgrades. These are the established stopped-state upgrade contract, not a new
cross-process Colleague lock. Standalone operators must prevent independent
product writers and manual activation too. A concurrent product-file change
refuses publication; stopping only one writer is not sufficient.

This changes only the application metadata in `colleague/<owner>/conversation.json`.
The shared original `retireNative:true` builder retains the old native binding,
account pin, run/goal metadata and complete canonical history as its predecessor,
and creates an inert successor with the same selected model and trusted saved
paths. No native file, credential or goal is read, deleted, paused or changed;
no global native-writer/goal exclusion is claimed. The next explicit request
validates the current account, creates the empty-tool native binding and seeds
retained history under the original policy without replaying an old request.

The script-owned publisher verifies private before/after copies under
`upgrades/backups/20261010-colleague-codex-completed-policy/` before replacement.
Retries reconstruct the same transition from the verified original and immutable
prepared operation/successor IDs, and compare the entire expected replacement.
An already inert destination cannot skip that check. Modified original, backup,
manifest or product bytes refuse retry. Keep writers stopped, resolve the reported
cause and retry the same candidate and backup; never edit the ledger or start an
older executable against partially published state.
