# Teaching content

Vibe64 validates local topic repositories and produces reproducible lesson bundles.
This authoring facility does not execute exercises or teach a learner. Server-only
facilities install exact verified snapshots from admitted owner-selected local
sources and check pinned reads. Private server-only state retains one exact lesson
reservation per learner. Assessment progress, teaching runtime, hosted provisioning
and public installation/start actions are not provided yet.

## Sources

- `packages/vibe64-training/src/server/contentSchemas.js`
- `packages/vibe64-training/src/server/content.js`
- `packages/vibe64-training/src/server/catalogue.js`
- `packages/vibe64-training/src/server/cli.js`
- `packages/vibe64-training/src/server/installedContent.js`
- `packages/vibe64-training/src/server/contentInstaller.js`
- `packages/vibe64-training/src/server/learnerState.js`
- `packages/vibe64-core/src/server/projectRecordMetadata.js`
- `bin/run.js`
- `docs/training-content.md`
- `docs/training-state-recovery.md`
- `docs/templates/learn-topic/README.md`
- `tooling/release/runtime-package.mjs`
- `docs/colleague-usage/teaching-content.md`
- `tests/server/vibe64TrainingContent.unit.test.js`
- `tests/server/vibe64TrainingInstalledContent.unit.test.js`
- `tests/server/vibe64TrainingContentInstaller.unit.test.js`
- `tests/server/vibe64TrainingLearnerState.unit.test.js`
- `tests/server/studioProjectContext.unit.test.js`

## Public contract

The release ships a copyable whole-topic template and its authoring guide. The
template validates as one draft lesson, without exercise or visual capabilities;
authors replace its placeholders and review learning outcomes before publication.

`vibe64 training validate <topic-directory>` validates versioned topic, lesson and
visual schemas, explicit rubric anchors, declared checks, relative file boundaries,
local prerequisites and continued exercise sequences. Drafts remain labelled as
drafts; a released topic cannot include required draft lessons. Topic-level external
prerequisites need catalogue resolution beyond this local command.

`vibe64 training bundle <topic-directory> <new-output-directory>` writes exact
validated files and a completion manifest, outside the source. It refuses existing
output and cleans only a newly owned failed output. Byte changes while copying fail
the command. Sorted path/hash/size manifests determine lesson identity; installed
dependencies, Git state and unrelated documents are excluded. The topic manifest
adds metadata, outline and ordered lesson identities. Nothing is fetched or executed.

`vibe64 training publish-manifest <course.json> <committed-topic-directory...>`
selects complete ordered topic releases. It validates clean repository roots and
compares every included input against the exact Git commit before atomically
replacing the sibling `course.lock.json`. Repository metadata comes from the
pinned commit rather than a later working-tree read. Output cannot replace its
input descriptor or live inside a pinned source topic, including physical aliases.
Locks contain repository, immutable commit, manifest hash and ordered lesson
identities. Released courses require
released topics without required drafts. This is local authoring, with no Git
push, remote release, installation or course enabling.

Practical descriptors name evidence producers/checks; this facility validates their
references but does not manufacture observations, run checks or evaluate progress.
Application execution, learner permissions and teaching remain Vibe64 concerns,
with no teaching semantics in JSKIT or Genesis.

## Installed pinned reads

`@local/vibe64-training/server/installed-content` exports
`createInstalledTrainingContent({systemRoot})`. The server chooses an absolute
system root; requests choose validated topic IDs, exact commits and lesson hashes,
never filesystem paths. A trusted topic hash from the course lock or saved attempt
is mandatory for both reads and fences even a self-consistent cache replacement.
Snapshots live under
`training/content/<topicId>/<commit>/` with `pin.json`, original CLI `bundle.json`
and its `files/` snapshot. The pin identifies schema, topic, release, canonical
repository, commit and topic hash.

`readTopic` reuses local validation and compares the complete ordered bundle,
identity and file inventory. It rejects symlinks, changed/missing/extra files and
invalid pins. `readLesson` selects only a published lesson at its exact hash and
returns the checked document, rubric sections and visual descriptors. Reads never
write, repair, fetch, run checks, enable a course or declare an assessment passed.
An absent or invalid snapshot reports reinstall guidance. Catalogue enablement is
not part of a pinned read, so a future existing attempt can continue after its
release is disabled; new-start permission remains the application action's job.

## Verified installation

`@local/vibe64-training/server/content-installer` accepts only a server-owned
absolute system root, canonical local source repository and complete trusted pin.
The admitted owner caller supplies permission and approved content selection; this
service is not an HTTP/assistant action and does not enable a course. It reuses
`readPinnedTopic`, the original CLI bundle and installed reader, rather than
creating a second validator or copier. Pin validation is shared with the reader.

A persistent per-revision OS file lock covers cooperating installation writers.
The installer stages privately, verifies the clean source identity again and
validates all staged bytes before atomic directory publication. Outside writers
must not modify this owned namespace during publication. Matching verified retries
are unchanged; existing empty, conflicting or corrupt destinations are refused.
Alias/path containment checks precede owned mutations. Busy locks report a retryable
409 without deleting their persistent inode. Failure removes only its own UUID
stage; killed-writer stages remain for deliberate operator inspection. The service
does not fetch Git, run authored code, recursively repair permissions, alter learner
history or perform historical data upgrades.

## Private reservation authority

The internal learner-state API receives actor and course provenance from the
admitted composing caller; it does not authenticate objects or expose browser
paths. It verifies the exact installed published topic/lesson pin and uses the
existing identity key convention without a local fallback. Private state outside
projects owns one active attempt, revision, stable request receipts, server UUID
and project slug, initially `reserved`. Project/session effects and assessment
evidence remain separate future operation responsibilities.

`progress.json` is authoritative and is saved before its derived
`active-lesson.json`. Duplicate request IDs are resolved before stale revision
checks and cannot change their full pin. New IDs reuse the same active pin rather
than creating another exercise; conflicting pins require explicit recovery. The
existing Kernel persistent file lock serializes cooperating user-state writers.
Read-only projection never creates or repairs records. Explicit reserve/resume
reconciles only missing or semantically identical stale valid summaries; corrupt
state fails closed. Saved-summary and unconfirmed-progress errors distinguish
durable reservation from uncertainty and require the same retry identity.

The original Core metadata atomic writer is renamed/exported within its same
module, retaining its JSON bytes, temporary-file identity, exclusive write, rename,
cleanup, updater queue and default modes. Only optional file/directory modes allow
the new private 0600/0700 state. This is reuse of one original operation, not a
parallel writer. The original metadata tests remain evidence alongside the new
reservation cases. New schema-version-1 files are explicit writes without a
historical transformation or lazy startup backfill. Backup/restore of learner
state remains operator-owned, outside project archives. The documented stopped-writer
procedure uses ordinary private filesystem copies and the original read-only
validators; it preserves the previous tree through explicit two-rename restore
and refuses invalid records/pins before publication. Tests execute its actual
snippets. Live host stopping and off-host retention are not established by those
filesystem fixtures.
