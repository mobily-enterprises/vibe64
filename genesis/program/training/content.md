# Teaching content

Vibe64 validates local topic repositories and produces reproducible lesson bundles.
This authoring facility does not execute exercises or teach a learner. Server-only
facilities install exact verified snapshots from admitted owner-selected local
sources and check pinned reads. Private server-only state retains one exact lesson
lesson in progress per learner, its Learn mode flag, completed lessons and bounded immutable ended-attempt history. An internal installed catalogue validates approved whole
course locks and toggles enablement without changing their pinned release identity.
An official catalogue installer lets any signed-in person browse the configured
GitHub catalogue and install or update an exact hash-pinned course release through
those same owners.
Internal assessment and resume writes retain pinned evidence and derive lesson
completion. The shared preparation coordinator composes these original state/content
owners with existing project, repository, session and Workspace setup facilities.
Colleague teaches from lesson steps. The module alone does not provide
infrastructure or prove a delivered lesson.

## Sources

- `packages/vibe64-training/src/client/TrainingLessonPicker.vue`
- `packages/vibe64-training/src/client/TrainingCoursePage.vue`
- `packages/vibe64-training/src/client/TrainingCourseCreator.vue`
- `packages/vibe64-training/src/client/courseProgress.js`
- `packages/vibe64-training/src/client/TrainingCourseCatalogue.vue`
- `packages/vibe64-training/src/server/courseInstaller.js`
- `packages/vibe64-execution/src/host/execHelper.js`

- `packages/vibe64-training/src/server/contentSchemas.js`
- `packages/vibe64-training/src/server/content.js`
- `packages/vibe64-training/src/server/catalogue.js`
- `packages/vibe64-training/src/server/installedCatalogue.js`
- Main: `packages/vibe64-training/src/server/cli.js`
- `packages/vibe64-training/src/server/installedContent.js`
- `packages/vibe64-training/src/server/contentInstaller.js`
- `packages/vibe64-training/src/server/learnerState.js`
- `packages/vibe64-training/src/server/practiceHistoryReader.js`
- `packages/vibe64-training/src/server/learnerNotesActions.js`
- `src/components/learning/Vibe64LearningTeacherNotes.vue`
- `packages/vibe64-training/src/server/preparation.js`
- `packages/vibe64-core/src/server/projectRecordMetadata.js`
- `packages/vibe64-core/src/server/stateUpgrades.js`
- `packages/vibe64-core/src/server/stateUpgrades/20261006-training-preparation.js`
- `packages/vibe64-core/src/server/stateUpgrades/20261006-training-assessments.js`
- `packages/vibe64-core/src/server/stateUpgrades/20261007-training-attempt-history.js`
- `packages/vibe64-project/src/server/managedProject.js`
- `bin/run.js`
- `docs/training-content.md`
- `docs/training-state-recovery.md`
- `docs/templates/learn-topic/README.md`
- `tooling/release/runtime-package.mjs`
- `docs/colleague-usage/teaching-content.md`
- `docs/colleague-usage/learning-with-colleague.md`
- `docs/colleague-usage/lesson-authoring.md`
- `docs/colleague-usage/learning-course-catalogue.md`
- `tests/server/vibe64TrainingContent.unit.test.js`
- `tests/server/vibe64TrainingInstalledContent.unit.test.js`
- `tests/server/vibe64TrainingContentInstaller.unit.test.js`
- `tests/server/vibe64TrainingCourseInstaller.unit.test.js`
- `tests/client/trainingCourseCatalogue.vitest.js`
- `tests/server/vibe64TrainingLearnerState.unit.test.js`
- `tests/server/vibe64TrainingPracticeHistoryReader.unit.test.js`
- `tests/server/vibe64TrainingStepProgress.unit.test.js`
- `tests/server/vibe64TrainingLearnerNotes.unit.test.js`
- `tests/server/vibe64TrainingPreparation.unit.test.js`
- `tests/server/studioProjectContext.unit.test.js`
- `tests/server/stateUpgrades.unit.test.js`
- `tests/server/vibe64ManagedProject.unit.test.js`

## Public contract

Conversation admission reads the current saved learner/attempt and verifies the
trusted topic-manifest hash, selected lesson-manifest hash and current selected
descriptor bytes through the original installed-content owner. It retains draft
policy and path/alias checks without reading unrelated teaching assets. This
identity read is uncached and does not authorize content use: lesson delivery,
assessment and exercise preparation retain full fresh snapshot validation.
An unrelated damaged teaching file can therefore coexist with readable chat
history, while changed selected identity still refuses admission.

The release ships a copyable whole-topic template and its authoring guide. The
template validates as one draft lesson, without exercise or visual capabilities;
authors replace its placeholders and review learning outcomes before publication.

`vibe64 training validate <topic-directory>` validates versioned topic, lesson and
visual schemas, explicit rubric anchors, declared checks, relative file boundaries,
local prerequisites and continued exercise sequences. The original schema list
helper enforces its declared array limits with the schema library's synchronous
validator; string-only `maxLength` metadata does not enforce array counts. Optional
absent lists retain their existing behavior. Drafts remain labelled as
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
Pinned Git inspection uses the existing Vibe64 execution gateway's daemon source
command with the exact root, Git runtime and bounded capture. Immutable file reads
use its binary output encoding before the original byte/hash comparison; execution
refusals and cleanup failures stop manifest generation without changing source.
Locks contain repository, immutable commit, manifest hash and ordered lesson
identities. Released courses require
released topics without required drafts. This is local authoring, with no Git
push, remote release, installation or course enabling.

Practical descriptors name evidence producers/checks; this facility validates their
references but does not manufacture observations, run checks or evaluate progress.
Optional `appRoutes` (exercise lessons only, ≤16 unique `{method,path}` with
literal or `:id` segments) are validated with the lesson; no current reader
consumes them and they never grade.
A `code` producer also requires a bundled exercise, a `kind:"code"` check and
1–8 unique, safe exercise-relative `files` that are bundled exercise files; only
code evidence may name files or a code check, and `timeoutSeconds` (1–60) is
allowed only on a code check. These bytes are covered by the lesson hash.
Application execution, learner permissions and teaching remain Vibe64 concerns,
with no teaching semantics in JSKIT or Genesis.

## Installed pinned reads

`@local/vibe64-training/server/installed-content` exports
`createInstalledTrainingContent({systemRoot})`. The server chooses an absolute
system root; requests choose validated topic IDs, exact commits and lesson hashes,
never filesystem paths. A trusted topic hash from the course lock or saved attempt
is mandatory for every read and fences even a self-consistent cache replacement.
Snapshots live under
`training/content/<topicId>/<commit>/` with `pin.json`, original CLI `bundle.json`
and its `files/` snapshot. The pin identifies schema, topic, release, canonical
repository, commit and topic hash.

`readTopic` reuses local validation and compares the complete ordered bundle,
identity and file inventory. It rejects symlinks, changed/missing/extra files and
invalid pins. `readLesson` selects only a published lesson at its exact hash and
returns the checked document, rubric sections and visual descriptors.
`readVisual` selects a declared visual ID from that same verified lesson and returns
its parsed descriptor, exact pin and lesson identity, plus SVG/controller and only
declared asset records as `{path,bytes}` Buffers. The original manifest-bound file
read verifies each returned file again; `readLesson` keeps its text return shape.
`readCheck` selects only a declared check ID from the same pinned lesson and returns
its original descriptor, exact pin/lesson identity and manifest-verified `file` and
ordered `assets` records as `{path,bytes}` Buffers. Paths are snapshot-relative;
assets are relative to the lesson descriptor, not the check executable. An omitted
asset list returns an empty array. The original per-file/hash/alias bounds apply.
This internal read does not execute a check, admit learner evidence or expose a
resource through a browser route or assistant tool.
`readExercise` selects that lesson's declared bundled exercise and returns its
exact pin/lesson identity, original exercise metadata, snapshot-relative
`sourcePath`, and sorted manifest files below that source. File records contain
exercise-relative `path` and verified Buffer `bytes`. It reuses the same file read,
without scanning for new inputs. Manifest records contain no file modes, so this
read promises no mode preservation. A missing exercise retains its original error
message with the typed `VIBE64_TRAINING_EXERCISE_MISSING` refusal.
The frozen `readExerciseProjectScope` of `practiceHistoryReader.js` (for the
published 20261008 practice-history upgrade: one attempt's own project, version 1
marker) uses this existing read once, including
its topic/lesson validation, and checks the returned exact pin/code/hash. Each
new scope still reads saved learner state and validates installed content; no
result or authorization is cached. An inactive write/create or unavailable
exercise reader retains the original separate lesson validation and
missing-exercise/inactive/unavailable refusal order. A typed missing-exercise
refusal rechecks the original full topic pin before normalization, so release or
repository corruption cannot become an ordinary missing-practice message. It does not copy, provision, fetch, execute or
grant project access; ordinary project and Preview permissions remain applicable.
No caller supplies a resource path. Descriptor limits and the 1 MiB per-file limit
remain the original content validator's contract. This is an internal resource
read, without browser delivery, code execution, SVG sanitization, a renderer,
authentication or durable visual state. Reads never write, repair, fetch, run
checks, enable a course or declare an assessment passed.
An absent or invalid snapshot reports reinstall guidance. Catalogue enablement is
not part of a pinned read, so a future existing attempt can continue after its
release is disabled; new-start permission remains the application action's job.

## Author-preview owner construction

The installed reader's trusted server option `allowDraftLessons:true` permits
draft reads only in an author-preview composition. Default readers still refuse
drafts, and per-read input cannot change admission. The original exact pin,
manifest/hash, declared-resource and alias checks are shared unchanged.

The same learner-state constructor accepts the configured `content` reader;
without it, the existing `contentSystemRoot`/`systemRoot` construction remains.
The composing server chooses a separate preview state root with the actual
authenticated actor. The original schema, atomic writer, CAS, locks and immutable
receipts own that isolated trial state; no new journal or historical rewrite
exists. These constructor prerequisites do not select a preview snapshot or admit
an author; the owner-only `author-preview.read`/`author-preview.start` actions do.

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

## Installed course catalogue

`@local/vibe64-training/server/installed-catalogue` provides internal read, enable
and disable operations. An admitted owner supplies the original course definition
and exact approved lock; this store authenticates no objects and exposes no
browser, assistant or terminal action. Each fresh read checks installed topic
identities and regenerates the lock through the original `createCourseLock`
operation, then compares the complete ordered result. Disabled snapshots remain
verified too; missing or corrupt content fails admission closed, without repair.

`training/catalogue.json` contains schema version, revision and up to 16 retained
course-release entries in 1 MiB. Each stores immutable definition/lock and mutable
enablement. New releases do not replace earlier identities. An absent read creates
nothing; malformed, unsupported or aliased paths/records fail closed. Explicit
toggles use the existing persistent Kernel OS lock and Core atomic writer, with
private modes and expected revision. Stale writes conflict; matching current
state is unchanged. A failed write is unconfirmed because rename may have succeeded;
the caller must read before deliberately retrying. Locks are never unlinked.

An authenticated start admits a new lesson at a fresh enabled read. Later
disablement prevents future admissions, without revoking already admitted work or
saved attempts. The catalogue does not coordinate cross-lock reservation writes;
the existing resume owner reads its saved pin independently. No lazy seed, new
validation framework, remote discovery, exercise execution or progress mutation
is added. Existing whole-topic validation and installed-byte proof remain the
original evidence; focused catalogue cases extend the real reservation fixture.

## Official catalogue installation

`courseInstaller.js` is the in-app installer. The catalogue repository is server
configuration (`VIBE64_LEARNING_CATALOG_REPOSITORY`, default
`mobily-enterprises/vibe64-learning-catalog`), never request input. Reading
shallow-fetches it into `<systemRoot>/training-sources/catalogue-<uuid>`,
validates `domains.json`, `topics.json` (optional per-topic `domainId`) and each
`courses/<id>/course.json`/`course.lock.json` strictly, and caches for 60 seconds.
Installing rereads it, fetches each missing locked topic at its exact commit into
a `topic-<uuid>` scratch directory, and delegates to the original
`installTopic` (clean-commit, canonical-source and byte proof, staging, per-pin
lock) and `enableCourse` (catalogue lock, expected revision; one retry on
conflict). Older releases of the course are then disabled for new starts through
`disableCourse`; saved attempts resume from their pins and nothing is deleted.
The 16-release limit fails closed before downloading. Installs are serialized in
process and identical requests share one operation. Scratch directories are
removed in `finally`; the managed exec helper admits Git only in exactly that
one-level scratch shape. `available.list` and `course.install` are ordinary
signed-in Training actions; only the owner may re-enable a disabled release.

## Private reservation authority

The internal learner-state API receives actor and course provenance from the
admitted composing caller; it does not authenticate objects or expose browser
paths. It verifies the exact installed published topic/lesson pin and uses the
existing identity key convention without a local fallback. Private state outside
projects owns one active attempt, revision, stable request receipts and server
UUID. An attempt for a lesson that declares an exercise also owns its practice
project slug `training-<attemptId hex>` and preparation, initially `reserved`;
any other attempt names no practice project, and beginning preparation for it
refuses (`VIBE64_TRAINING_EXERCISE_MISSING`). Validation against the installed
lesson enforces both ways.
Project/session effects and assessment evidence remain separate future operation
responsibilities.

`progress.json` is authoritative and is saved before its derived
`active-lesson.json`. Duplicate request IDs are resolved before stale revision
checks and cannot change their full pin. New IDs reuse the same active pin rather
than creating another exercise. One lesson is in progress at a time: another pin
is refused (409 `VIBE64_TRAINING_LESSON_IN_PROGRESS`, details
`{attemptId,lessonCode,lessonTitle}`) before the revision check, and the
lifecycle owner archives the current attempt first. The
existing Kernel persistent file lock serializes cooperating user-state writers.
Read-only projection never creates or repairs records. Explicit reserve/resume
reconciles only missing or semantically identical stale valid summaries; corrupt
state fails closed. Saved-summary and unconfirmed-progress errors distinguish
durable reservation from uncertainty and require the same retry identity.

`runPreparationExclusive({actor,attemptId},operation)` holds the same Kernel lock
facility on a distinct persistent per-user `preparation.lock`, after validating
the saved attempt and installed pin. It rechecks them under that lock and awaits
the admitted server operation with release in `finally`; competing preparations
receive a retryable 409. The pilot has one active attempt per user, so other
learners remain independent. It never holds the short `state.lock` across effects;
typed state operations stay usable inside it. Reads validate an optional existing
preparation lock without creating it. This adds no automatic phase transition,
readiness claim, state patch or product activation. Stopped-writer maintenance
checks both persistent lock inodes.

Typed `beginPreparation`, `recordPreparationReady` and
`recordPreparationFailure` extend this same authority. Untouched `reserved`
records remain valid with no session ID. Explicit begin saves `preparing` and an
immutable server-derived initial session ID before external effects, using the
original Runtime ID validator. The composing owner recovers that exact project
and session through normal lifecycle/admission; ordinary project/Preview access
is unchanged. There is no provisioner, browser action or parallel journal.

The original managed-project owner also provides read-only
`verifyManagedProjectSource`. Before a first session truly exists, the admitted
caller holds the existing project source lock and supplies freshly verified
exercise bytes and current project identity. The proof derives canonical storage,
compares the full immutable commit's file and implied directory inventory, and
requires exact bytes in ordinary nonexecutable files. Extra empty trees, aliases,
unsafe modes and changed source fail without repair. It returns the branch and
commit for the original session branch guard; it neither freezes later authority
nor proves app readiness. Existing sessions use their original lifecycle recovery
without repeating seed checks or overwriting learner edits. The shared preparation
coordinator uses this proof through its supplied original project/repository owner
before first session creation; the module does not provide a standalone host.

The original Core project metadata normalizer accepts optional schema-2 `training`
provenance at trusted record creation: `learnerKey`, `practiceId`, the exact
`pin:{course,topic,lesson}` retained by learner state, and
`exercise:{kind:"bundled",sourcePath}` from the installed exercise reader. Core
validates and copies this structure without importing Training. Creation and
preparation receive independent marker copies; existing metadata updates cannot
attach, alter or remove it. Ordinary records omit it and public project projections
are unchanged. The marker records association, not authorization or readiness.
Browser input cannot supply this marker. The shared preparation coordinator
provides it through the original trusted project-creation facility. The
ordered `20261006-training-preparation` no-op ledger boundary records support for
these new writes. It must be applied with writers stopped before future activation;
registration alone starts no training operation.

Readiness is recorded only after the admitted caller observes actual readiness
through the existing owners. `ready` includes its observed time; it is historical
preparation evidence, not proof of present Preview liveness or a pass. Observation
timestamps do not order recovery: revisions, immutable identities and allowed
phase transitions do, even after a wall-clock correction. A bounded
project/session/setup failure retains identity, returns to pending preparation
and removes the ready observation. Begin replays preserve failure; stale different
observations conflict. Same observations are idempotent before revision checks.

Progress-first phase changes can leave an older valid summary. Reads project only
reachable predecessors with unchanged identities; locked explicit operations
reconcile them. A reserved summary needs two later revisions to reach ready or
pending failure; begin alone needs one. Changed ready observations need two
revisions through failure, while an unchanged ready alias needs one. Observation
times do not impose ordering. Future/incompatible phases and session conflicts
fail closed.
Original publication/lock/fault evidence is extended, not replaced. No teaching,
assessment or visual state is added. Before activating new writes, apply the
coordinated `20261006-training-preparation` ledger boundary through the existing
candidate upgrade command. The no-op script changes no application files and
needs no data backup; old registries refuse the newer ledger. It adds neither
activation nor historical conversion, and never backfills reserved records during
reads.

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
and refuses invalid records/pins and saved assessment/resume semantics before
publication. Its server-owned `contentSystemRoot` constructor option points the
original installed reader at live content while reading a staged users tree; it
adds no separate validator or state repair. Tests execute its actual
snippets. Live host stopping and off-host retention are not established by those
filesystem fixtures.

## Shared lesson preparation coordinator

The server-only `./server/preparation` export provides `createTrainingService`
with the original catalogue, content, learner, project-context, project/repository,
session and terminal owners supplied by its composition. It owns lesson
start/resume/end and retained-pin continuation policy, not a new provisioner,
session runtime, Git writer, execution gateway or state journal.

A new start checks the current enabled exact course and published lesson and
reserves its immutable pin before effects. Preparation takes the original
learner preparation lock and reads the installed descriptor. A no-exercise
lesson keeps its attempt without project/session/setup effects. For an
exercise, the original
managed initializer copies only verified ordinary bundled files and retains its
commit/rollback behavior. Existing project provenance, repository mode and exact
reserved session identity must agree. Unmarked directories and missing prepared
projects/sessions are not silently adopted or replaced. Initial source is
verified before first session creation; later learner work is never reset to
exercise seed bytes. Workspace setup uses its original lifecycle, and a saved
success is checked against its current recipe. Pending/failed setup is not ready.
Preparation does not claim Preview liveness, delivery or an assessment pass.

End excludes in-progress preparation. Retrying an already ended operation cannot
take the independent successor's preparation lock. Explicit continuation derives
its pin from that person's retained ended history, even after release disablement,
and passes the original caller revision to the state writer. It refuses another
active attempt and cannot adopt a racing same-pin successor. Bounded stable
request identities, original errors, retry identities and all existing state
schemas are retained unchanged. No source read or automatic course enablement
is introduced.

The original coordinator and its original twenty-one controlled-owner unit cases
move together without changing bodies or assertions. Hosts retain their resource
bindings, concrete repository composition and actual lifecycle integration
proofs. The shared module and unit fixtures alone do not prove standalone
provisioning, hosted native execution or browser acceptance.

## Retired format-1 learning records

Lesson format 1 (assessments and a teaching document) is retired. Its write
paths are deleted; the content CLI's `validate` and `publish-manifest` refuse a
v1 lesson, while `bundle` and the installed reader still verify one so
installed history stays readable. Reservation refuses an installed v1 pin
(`VIBE64_TRAINING_LESSON_VERSION`). Version 1 progress (vibe64 0.1.35 to Rev 3,
with `practiceId`, `learning` fields and `left`/`discard`/`restart` ends) is read
only by `practiceHistoryReader.js`, moved unchanged from the earlier learner
state for the published `20261008-learning-practice-history` upgrade, which
runs before the 20261022 reset. Its tests write that format by hand.

## Step results, code ledgers and Learn mode

`step-progress.json` (schema version 3) keeps the step results of the attempt in
progress, `{learnerId,revision,attemptId,lesson,results,receipts}`, at most 64.
A new attempt starts fresh; a record naming another attempt is replaced on the
next write. Completion of a lesson means every required step has passed in that
attempt (`readState` `completion`), and `finished` adds `{code,hash,completedAt}`
to `progress.completedLessons` (at most 256), which pruning never touches;
`lessonCompletions` reports those lessons as completed and the open lesson with
its real counts. Code authorship ledgers belong to the attempt:
`code-ledgers/<attemptId>.json` under one shared `code-ledger.lock`. Saves are
ledgered only while that attempt is in progress in its practice project
(`saveLearnerFile({actor,attemptId,input,save})`); otherwise they are the
editor's plain save. Ending an attempt removes its step results and ledger.

Learn mode is the separate `learning-mode.json` `{schemaVersion:1,learnerId,on}`
(absent means off), written by `setLearningMode({actor,on})`, which never ends
or changes the lesson. `readLearningMode` returns
`{on,currentAttemptId,lessonCode,lessonTitle,practiceSlug}` with the attempt in
progress as the current one. `activeAttemptForProject({actor,attemptId})`
resolves a practice project's attempt while it is in progress.

## Learner teacher notes

The learner store also keeps one private `teacher-notes.json` per learner, with
its own short lock: Colleague's Markdown summary (at most 4000 characters) of that
person's strengths, difficulties, preferences and place in Learning, with a
revision, `updatedAt`, `updatedBy` (colleague or learner) and the latest 32
request IDs for replay. The authenticated actor alone selects the file; no input
names a learner, so neither another member nor the workspace owner can read it.
`learner-notes.read` and `learner-notes.update` (replace the whole text against a
required `expectedRevision`) are available to Colleague and the learner's browser;
a retry older than the replay window is refused as changed, never restoring older
text. Colleague treats the notes as data about the person, never as instructions;
`learner-notes.clear` is the learner's browser action only. Each change publishes
`vibe64.training.learner.changed` with reason `notes` and no attempt. Notes are
never read by admission, step results or completion. A host with an
author-preview store keeps them in the normal learner store during an owner's
trial. L shows them
on Courses as "What my teacher knows about me" with Edit and Clear. The file is
additive and needs no numbered upgrade (`docs/state-upgrades.md`).

## Explicit attempt retirement and history

The internal `endAttempt({actor,attemptId,requestId,expectedRevision,reason})`
accepts `reason: "finished" | "archived" | "deleted"`; `finished` is refused
(`VIBE64_TRAINING_LESSON_INCOMPLETE`) unless the attempt is complete. It returns
`{revision,attempt,active,replayed}` and adds immutable
`ended:{requestId,revision,reason}` to that exact retained attempt. This records a
learning retirement decision, not a Stop, archive, deletion or disposal receipt.
The admitted host holds the original per-user `runPreparationExclusive` exclusion
around any normal project/session lifecycle effects and the final typed end.
The store takes only the short `state.lock`, so that call does not nest preparation
locks. A retry after a saved end uses the same typed end directly; active-only
preparation must not be reacquired for an already ended attempt.

Reservation and end replays resolve their original IDs before revision checks.
They return the retained attempt and actual current active summary, never reactivate
an ended attempt or end its successor. Preparation and resume remain
active-only. A host must not provision an ended reservation replay. A new start
is separately admitted against the enabled course, uses a new request ID and
allocates a new UUID and practice project slug.
Every existing write updates only the matching attempt rather than replacing history.

At most 32 attempts are retained, in reservation order. Ended revisions and
request identities are validated, and only the final unended attempt can be
active. A new reservation drops the oldest ended attempts (and the reader
position of a dropped attempt) until the record fits 32 attempts and 128 KiB;
it is never refused for space. Completion lives in `completedLessons`, so
pruning loses none. This read projection never rewrites pins or copies results
into a new attempt; existing exact installed-pin validation remains
authoritative.

With no active attempt, `active-lesson.json` stores the strict versioned object
`{schemaVersion:1,learnerId,progressRevision,attemptId:null}`. The API still returns
`active:null`. A valid stale summary remains tied to its retained original
attempt and the reachable revision before its end; an empty stale summary must
name an actual retained end revision. Reads never reconcile summaries; only an
explicit locked operation does. Saved-end versus unconfirmed-progress errors
remain distinct, and neither asserts project disposal.

The live store reads only schema-2 progress; the 20261022 reset writes it.
The published `20261007-training-attempt-history` no-op boundary changes only
the original compatibility ledger.

## Local operator CLI provisioning

The original managed session helper also prepares an ordinary `vibe64` shim for
`training validate`, `training bundle` and `training publish-manifest`;
`vibe64-helper training` delegates to that same shim. Existing
`agentCommandEnvironment` supplies its server environment to `agentHelperCommand`,
which captures the canonical app's `bin/run.js` and the server's Node executable.
The child retains the original managed shell identity, cwd, HOME, PATH and Env.
The shim grants no new filesystem, source, Git or publication authority and
rejects every operator command before invoking the existing CLI. It adds no
daemon route, installer, authoring implementation or persisted data. Inputs and
outputs remain subject to the coding assignment and ordinary filesystem/Git
authority. Original Training content assertions cover validation, exclusive
bundle output and clean exact-commit lock generation; the existing command
environment file covers exact argument/identity delegation and operator refusal.

The original `runTrainingCli` dispatch also supports `install-topic
<committed-topic-directory> <system-root>`, `installed-courses <system-root>`,
`enable-course <course.json> <course.lock.json> <system-root> <expected-revision>`
and `disable-course <courseId> <release> <system-root> <expected-revision>`.
The local process's existing filesystem authority selects these paths; no browser,
assistant tool, permission policy or runtime is added. CLI resolves local relative
paths and retains the original installed owners' alias/root checks. Argument
arity and canonical safe nonnegative decimal revisions are checked before effects.

Installation derives its pin through original `readPinnedTopic` and delegates to
original `installTopic`, which independently verifies source/commit/identity and
publishes only its verified snapshot. CLI returns the exact pin and whether it
installed or reused it; it does not enable, execute or publish. Catalogue commands
use original fresh `readCatalogue`, `enableCourse` and `disableCourse`, retaining
whole-topic validation, release immutability, locking, CAS and truthful uncertain
save errors. Reads never seed or repair. Course lock generation, installation and
enablement remain separate operations. State formats are unchanged; existing
attempts retain pins when new admission is disabled. Original content test cases
exercise the actual installer/catalogue through this dispatch, preserving all
prior authoring assertions.

## Lesson authoring guidance

Release-matched `lesson-authoring` usage explains a concrete existing-owner path:
Colleague retains the person's exact request and source project/session in its
original bounded assignment, delegates normal coding work, and obtains a reviewer
in that same session. Authoring validation/bundling/pinning stays with the existing
coding/CLI owners. Requested source publication uses native Save or PR actions with
fresh unchanged destination/remote review and normal account/branch rules. No new
source editor, shell tool, publisher, assistant installation action or learner
lesson is added. Preview source publication does not establish pedagogical trial,
installation, enablement or learner acceptance.

The previously oversized `teaching-content` guide is divided by task into bounded
`teaching-content` (pinned content/progress recovery), `learning-with-colleague`
(host lesson/question/diagram/assessment/practical steps) and `lesson-authoring`
(authoring, review, Git publication and separate operator provisioning). Existing
facts retain their owning scope; historical facility-only availability prose is
made conditional on the actual host registrations. Original usage limits are
unchanged, and the original shipped-topic test verifies every complete guide read.


## Read-only lesson picker prerequisite

`@local/vibe64-training/client/lesson-picker` exports the presentational
`TrainingLessonPicker`, shown as the Learning **Courses** pane. The parent supplies the original bounded `courses.list`
and `learning.read` projections, separate read/loading errors, pending action
state and explicit supported start/resume capabilities. The picker preserves
supplied course/topic lesson order. It displays disabled/preview/draft choices
truthfully and emits no automatic selection, installation, enablement, start,
progress or repair operation.

Its home lists course cards with read-only progress; `TrainingCoursePage` shows
one course's topics and lesson statuses. `courseProgress.js` joins each displayed
lesson's exact code/hash with `learning.read`'s `lessonProgress` (the learner
store's per-lesson summary of the same verified passes): Completed, In progress
(open attempt or some passes) or Not started. Course progress counts completed
required lessons. Card **Start**, **Start next lesson** and per-lesson **Start
lesson** select one exact displayed lesson and use the same start emit below
(an archived lesson starts again as a new attempt; a different lesson in
progress makes the server refuse once and the controller ask to archive it);
on an enabled preview course they read **Try preview** and appear only when
`courses.list` reports `canTryPreviews` (members see the preview note instead);
**Continue** is the original saved-attempt resume. `TrainingCourseCreator` lets
the owner name a custom course and order whole topics from enabled released
courses; the parent supplies `createCourse`, which calls the owner-only
`courses.create` action. The installed catalogue owner resolves those existing
topic pins and reuses `createCourseLock`/`enableCourse`, so a custom course is an
ordinary immutable catalogue release with no new storage.

A selected exact course/release/lesson/hash/topic identity remains local display
state. Changed or removed choices clear it rather than retargeting a request.
Explicit Start emits only `{courseId, release, lessonCode, expectedRevision}` for
the original start owner; the parent retains request identity and actual admission.
It adds no catalogue revision guard, pin receipt or second start contract. The
existing server action resolves and authorizes the immutable installed pin.
The original catalogue read can opt into transient `lessonTitles` metadata,
collected during its same verified pinned-topic read. Each title comes from the
original bounded validated lesson descriptor and is joined by exact topic release,
lesson code and hash. Canonical `courses.list` projects that one bounded title
beside its original fields. Default reads, saved course locks, writer behavior and
formats stay unchanged; there is no second catalogue/read or historical repair.
The picker shows that readable title beside its exact code. Missing titles show
a refresh error while keeping saved learning/history; no invented fallback or
retargeted choice is used. New choices still disclose no source commit/path.

Resume emits only the supplied saved attempt ID, independently of current course
enablement. A saved attempt alone cannot enable resume; the parent must supply
actual host support. Read-only ended history remains visible without write
capabilities. Completion displays only the matching supplied counts/Boolean,
never a browser-derived pass, and malformed display shapes report an error
without repair. The original learner/content/permission/progress validators and
writers remain unchanged. Loading retains already displayed choices and disables
new intent; initial loads use Material skeletons.

This component does not attach an API route, conversation, Preview tab or
player; the Learning environment (L) hosts it as its Courses surface. The host's original retained Preview/session owners must
supply authenticated captured data and effects; native/browser/device acceptance
remains separate. Existing App/SVG presentation and motion owners are untouched.

Pinned source proof reads committed blobs through the original managed command owner in bounded NUL-framed `git cat-file --batch -Z` captures. Each original proof still checks root, HEAD, cleanliness, package identity, every manifest byte length/SHA256, and final HEAD/cleanliness. Binary/newline paths remain valid; malformed, truncated or trailing batch data fail closed. Installer proof boundaries before/inside its lock and after bundling remain unchanged.

Practice scope admission asks the original installed exercise reader for metadata
only. It still freshly validates the full pinned topic, lesson identity and saved
attempt, but does not hydrate exercise files or teaching document/visual payloads
that admission discards. Preparation retains the default complete exercise bytes.
