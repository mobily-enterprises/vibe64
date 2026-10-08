# Teaching content

Vibe64 validates local topic repositories and produces reproducible lesson bundles.
This authoring facility does not execute exercises or teach a learner. Server-only
facilities install exact verified snapshots from admitted owner-selected local
sources and check pinned reads. Private server-only state retains one exact lesson
active reservation per learner, with bounded immutable ended-attempt history. An internal installed catalogue validates approved whole
course locks and toggles enablement without changing their pinned release identity.
Internal assessment and resume writes retain pinned evidence and derive lesson
completion. The shared preparation coordinator composes these original state/content
owners with existing project, repository, session and Workspace setup facilities.
A standalone learning host and the Main Learning-mode teacher remain unfinished;
the module alone does not provide infrastructure or prove a delivered lesson.

## Sources

- `packages/vibe64-training/src/client/TrainingLessonPicker.vue`

- `packages/vibe64-training/src/server/contentSchemas.js`
- `packages/vibe64-training/src/server/content.js`
- `packages/vibe64-training/src/server/catalogue.js`
- `packages/vibe64-training/src/server/installedCatalogue.js`
- `packages/vibe64-training/src/server/cli.js`
- `packages/vibe64-training/src/server/installedContent.js`
- `packages/vibe64-training/src/server/contentInstaller.js`
- `packages/vibe64-training/src/server/learnerState.js`
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
- `tests/server/vibe64TrainingContent.unit.test.js`
- `tests/server/vibe64TrainingInstalledContent.unit.test.js`
- `tests/server/vibe64TrainingContentInstaller.unit.test.js`
- `tests/server/vibe64TrainingLearnerState.unit.test.js`
- `tests/server/vibe64TrainingPreparation.unit.test.js`
- `tests/server/studioProjectContext.unit.test.js`
- `tests/server/stateUpgrades.unit.test.js`
- `tests/server/vibe64ManagedProject.unit.test.js`

## Public contract

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
read promises no mode preservation. It does not copy, provision, fetch, execute or
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
exists. These constructor prerequisites do not select a preview snapshot, admit
an author or route live teaching and presentation operations.

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

A future authenticated action admits a new start at a fresh enabled read. Later
disablement prevents future admissions, without revoking already admitted work or
saved attempts. The catalogue does not coordinate cross-lock reservation writes;
the existing resume owner reads its saved pin independently. No lazy seed, new
validation framework, remote discovery, exercise execution or progress mutation
is added. Existing whole-topic validation and installed-byte proof remain the
original evidence; focused catalogue cases extend the real reservation fixture.

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

The original Core project metadata normalizer accepts optional schema-1 `training`
provenance at trusted record creation: `learnerKey`, `attemptId`, the exact
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
lesson remains reserved without project/session/setup effects; an incompatible
exercise checkpoint refuses without repair. For an exercise, the original
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
provisioning, hosted native execution or Main teacher/browser acceptance.

## Durable assessment and lesson resume

The existing learner-state owner exposes internal `saveLessonResume` and
`recordAssessment` operations for the saved active attempt. Both require the
admitted actor, exact attempt and revision; the original persistent state lock
serializes compare-and-swap writes. `learning` is an optional schema-version-1
field. Older records remain valid and absent state is not converted on reads.
Resume and new writes verify the exact installed lesson, while `readState` still
validates private records without installed content for backup inspection.
Staged restore instead uses the content-aware read against the live exact pin.
The explicit read-only `readState({actor,includeCompletion:true})` verifies the
saved pins of every retained attempt and reuses the required-pass calculation
for teaching briefs; it returns `completion:null` without an active attempt and
never repairs a summary. Historical pins and descriptor semantics remain checked
when no lesson is active, including staged offline recovery.
Content-aware reads/resume and writes validate saved receipt IDs, kinds, rubrics
and practical producer/operation/check contracts against that descriptor, before
summary reconciliation. Historical receipts do not depend on today's pending
question or preparation phase.

A resume checkpoint retains teaching stage, pending question identity/text,
bounded declared visual semantic snapshots and a summary. Repeating its current
request ID with identical content is idempotent; a conflicting payload is refused.
An assessment submission retains actual admitted learner answer text/message and
saved question identity, or the learner/attempt/project/session/native producer,
operation/check and immutable observation identity. The admitted application
owner authenticates those facts, executes checks and evaluates the pinned rubric;
the store does none of those jobs and exposes no model assertion of trusted evidence.
Demonstration evidence cannot record a learner pass. Each evidence reference is
consumed once; identical submission replay returns the existing result before CAS.

Results retain outcome, rubric/hash, reason, assistance and server recording time.
Resume and write responses derive completion from passes for every required
assessment in the pinned descriptor; there is no writable completion flag.
There is at most one active attempt; original preparation identity and ordinary
permissions remain unchanged. Each attempt retains up to 64 receipts, and the
whole serialized record remains limited to 64 KiB; excess writes fail without
evicting evidence. Historical receipts retain their own attempt/project/session
identities and are never transferred to a new exercise. Unconfirmed atomic
saves require read/same-identity retry. Only explicit operations reconcile reachable
stale derived summaries. The appended prospective assessment upgrade changes the
ordered compatibility ledger, without transforming historical application records.


## Explicit attempt retirement and history

The internal `endAttempt({actor,attemptId,requestId,expectedRevision,reason})`
accepts `reason: "restart" | "discard"`. It returns
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
an ended attempt or end its successor. Preparation, learning writes and resume
remain active-only. A host must not provision an ended reservation replay. A new
start is separately admitted against the enabled course, uses a new request ID,
and allocates a new UUID/project slug and subsequent initial session identity.
Every existing write updates only the matching attempt rather than replacing history.

At most eight attempts are retained, in reservation order. Ended revisions and
request identities are validated, and only the final unended attempt can be
active. Capacity refusal preserves every receipt and retry identity; the pilot
has no automatic pruning or multicourse scheduler. Completion unions passed
assessment IDs for the identical lesson code/hash across validated topic and
course pins for that learner. Topic-only changes do not invalidate an unchanged
lesson. Different lesson content keeps historical evidence but contributes no pass
to the current lesson. This read projection never rewrites pins or copies receipts
into a new attempt; existing exact installed-pin validation remains authoritative.
The original teaching brief and shared action projections identify historical
passes by their original attempt/submission IDs and native provenance, separately
from current submissions. `learning.read` includes ended history; `lesson.end`
uses the supplied original host retirement owner and does not dispose of the
exercise. The teacher must distinguish historical provenance from new practical
observations.

With no active attempt, `active-lesson.json` stores the strict versioned object
`{schemaVersion:1,learnerId,progressRevision,attemptId:null}`. The API still returns
`active:null`. A valid stale summary remains tied to its retained original
attempt and the reachable revision before its end; an empty stale summary must
name an actual retained end revision. Reads never reconcile summaries; only an
explicit locked operation does. Saved-end versus unconfirmed-progress errors
remain distinct, and neither asserts project disposal.

Existing single-reservation schema-1 records remain valid unchanged. Before
activation, apply the appended `20261007-training-attempt-history` no-op boundary
with all writers stopped. It changes only the original compatibility ledger,
requires no historical repair or application-data backup, and starts no lifecycle
action. Normal reads/startup add no absent end fields or history.

## Local operator CLI provisioning

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
`TrainingLessonPicker`. The parent supplies the original bounded `courses.list`
and `learning.read` projections, separate read/loading errors, pending action
state and explicit supported start/resume capabilities. The picker preserves
supplied course/topic lesson order. It displays disabled/preview/draft choices
truthfully and emits no automatic selection, installation, enablement, start,
progress or repair operation.

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

This component does not attach a Learning mode, API route, Main conversation,
Preview tab or player. The host's original retained Preview/session owners must
supply authenticated captured data and effects; native/browser/device acceptance
remains separate. Existing App/SVG presentation and motion owners are untouched.
