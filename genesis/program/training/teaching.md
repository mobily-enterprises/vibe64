# Pinned teaching brief

## Sources

- `packages/vibe64-training/src/server/teachingBrief.js`
- `packages/vibe64-training/src/server/installedContent.js`
- `packages/vibe64-training/src/server/learnerState.js`
- `tests/server/vibe64TrainingTeachingBrief.unit.test.js`
- `packages/vibe64-training/src/server/assessmentGrader.js`
- `packages/vibe64-colleague/src/server/conversationSummary.js`
- `packages/vibe64-runtime/src/shared/agentExecutionProfiles.js`
- `tests/server/vibe64TrainingAssessmentGrader.unit.test.js`
- `packages/vibe64-training/src/server/teaching.js`
- `tests/server/vibe64TrainingTeaching.unit.test.js`
- `packages/vibe64-training/src/server/answerAssessment.js`
- `packages/vibe64-training/src/server/assessmentActions.js`
- `packages/vibe64-training/src/server/teachingActions.js`
- `tests/server/vibe64TrainingActionTools.unit.test.js`
- `packages/vibe64-training/src/server/declaredCheck.js`
- `tests/server/vibe64TrainingDeclaredCheck.unit.test.js`
- `tests/fixtures/training/orientation-response.mjs`

## Public contract

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
or restarted server interaction is incomplete, not a learner pass. The native
observation admission owner must still prove learner origin, visible App frame,
question/attempt correlation and actual explanation before invoking grading and
the original progress writer. This internal owner has no API/tool registration
or persisted state upgrade. Its focused fixture preserves the original topic
check and uses real standalone finite execution against a loopback HTTP transport
fixture; it does not claim hosted fleet or learner gesture acceptance.

### Admitted answer assessment

The internal answer owner receives a canonical accepted user message from the
original Colleague admission owner. It checks this learner's ready active pin and
saved question snapshot, uses the actual message identity and words, then invokes
the existing pinned-rubric grader through Colleague's original retained Helper.
It has no message writer, provider process or public outcome setter. The original
learner owner records the result with CAS and consumed-evidence protection.

A same-submission replay verifies the retained evidence and returns through the
original progress writer before inference, even after advancing the question.
Changed evidence, an already-consumed message, an obsolete question or stale
revision cannot start another grading run. Failed Helper output, cancellation or
a changed checkpoint does not save an invented result. The native caller must
recheck actor, current accepted turn, generation and conversation before returning
Helper output to this owner; the Training owner rechecks the question and retains
its original revision fence before saving.

The answer-evaluation action accepts only attempt/revision/submission/message
identities; no supplied text, assistance, question or outcome. It projects the
actual saved assessment feedback and completion counts. Online registers the action
against the original Colleague accepted-turn owner and retained Helper. Focused
native admission and wiring checks cover that boundary; full learner acceptance
remains separate. This action does not
assess practical learner gestures or execute a declared check.

### Internal question admission foundation

`createTrainingTeachingOwner({learners,content})` reuses the original private
learner state and installed-content readers. `prepareQuestion` receives an admitted
actor, exact ready active attempt, expected state revision, stable native request
ID, declared assessment ID, question text and authoritative assistance. It saves
the question through `saveLessonResume`, preserving stage, visuals and summary.
The server uses the request ID as the question identity and the native CAS revision
as its `issuedRevision`. An identical retained question replays before stale CAS;
a later visual checkpoint is preserved. Changed contents under that same current
identity conflict. This retains native current-checkpoint replay semantics, not
an unbounded question-operation journal.

The original checkpoint writer refuses changed text, assessment or assistance
under an identical already-issued question ID/revision. This small ownership
adaptation prevents a saved visual checkpoint from reinterpreting queued answers;
legacy questions without an issued revision retain their original write behavior.

`captureQuestion({actor,reference})` is write-free. Its exact bounded reference is
`{attemptId,questionId,assessmentId,issuedRevision,topicHash,lessonHash}`. It checks
the same ready active question and fresh installed lesson before returning a
detached frozen server snapshot
`{schemaVersion:1,learnerId,attemptId,pin,resumeRevision,question}`. The question is
exactly `{id,assessmentId,text,assistance,issuedRevision}`; `pin` is the original
course/topic/lesson pin. A visual/pause/summary checkpoint can change the observed
`resumeRevision` without changing question authority. A replaced question, even
one reusing an earlier ID, has another issued revision and rejects the old
reference. The snapshot proves saved question association at capture time, not
visible delivery, accepted answer text or a native message receipt.

`readQuestionReference({actor})` supplies that same six-field reference through
the caller's existing state read. It returns null for no active ready question or
missing historical provenance, validates the original installed pin and never
writes or creates metadata. Corrupt or unavailable content remains an error; the
host may keep ordinary chat available without claiming a grading association.
Colleague's read supplies at most 64 completed native practical candidates from
its current canonical record: an `assistant_action_execute` receipt for the exact
`practical.evaluate` action and an accepted same-turn message with original
delivered-question identity. The teaching read withholds that question only when
its content-validated saved passed submission matches the candidate's exact
reference, submission ID, observation ID, assessment and rubric revision. Tool
output or model text alone cannot hide it. Archived records never contribute;
newly issued reassessment stays eligible. Capture and immutable receipt retries
keep their original semantics; no checkpoint is cleared or backfilled.

Assistance is an admitted teaching fact (`none`, `hint`, `demonstration` or
`substantial`), never a learner claim or a default inferred from absence. Original
pending questions may omit assistance and issued revision; they remain readable
and unchanged but cannot be captured for grading. Explicit new preparation uses
a new question identity rather than backfilling an old question.

Before activation, append a prospective numbered compatibility boundary for these
optional question fields and the later canonical user `data.trainingQuestion`
snapshot. Check/apply should change only the ordered ledger with writers stopped;
no historical records, messages or question provenance are inferred or converted.
The future native admission owner must validate the exact bounded reference,
attach this server snapshot to its original immutable message data, then use the
original accepted message ID/text and scoped Helper lifetime. The foundation adds
no canonical message writes, public action, grading caller or conversation loop.

### Question preparation action

The shared `question.prepare` action re-resolves the authenticated actor through
the original global action context. The host supplies the same named teaching
owner used by native admission, and the original Colleague turn/staging facility.
Before saving anything, native `requireTrainingQuestionTurn` checks the current
accepted interactive turn, scope/generation/client and completed explanation cue
(or no cue). The action then prepares the exact installed assessment question
through the original checkpoint writer and calls native `stageTrainingQuestion`,
which repeats its current-turn checks in the original transaction.

The result contains only question text, assessment, bounded reference, state
revision/replay and `delivery:prepared`. The next entire final answer must exactly
equal that question text; native canonical delivery is a separate owner and cannot
be inferred from the tool result. No grading or pass write occurs. A checkpoint
failure retains the original unconfirmed-save code; known saved preparation with
failed staging explicitly reports saved but not confirmed delivered. Retrying the
same request can stage that saved question without replacing its checkpoint.
Concurrent retirement is not rolled back or described as delivery. This is one
direct action, not a raw resume writer, autonomous follow-up or teaching loop.

The internal `createTrainingTeachingBrief({systemRoot}).readBrief({actor,attemptId})`
reads the exact saved active attempt through the original learner-state owner with
`includeCompletion:true`. Its caller supplies a freshly authenticated actor and
current access policy; the reader does not authenticate an actor object or admit
new work. It reuses pinned lesson/visual reads and the original completion rule.
It does not reconcile a stale active summary or write learning state.

The brief contains canonical teaching text, anchored rubric sections, declared
assessment/evidence contracts and visual command vocabulary. It includes saved
preparation, submissions, assistance, pending question and visual resume state,
with their state revision and the progress owner's completion totals. Its
`learning.retainedPasses` identifies original passed submissions from ended
attempts only at the identical topic/lesson pin, including their old attempt and
native evidence provenance. Current submissions and resume state remain separate;
old practical evidence does not claim a new exercise interaction. Saved
preparation is not current Preview readiness; saved semantic state is not a live
animation receipt. It distinguishes command acceptance from actual completion.

Pacing keeps one short question at a time, uses the learner's admitted words and
requires independent follow-up after substantial help. Demonstrations and diagram
motion cannot substitute for practical evidence. The brief cannot grade or save a
result and grants no operation authority. Source, controller/SVG bytes, checks,
asset paths and manifests remain in their original internal readers.

The serialized brief is limited to 128 KiB. Oversized content fails with author
guidance rather than silently truncating teaching text or rubrics. Missing or
changed content retains the installed reader's actionable error. This module is
not a registration owner, prompt, teacher runtime or learner UI; the shared
action catalogue below projects its returned facts.

## Shared lesson operations

`packages/vibe64-training/src/server/actions.js` provides six original-catalogue
operations: courses list, learning read, teaching-brief read, lesson start,
lesson resume and lesson end. They use Core's fresh actor context and expose bounded teaching
text and saved facts without source paths, executable controllers or shell
authority. API and assistant tools use the same projections. A host supplies the
existing exercise preparation/retirement owner; without its relevant method,
start/resume/end reports unavailable. `learning.read` includes bounded ended history;
the brief's retained-pass projection preserves original attempt/submission IDs
without learner IDs, repository/source paths, rubric file references or executable
bytes. Readers do not reserve or repair state. An ended start replay returns its
original target and actual current active attempt without provisioning it.
`lesson.end` accepts exact attempt/request/revision and restart/discard reason,
returns the ended target plus actual active state and native replay flag, and
retains the exercise and all history. It does not Stop, close, archive or delete;
those are separate existing authorised operations. Neither old replay can retire
or reactivate a successor. Preparing a lesson never claims Preview
is running, and these operations alone do not implement guided assessment.

New-start guidance requires a course-list and learning-state read in the same
teaching turn. Earlier chat results can name a disabled release. Catalogue topic
IDs belong to pinned content, not usage topics; the returned attempt's native
teaching brief supplies its lesson text and rubrics. A missing help guide is not
evidence of missing installed content. The original admission/replay owners still
validate the exact target; the guidance does not alter catalogue or learner state.

## Preview composition

`packages/vibe64-training/src/client/TrainingPreviewPresentation.vue` composes the
original App Preview slot alongside the unchanged `TrainingVisualPlayer.vue`.
The original Autopilot Preview tree supplies its App body. Both views remain
mounted under `v-show`; switching and minimising do not replace an App iframe or
stop its process. The original `Vibe64ProjectOnboarding` displayed Preview owner
publishes an optional live `presentation` handle, with no second owner registry.

The handle opens one exact attempt/declared visual through the signed-in host's
`GET /api/vibe64/training/attempts/:attemptId/visuals/:visualId`. It accepts the
original verified base64 file envelope, waits for actual player readiness and
returns only bounded IDs/display facts. Commands and semantic snapshots require
the same displayed identity; accepted is provisional and command completion comes
only from the original player. Actor/project/session changes and unmount retire
late resource reads/readiness. A hidden supported controller receives its own
pause command and snapshot; showing it does not replay motion. There is no new
renderer, command receipt cache, queue, durable store or speech owner.

The composing host still owns resource authentication, active-attempt/pin
verification, browser command acknowledgement and eventual canonical output cue
correlation. This component is not evidence that those tools are registered or
that a learner passed an assessment. Original client tests prove composition with
a player contract stand-in; the retained native player/browser gates and actual
App iframe preservation require separate composed proof.

## Authenticated presentation commands

`packages/vibe64-training/src/server/presentationActions.js` registers visual
open, command and snapshot against the existing Colleague navigation owner.
Fresh actor/project authorization and the learner's active prepared attempt
choose the exact lesson, visual vocabulary and initial exercise session. Inputs
never select SVG/controller paths or executable code. Declared command parameters
are checked before the browser is contacted. The existing initiating-client
navigation receipt waits for ready, completed or the actual semantic snapshot,
with exact attempt/visual/player and command identities. No new queue, renderer
or persistence owner is added. These display receipts are not narration
completion or assessment evidence. Audio/visual cue correlation remains separate.


## Internal assessment grading

`createTrainingAssessmentGrader({content,helper}).grade(state,input,context)`
reads the exact installed lesson pin and its anchored rubric. The admission owner
supplies the actual learner evidence, saved question association and assistance;
the grader cannot authenticate a browser report or establish that a message was
admitted. Declared practical producer/operation/check identities must match, and
a check-bearing practical requires its check owner's verified result for that
observation. Demonstrations and failed checks cannot pass.

The supplied small Helper facility is the original workload-parameterized
`conversationSummary.runHelper`. Its existing account selection, retained
`summaryHelper` record, thread/run/execution receipts, bounded profile and cleanup
ownership remain unchanged. The caller must use the original serialized
`summaryRunning`/`summaryAbort` lifetime; this module adds no runner, persistence,
queue or runtime. The named `training_assessment` workload routes independently
through the original Helper policy with 24,000 input characters, 8,192 output
characters and 120 seconds, without tools, environment or repository access.

Only strict `outcome` and a 1,024-character explanation are returned. Invalid JSON,
unknown fields, unavailable inference and uncertain cleanup reject without a
grading result; failed native cleanup remains in the original record for retry.
Demonstration/substantial assistance requires an independent follow-up. Evidence
and rubric are not silently truncated. The original learner-state writer remains
responsible for saving evidence and completion. No grading action, question
admission hook or guided-learning activation is registered by this increment.

## Explanation cues

The original presentation actions admit one declared cue on the initiating
Colleague connection. Its arm receipt confirms actual Preview readiness, not
motion or speech completion. The existing Colleague service captures the accepted
reply turn, then binds only its actual final assistant output ID. The native API
initially streams preambles as assistant text before reclassifying tool/progress
text; while this one cue is armed the application's voice projection waits for
that classification. Ordinary transcripts and uncued streaming speech retain
their original owners and behavior.

The same published Preview handle receives exact cue correlation and generic
playback events. It dispatches the original player command on actual audible
start and waits for visual completion plus required audio completion. Sound-off
Continue is available only after the canonical explanation finishes; explicitly
continuing without sound records audio off, never a fictional audio receipt.
Hidden, stopped, reloaded or changed scopes retire the cue and use declared pause
and the original semantic snapshot. No restore starts motion automatically.

A typed second-phase receipt uses the original Colleague navigation acknowledgement
with exact initiating client, navigation, cue, conversation, turn, output,
attempt, visual and player IDs. Same receipt retries have no second effect;
armed/accepted and stale/forged completion do not pass. Cue read is write-free
and does not wake a model. The cue is ephemeral application coordination, not a
new narration history, teacher loop, queue, event bus, poller or durable journal.
Assessment evidence and saved semantic state remain their original learning
owners. Mobile uses the original minimise operation to reveal Preview without
ending the voice session or replacing the draft. Native composed browser/audio
proof remains separate from original client presentation stand-ins.

Deliberate diagram retirement may use the original voice binding's `stopSpeech`
only when the last actual playback callback still matches its exact conversation
and output. This interrupts current and queued speech for that binding; it is
not selective audio pause/resume. Drawer minimisation, a successor output and
another active voice owner never use this stop. Recovery requires an explicit
repeat.


## Question-admission release boundary

Before activating these writes, operators must apply the prospective
`20261007-training-question-admission` boundary through the complete candidate
registry with learner and conversation writers stopped. It covers these optional
question fields, native `turn.metadata.trainingQuestionDelivery` prepared/delivered
metadata with actual saved output identity, and canonical user
`data.trainingQuestion` with its exact delivery conversation/turn/output identity.
Check/apply changes only the ordered ledger; no historical records, messages or
question provenance are inferred or converted. Missing legacy facts stay ungraded.


## Native learner gesture admission

The application supplies one named shallow-ref channel from the current
Colleague connection to its original native project selector, session tabs,
Show chat, phone Show project and Preview controls. The Colleague owner captures the trusted click,
its actual body visibility, actor, client, conversation and six-field delivered
question reference before the original UI action. The Online host observes the
original settled route, selected session and layout without opening or changing
any view. Session selection requires visible Main chat; Preview selection requires
visible Preview. A native phone Show project click admits the existing preview-select
ticket only when it changes chat to the selected Preview, with original pane state
settled before finishing the ticket. Automatic attention/navigation, a desktop
collapse, an already visible project or Dashboard reveal creates no Preview
receipt. Both headers forward the original click event; launcher visibility
retains its original owner. Selecting an already selected exercise project remains valid.

The captured identity is rechecked before and after the HTTP-only native
observation request. Programmatic navigation, focus updates, automatic close and
unqualified dialog events do not produce a receipt. Minimize and restore use the
original controls and preserve the original controller/session/draft. Transient
client tickets are bounded to eight and disappear on account, conversation or
question changes. Failure reports an unconfirmed lesson observation, not a
failed or rolled-back workspace action. There is no durable browser journal,
new teacher loop, grading claim or assistant-callable observation tool. Native
hosted acceptance and the server assessment owner remain separate proof.

`capturePractical({actor,reference})` reuses the original strict active ready
lesson/question read. It returns the frozen server question snapshot, saved
exercise project/session and declared evidence contract only for
`workspace-navigation` (workspace producer) or `return-to-colleague` (Colleague
producer), with no executable check. It preserves saved assistance and performs
no state write, grading or execution. Colleague owns HTTP gesture admission and
transient receipts; the existing assessment/progress owner remains responsible
for any later outcome.

### Admitted practical assessment

The existing `createTrainingAnswerAssessment` owner also exposes internal
`evaluatePractical({actor,attemptId,expectedRevision,submissionId,message,
observation,checkResult}, {state,context,helper})`. Both methods share the original
accepted-message and delivered-question admission, submission replay, consumed
reference, revision, current question, abort, retained Helper and progress-write
path. The native caller supplies an already admitted observation for that exact
learner, question, attempt, reserved project/session and authoritative assistance;
this method does not create observations or prove browser gestures.

Practical evidence uses the accepted canonical learner message's actual text,
not the native factual observation text. It retains only original observation
evidence fields, maps native teacher origin to demonstration, and selects any
check identifier from the exact installed assessment. The original grader checks
producer/operation and the declared check result before inference, and receives
no answer-question argument for a practical. Demonstrations and failed checks
cannot pass. Saved submission replay and consumed observation IDs use original
progress receipts before another inference; no journal or state schema changes
are introduced. The native caller retains current observation verification under
the original Helper lifetime. Hosted gesture and full lesson acceptance remain
separate evidence.

The same read-only `capturePractical` additionally admits the exact installed
`try-the-application` contract: exercise producer, matching operation and
`orientation-response` check. Reading that contract executes nothing. The native
Colleague HTTP owner selects the App terminal through its original output action
and invokes the original declared-check facility; assessment evaluation separately
requires actual accepted learner explanation and immutable saved assistance.
Observation completion never substitutes for the assessment/progress writer.

## Orientation App frame bridge

The original OutputControlsSurface message listener admits only the orientation
availability packet from its exact original App window and allowed Preview
origin. It retains at most one early candidate and one transferred document
port, validating the authored ready/button/request/response-displayed sequence
against the original frame generation, project, selected session, terminal
lifecycle and fresh player/server/interaction/request identities. The diagram
window, synthetic child clicks and readiness/load packets cannot provide the
learner action.

The same named Colleague channel captures the current delivered application
question and actor/client/conversation before the button observation. App,
window or document hiding and layout/context changes retire unfinished evidence;
the document port stays inert so a later fresh press can work without reconnecting
the child. Original reload/frame/service replacement and unmount close the port.
Actual iframe viewport intersection uses the existing capture owner's exported
geometry calculation without invoking media capture. Original Preview identity,
diagnostics, proxy, navigation and iframe/capture owners remain unchanged.

Only the correlated visible response reaches the assistant-excluded native
observation endpoint with bounded UUIDs and numeric frame generation. No browser
origin, terminal, command, source, grading result or screenshot is sent. The
server separately runs the original pinned declared check against its own managed
service origin; the learner's accepted explanation and assessment owner still
control completion. This local integration requires composed native acceptance
before claiming the real hosted lesson passes.


### Preparation checkpoint and live Workspace setup

`learning.read` is deliberately read-only: saved `preparation.phase` is an earlier
checkpoint, not a current running/healthy setup observation. The original hosted
initializer starts asynchronous Workspace setup; its completion does not itself
write learner readiness. During an already-requested lesson, `lesson.resume` keeps
the same attempt/project/initial session and freshly checks that session through
its original preparation owner, including `workspaceSetupIsPrepared`, before
recording ready. Original `sessions.inspect` exposes the actual reported
`workspaceSetupStatus`; repeated learning reads neither refresh that authority nor
advance the checkpoint. `question.prepare` remains restricted to a ready attempt.
No background polling, lazy handler repair or new operation is added. Ready still
does not prove running App Preview, successful view opening or a learner pass.

The existing `TrainingPreviewPresentation` component/player is consumed through
the explicit `@local/vibe64-training/client/preview-presentation` package export.
It does not use a source-root `/packages` browser URL. This package-boundary
adaptation retains the existing interface/state and player owner; actual opening
errors require truthful recovery rather than claiming the view opened or is healthy.


### Resume checkpoints and remaining assessments

The original learner-state pass predicate now serves both completion counts and
the read-only brief's pinned assessment IDs. `passedAssessmentIds` and
`remainingAssessmentIds` derive from content-validated current and retained
attempts with the same topic/lesson pin and rubric revision; the existing
completion return shape stays unchanged. The action projection exposes those
bounded curriculum facts alongside the untouched resume checkpoint and receipts.
A saved pending question may already have passed, so start/resume guidance requires
a fresh brief and normally continues a remaining assessment. Explicit preparation,
capture and reassessment retain their original semantics and earlier passes.
Resume/navigation/setup requests are not grading inputs; the native delivered
question and accepted-message fences remain authoritative. No stored question is
retired, message reattached, historical state repaired or new format introduced.


## Durable visual checkpoints

The Teaching owner saves only one declared semantic visual snapshot through the
original learner saveLessonResume lock, exact pin validation, replay and CAS. It
preserves the issued question, stage, summary, other visuals and submissions.
Same validated semantic state confirms current state without another write; this
is not an old operation receipt. Existing resume.visuals shape and its assessment
compatibility boundary suffice; no new format or historical backfill is added.

The Preview wrapper reads the current authenticated revision before requesting
an actual settled controller snapshot, then retains that revision, request ID and
body for an unconfirmed retry. Actor, exercise, selection, transition and player
identity remain fenced. A rejected revision needs a new explicit current capture;
an unknown save cannot be silently rebased. Raw snapshot queries and restores are
read-only. A new Player mount consumes the saved snapshot through its existing
prop/protocol, restoring paused state and labels without motion or cue/audio
completion. Hard unload promises only the last confirmed checkpoint. A real
concurrent assessment write still uses its original CAS and can conflict; no stale
Helper result is forced into progress.

Sources: packages/vibe64-training/src/client/TrainingPreviewPresentation.vue;
tests/server/vibe64TrainingVisualPlayer.browser.test.js, existing Teaching and
learner-state tests. Hosted transport stays API-only in the original visual
resource boundary; no model-facing checkpoint writer is added.
