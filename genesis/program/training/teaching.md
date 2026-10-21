# Lesson operations and declared checks

Training's shared lesson operations start, resume and close saved lessons,
read and record step results, and run each lesson's declared checks. Colleague
teaches every lesson from its steps, in Learn mode, in that lesson attempt's own
teacher conversation.

## Sources

- Main: `packages/vibe64-training/src/server/actions.js`
- `packages/vibe64-training/src/server/stepActions.js`
- `packages/vibe64-training/src/server/stepChecks.js`
- `packages/vibe64-training/src/server/preparation.js`
- `packages/vibe64-training/src/server/Vibe64TrainingProvider.js`
- `packages/vibe64-training/src/server/registerRoutes.js`
- `packages/vibe64-training/src/server/declaredCheck.js`
- `packages/vibe64-training/src/server/codeAuthorship.js`
- `packages/vibe64-training/src/server/codeEditorActions.js`
- `packages/vibe64-training/src/server/visualResourceActions.js`
- `packages/vibe64-training/src/server/visualResourceRoutes.js`
- `packages/vibe64-training/src/server/learnerState.js`
- `packages/vibe64-training/src/server/installedContent.js`
- `packages/vibe64-training/src/server/practiceHistoryUpgrade.js`
- `packages/vibe64-training/src/server/learningSpaceResetUpgrade.js`
- `packages/vibe64-training/src/shared/practicalSchemas.js`
- `packages/vibe64-training/src/shared/presentationSchemas.js`

## Public contract

### Shared lesson operations

`actions.js` provides the shared-catalogue operations courses list and create,
available list, course install, learning read, lesson start, lesson resume,
lesson end and retained-pin lesson continuation. They use Core's fresh actor
context and expose bounded saved facts without source paths, executable
controllers or shell authority. A host supplies the existing exercise
preparation/retirement owner; without its relevant method,
start/resume/end/continue reports unavailable. `learning.read` returns progress,
completion, per-lesson summaries and bounded ended history; the learner identity
reaches only the browser, never Colleague's tool result. Readers do not reserve or repair
state. An ended start replay returns its original target and actual current
active attempt without provisioning it.

`lesson.end` accepts exact attempt/request/revision and a left/finished/discard
reason (L's Lesson finished screen sends `finished`),
returns the ended target plus actual active state and native replay flag, and
retains the exercise and all history. It stops no agent work: the practice
project and its ordinary sessions stay usable. It does not close, archive or
delete; those are separate existing authorised operations. Neither old replay
can retire or reactivate a successor. `lesson.continue` accepts an ended attempt
ID, a stable request of at most 18 characters and the current expected learning
revision. The host derives the exact pin from that actor's verified history; the
model cannot supply a pin or source. It uses the original reservation and
preparation owners. An independent active attempt is refused. Missing
host/content or capacity refusal retains history.

`stepActions.js` adds the step operations `lesson.read`, `step.observe`,
`step.check.run`, `step.answer`, `step.done`, `reader.save` and
`practice.delete`. A step result is recorded only for the learner's own action:
a choice answer compared by the server, **Done** on a self-check step, or an
automatic check started by the learner's App press or code-step **Check now**. A check
Colleague runs through `step.check.run` reports its finding and saves nothing.
The inner session-inspect and App-run reads of `step.observe` and
`step.check.run` re-admit the learner's own request on the practice project's
ordinary project target; practice sessions carry no learning-scoped input.

### Teacher conversations

Each lesson attempt has its own Colleague teacher thread, keyed by `attemptId`
(`<sys>/colleague/<learnerKey>/learn/<attemptId>.json`), and Learn mode without
a lesson uses one learner-level lobby thread (`learn/lobby.json`). Colleague
picks the thread on the server from the learner's mode (core
`readLearningModeFor`: Develop, or Learn with `currentAttemptId`), so leaving
and coming back to an attempt resumes its conversation. Only Learn threads
carry the teaching guidance and Training's lesson tools; Develop can read and
set the mode only. Closing an attempt calls core `releaseLearnThread` (Colleague
stops the thread) and then moves the file into the attempt's archive bundle or
removes it; Training never imports Colleague. See
`genesis/program/colleague/product-conversation.md`.

Sources: `packages/vibe64-core/src/server/learnThreads.js`,
`packages/vibe64-core/src/server/learningMode.js`,
`packages/vibe64-colleague/src/server/service.js`,
`packages/vibe64-colleague/src/server/protocol.js`.

### Version 1 lessons

Version 1 (assessment) lesson records keep their saved questions, assessment
results and visual snapshots; `assessmentLesson(lesson)` gates every version 1
reader, and completion of a version 1 lesson still counts its saved passes. No
current operation teaches, grades or presents them. `practicalSchemas.js` keeps
only the step observation schema; `presentationSchemas.js` keeps only the guide
receipt and client identity used by Colleague navigation.

### Internal declared application check

`createTrainingDeclaredCheckOwner` consumes the original learners, installed
content, project context and terminal output facilities. Its internal
`runOrientationCheck` accepts admitted actor/attempt/session/run/observation and
server interaction identities, never caller paths, origin, command or outcome.
The exact ready active attempt selects the installed lesson and declared
`orientation-response` check. The original active App terminal supplies its
private allocated loopback origin; public Preview URLs are not execution origins.
Fresh attempt/session/run reads before and after capture reject changed scopes.

Verified declared check and auxiliary files are copied into unique private session
artifacts outside editable source, preserving manifest-relative references. The
original `runVibe64Command` owner runs fixed Node26 as the ordinary workspace daemon
with an explicit allowed root, finite job admission, 4,096-byte output limit and
five-second timeout. The managed helper retains the original actor, group, umask,
resource accounting and scope drain. No new runner, namespace, privilege or shell
tool is introduced. Only a proven empty execution scope permits scratch deletion;
uncertain cleanup retains files and fails for the original cleanup owner.

Strict native check output confirms only the exact server observation. A missing
or restarted server interaction is incomplete, not a learner pass; `stepChecks.js`
records a step result only for the learner's own App press. This internal owner has no API/tool registration or persisted state
upgrade. Its focused fixture preserves the original topic
check and uses real standalone finite execution against a loopback HTTP transport
fixture; it does not claim hosted or learner gesture acceptance.

### Code checks

The practice project's ordinary Files editor saves through
`vibe64.source-editor.file.save`; Training's save owner
(`createTrainingCodeSaveOwner`, installed with `setFileSaveOwner`) routes a save
in the actor's own practice project with an active attempt to the generic
source-editor save under the ledger lock and records it in that practice
project's private `code-ledgers/<practiceId>.json`, shared by every attempt that
continues the project. A save whose read-back bytes differ from the learner's
text is recorded as foreign. A host with several stores (for example normal and
author-preview) passes `selectOwners({actor, practiceId})`, which returns the
store whose in-progress attempt works in that practice project, or null for a
plain save.

Opening a code step records its start (`recordStepBaseline`). `runCodeCheck`
reads the declared files from the live source and verifies the chain start →
saves → current bytes. A broken chain returns `not-yet-passed` with "needs an
independent attempt: other edits detected in <file>" without executing anything.
Otherwise it copies the pinned exercise (declared files replaced by the learner's
bytes), check and assets into private session artifacts and runs `node <check>`
through `runVibe64Command` (`training-code-check`, empty env, allowed root =
scratch, lesson timeout default 15 s and at most 60 s, 4 KiB output), accepting
only a result echoing the computed `filesHash`.

### Preparation checkpoint and live Workspace setup

`learning.read` is deliberately read-only: saved `preparation.phase` is an earlier
checkpoint, not a current running/healthy setup observation. When a preparation
returns `preparing` while that session's setup run is active, the preparation
owner keeps that exact run (`terminals.waitForWorkspaceSetup`, read in the
practice Project context) and, once it settles, reruns the same `prepareLesson`
for the same attempt under the original preparation barrier, retrying a briefly
busy barrier at most three times. It records ready only through the same proof;
a failed or changed setup keeps its diagnosis, and Resume remains the explicit
recovery. `lesson.resume` keeps the same attempt/project/initial session and
freshly checks that session, including `workspaceSetupIsPrepared`, before
recording ready. Ready does not prove running App Preview or a learner pass.

### Lesson visual resources

`visualResourceActions.js` and `visualResourceRoutes.js` provide one API-only,
assistant-excluded read, `GET /api/vibe64/training/attempts/:attemptId/visuals/:visualId`.
It authenticates the actor, finds any of that learner's retained attempts
(the reader shows ended lessons too), and returns the verified SVG, controller
and asset bytes of the pinned lesson revision as a bounded base64 envelope with
`Cache-Control: private, no-store`, plus the diagram state a version 1 lesson
saved, if any. A host with paired normal/author-preview learner scopes reuses
these owners.

### Question-admission release boundary

The published `20261007-training-question-admission` boundary stays in the
ordered registry. It covered optional question fields, native
`turn.metadata.trainingQuestionDelivery` metadata and canonical user
`data.trainingQuestion`, which are no longer written. Check/apply changes only
the ordered ledger; no historical records, messages or question provenance are
inferred or converted.

### Offline adoption of original prepared practice sessions

Training owns `practiceHistoryUpgrade.js`, assembled by the existing candidate
upgrade CLI through one typed Core delegate. Its durable authority comes from
the original Learner read-only progress/pin/preparation and exact immutable
project marker, separately for normal and author-preview state. The policy
explicitly adopts only the saved preparation-owned initial session. Field
absence previously meant Working; project prefixes and display usernames are
not purpose or learner authority. Unreferenced sessions remain Working.

The original Core runtime inventory and Runtime offline session owner supply
actual paths and archive pairing. The original backup publisher supplies frozen
before/after publication; Training independently revalidates every frozen after
binding against fresh saved authority on retry. Progress, pins, source, native
identity and grading receipts are not rewritten. Preparing/ended state retains
its meaning. Renewal transactions require their original owner's interpretation
and are not adopted by this bounded cut. There is no request backfill, new
journal, runtime, native retirement or historical teaching-proof inference.

Source and draft-original-file tests do not establish installed activation,
actual installed history counts, all-provider continuity or learner acceptance.
Sources: `packages/vibe64-training/src/server/practiceHistoryUpgrade.js`,
`bin/upgrade-state.js`, existing Core `stateUpgrades.js`/`stateUpgradeFiles.js`,
original `vibe64TrainingLearnerState.unit.test.js` and `stateUpgrades.unit.test.js`.

### Learning-space reset upgrade

`20261022-learning-space-reset` (Core registry, candidate CLI only) calls two
owners. Training `learningSpaceResetUpgrade.js` `resetLearningForLearningSpace`
moves every v1-marked practice project (namespace, local session source and
runtime root) and the learners' attempt state and source-less `learning-*`
stores out of use, keeping `teacher-notes.json`; it selects nothing without a
valid v1 training marker, so normal projects are untouched. Colleague
`learningWatchUpgrade.js` `retireColleagueLearningWatches` removes
`learning-task` watches and their observations. It lives in Colleague because
Colleague depends on Training. Check mode writes nothing; retry resumes the
frozen manifest. Details: `docs/state-upgrades.md`. Sources:
`packages/vibe64-core/src/server/stateUpgrades/20261022-learning-space-reset.js`;
evidence: `learningSpaceResetUpgrade`, `stateUpgrades` and
`colleagueConversationUpgrade` unit tests.
