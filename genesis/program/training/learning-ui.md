# Learning UI request coordination

One client adapter connects the root and project views to the original Training
reads and commands without creating a second session panel or progress owner.

New trusted Learning sessions start in Junior through the original Sessions
`resolveSessionStart` role/access owner, for both reserved source-less lessons
and actual practice workspaces. Working and renewal defaults remain Senior.
Existing saved routing is never rewritten on Open or Resume; the original Chat
mode menu retains user selection of Senior, Junior and Custom without new controls.

## Sources

- `src/composables/useVibe64LearningMode.js`
- `src/components/StudioAppShellLayout.vue`
- `src/components/studio/Vibe64LocalAppIndex.vue`
- `src/pages/app/project/[slug].vue`
- `src/components/studio/ProjectSelectionGate.vue`
- `src/components/studio/Vibe64LearningLessonLauncher.vue`
- `src/components/studio/Vibe64SessionPanel.vue`
- `src/composables/useVibe64SessionPanel.js`
- `src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64ConversationLog.vue`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64SessionRuntimeHost.js`
- `src/lib/vibe64LessonDashboard.js`
- `src/placement.js`
- `src/components/studio/EnvPanel.vue`
- `src/composables/useArchivedVibe64Sessions.js`
- `src/composables/useVibe64RepositoryWorkspace.js`
- `packages/vibe64-system-graph/src/client/composables/useVibe64SystemGraph.js`
- `packages/vibe64-core/src/server/featureRoutes.js`
- Main: `packages/vibe64-training/src/client/TrainingPreviewPresentation.vue`
- `packages/vibe64-training/src/client/useTrainingLearnerGestures.js`
- `packages/vibe64-training/src/client/useTrainingWorkspaceObservation.js`
- `src/components/Vibe64AssistantShellContext.vue`
- `src/components/Vibe64LocalColleagueHost.vue`
- `src/components/studio/Vibe64LearningPracticeProjectSelector.vue`
- `packages/vibe64-training/src/client/useTrainingPresentationCue.js`
- `packages/vibe64-training/src/client/createTrainingNavigation.js`
- `packages/vibe64-training/src/client/trainingGuide.js`
- `packages/vibe64-training/src/client/TrainingGuideOverlay.vue`
- `packages/vibe64-training/src/shared/guideTargets.js`
- `packages/vibe64-training/src/client/useTrainingPreviewRegistration.js`
- `packages/vibe64-training/src/server/visualResourceActions.js`
- `packages/vibe64-training/src/server/visualResourceRoutes.js`
- `packages/vibe64-colleague/src/client/Vibe64Colleague.vue`
- `packages/vibe64-voice/src/server/Vibe64VoiceProvider.js`
- `packages/vibe64-voice/src/client/projectVoiceBinding.js`
- `src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue`
- `packages/vibe64-training/src/server/registerRoutes.js`
- `packages/vibe64-training/src/server/actions.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-sessions/src/server/service.js`

## Public contract

`useVibe64LearningMode({onConversationOpened})` reads the original router's
`mode=learning` flag; absence means Working. In Learning, its separate
`learningView` query state selects `workspace` or `learning`, defaulting to the
normal workspace. `setLearningMode` and `setLearningView` preserve the route's
path, hash and unrelated query fields, while leaving Learning clears the view
choice. These flags are presentation, never Training or session authority. The
root app and project page attach the existing L control and original picker to
the same session panel. The adapter itself owns no mounting or session state.

The project page uses one header and one chat-collapse state for both modes:
the same collapse arrow, `setChatCollapsed`, mobile next-pane button and shared
shell pane swipe as Working. Only the projectless root Courses page, which has
no pane switching (`mobilePaneSwipeEnabled` false), stacks chat and lessons at
phone widths (`studio-app-shell-layout--learning-stacked`). The **L** control is
a small icon button: flat yellow and `aria-pressed=true` ("Leave Learning
mode") only while Learning is on, outlined and unpressed ("Enter Learning
mode") otherwise. The project page switches one right-hand region between the complete retained
Preview/Dashboard workspace and the existing Training lesson/player composition.
The normal workspace remains the default only when the exact selected Learning
session owns a supervised project. Source-less sessions force the Learning pane.
No alternate teacher, session panel, Preview, progress writer or
presentation host is introduced.

`coursesResource` and `learningResource` use the original endpoint resource,
Vue Query cache and HTTP cancellation, scoped by the injected actual viewer
actor. A private reader envelope masks old data synchronously on actor changes;
signed-out and denied readers expose no progress. Same-actor transient errors
retain loaded state. Reads remain available in Working mode so hidden Learning
sessions can stay mounted. The API-only own `learnerId` remains separate from
the shared viewer and Colleague identities. Refresh does nothing when signed out.

`startLesson` accepts the existing picker's course/release/code/revision intent
and retains one generated request ID with those exact inputs after uncertainty.
`starting` marks the in-flight request; `startRetry` offers the exact retry only
after a start settles unconfirmed, so the picker shows distinct starting and
unconfirmed-start states. `retryStart` does not rebase the revision or admit changed intent. `resumeLesson`
targets the requested attempt. Both use the original Training HTTP actions and
by default open only their confirmed active attempt through the original
learning-scoped Session Create route with an empty body (source-less lessons; a
practice lesson's session is an ordinary project session since Learning v2). An ended original
replay never opens an unrelated current successor. Admission, replay, pins,
capacity, progress and grading remain with their original server owners.
`createCourse` posts the owner's custom-course name, ordered topics and the
displayed catalogue revision to the original Training `courses.create` action,
then rereads courses; it admits no lesson and writes no progress. The launcher
passes it to the picker, which shows **New course** only when `courses.list`
reports `canCreateCourses`; it offers a preview course's lessons, labelled
**Try preview**, only when `courses.list` reports `canTryPreviews`, and otherwise
shows the preview note. The Learning content button and the root header read
**Courses**; the internal `lessons` pane and `picker` navigation names are unchanged.

In Learning only, the adapter also reads `available` (the official catalogue)
and `installCourse` posts `{courseId, release}` to `course.install`, polling the
catalogue for per-topic progress meanwhile, then rereads courses and catalogue;
its failure stays on that course row as an actor-scoped install state. The
picker renders `TrainingCourseCatalogue.vue` (catalogue domains as **topics**,
their courses with Install/Update/View states) below the installed cards, offers
**Update** on an installed card when a newer catalogue release exists, and hides
a release an update disabled unless the saved lesson still uses it.
`courseProgress` marks a lesson whose hash changed but whose earlier hash is
completed as **Completed in <release> · updated since**, display only. Hosts that
do not pass a catalogue keep the original installed-only empty state.

The adapter serializes its UI operation only. Captured actor, API learner and
route generation fence new follow-up requests and the selection callback.
Changing mode, account or route does not undo or resend admitted work. Late
results return original attempt/learner/session IDs without selecting a new
view. `openConversation:false` skips opening and selection. No automatic teacher
message is sent. Retry identity is temporary UI state, not a new persisted
journal or a promise of hard-unload recovery.

## Original panel attachment

The project page keeps its existing Preview toolbar host mounted across mode and
right-view changes. It supplies the original target in Workspace and an empty
target while Learning covers it, so OutputControls keep their existing local
placement without a deferred Teleport into an absent host. Preview/Dashboard and
each Dashboard tool stay mounted under their original owners while covered.

The retained Main wrapper distinguishes hiding through the Working/Learning
purpose filter from ordinary tab or chat visibility. The existing session-purpose
matcher supplies that reason; ConversationLog keeps one local visibility reason
and opts into the shared transcript's existing retained-reader behavior. Returning
from the mode filter restores its reading anchor, while ordinary hiding clears
that opt-in and session identity changes use the original initial scroll. No
second transcript, persisted scroll record or SDK policy change is introduced.


The app index retains one original Panel while its Working project picker stays
on the original force-picker/navigate path. The project page uses the same Panel
through the original ProjectSelectionGate. Its opt-in independent content gains
no project authority: the actual Training resource and original session owners
still authorize Learning. After first admission/readiness, the opt-in gate keeps
its exact slot mounted through mode changes during project loading or failure.
An inactive hidden slot projects the existing Host active signal; it does not
cancel an already admitted native turn. The existing global empty Temporary
host remains its Working conversation: Learning hides it, disables its active
reader and ignores late select-main callbacks without clearing its shared state.
The original empty-layout condition may still unmount its widget when a saved
session is selected; this change does not claim continuous widget identity.
Absent opt-in preserves the original
Working gate, and Panel active defaults to its prior true behavior.

The Panel's exposed selection delegates to its original sessionData owner only
after checking the actual loaded Learning row, attempt and own learner. It never
constructs summaries or selects a successor from a late request. Launcher local
feedback is scoped to learner and route/mode generation. Retired failures cannot
be displayed as current requests. Shared transport/native errors keep their
existing owners.

The original TrainingPreviewPresentation composes its existing App/player with
an opt-in Lessons slot. Its legacy direct composition keeps its original
App/Lessons/Presentation behavior. The project composition supplies explicit
Workspace/Learning visibility, retains one App, original picker slot and original
sandboxed controller player across page-level switches, and pauses a covered
visual without unmounting it. A practice workspace automatically reuses the
existing exact-session opener before mounting outputs; failure exposes an
explicit retry rather than an unrelated project. The captured Learning Host
exports only its existing exact attempt ID;
the wrapper refuses a different attempt and retires changed scope. Actor fences
and resource pin verification retain their original owners; the server cue and
checkpoint receipts were retired in F2. No pin/progress reader or native receipt
is invented.

For a saved practice App, the explicit App choice first uses the existing empty-body
Learning Session Create operation. Its original opener freshly admits the exact
active attempt under the preparation barrier and awaits Terminals' original
project-runtime open owner before returning the same initial session. No source,
conversation or teacher input is created. The browser checks the captured actor,
attempt, session and exact binding again before showing App or settling the
trusted gesture. Practice App owners remain unmounted until that first confirmed
open; once admitted, the same owners stay mounted through App/Lessons/Presentation
and mode hiding. This prevents an early Outputs read from invoking the original
missing-marker runtime cleanup on a practice teacher. Reads and current-session
alias synchronization do not open a runtime. Working and source-less composition
keep their original policy. Runtime-open refusal keeps the lesson and reports the
failure without mounting outputs or fabricating a practical gesture.

Autopilot's actual App display and toolbar facts use that wrapper's appVisible
and its opt-in activation, so an App choice works even while the original page
pane remains dashboard. Lessons does not count as visible App. The original
Onboarding read/actions use App visibility in this opt-in composition. Its new
optional presentationActive flag retains the same original presentation bridge
for the alive source-backed wrapper across all three choices, including opening
a declared diagram from Lessons. Hidden App reports no setup screen; an actual
visible player keeps the existing Online lesson-presentation focus projection.
This split is necessary because the original active flag owned both App reads
and presentation callbacks. Default false retains original Working behavior. A source-less
Host's existing sourceWorkspaceAvailable projection omits App/Onboarding/output
owners and hides Save and Temporary/workspace tools. True/default keeps original
Working controls, including suspended Working behavior. The original empty
Learning pane uses the same host without a fake project, player or teaching
message. The registration owner was moved from Onboarding unchanged;
source-backed Onboarding reuses it at the same active/presentationActive sites.
Hidden App still reports no setup screen.

Learning v2 phase 2 (F2) retired the server side of the Main lesson
presentation: the `visual.checkpoint` action, its POST route, the
learning-scoped visual resource route, the presentation cue and the Main
question/cue/ACK coordinator no longer exist. A diagram is read only through the
plain `/api/vibe64/training/attempts/:attemptId/visuals/:visualId` resource
route (`visual-resource.read`); there is no lesson-scoped checkpoint writer.
The source-less Main Preview registration, its Learning checkpoint client and
its cue/pause methods have no server counterpart any more and are removed with
the Learning mode client in F3. Ordinary Working visual saves are unchanged.

Focused evidence retains the original app-index assertion, project-opening
assertions and command/attention fixtures. Actual compiled setup/templates prove
L placement, exact Start intent and loaded-row selection; loading/error slot
cases prove retained object/draft identity and active projection. Native work,
real device geometry and teacher delivery are not proved by these fixtures.

## Original cue client ownership

Training now owns the exact Colleague client cue coordination through
useTrainingPresentationCue. Colleague immediately reuses it at the same original
voice-state, product/event, playback and actor/unmount sites. It buffers only the
armed exact-client/conversation explanation, forwards real final/output/audio
facts to the sole original Preview handle, stops only the still-audible matching
retired output, and deduplicates the original terminal acknowledgement. The five
facilities are its existing readonly scope, Preview handle, actual voice session,
one receipt transport and product error ref. Navigation, genuine gestures,
question capture and workspace observations remain with their original owners.

The Main lesson cue, question and receipt transport were retired on the server
in F2, so only Colleague's own cue use remains meaningful; the client cue
module is removed in F3 apart from the navigation part, which already lives in
Colleague.

## Retired lesson voice

Learning v2 phase 2 removed the Learning voice socket route from the
VoiceProvider and the lesson branch of `projectVoiceBinding`: a binding for a
lesson conversation now refuses with "Lesson conversations have no voice. Use
Colleague voice to learn with a lesson." Working voice is unchanged. Client code
that still opens Main narration in Learning mode is removed with that mode.

## Original navigation client ownership

The same Training client layer owns Colleague's original navigation execution and
ACK cache, with immediate consumer reuse. Five concrete facilities retain actual
mounted/actor/client scope, the original host callback getter, host mobile
preparation, original acknowledgement operation and error ref. Its actor-reset
order and unmount fence remain at the original consumer sites. Cached receipts
retry acknowledgement without repeating navigation; mobile preparation remains
outside that cache and only its original async branch yields. Colleague is
the only navigation coordinator; the Main server coordinator was retired in F2.


## Actual viewer and retained Learning identity

The Main Learning binding captures the original viewerActorKey before deriving
its composite actorKey for transport, draft and learner/attempt isolation. The
Preview compares only that captured viewer field with the current global viewer,
while retaining both keys in its selected-resource and held-read retirement fence.
It does not parse or replace the composite key, mutate Working identities or
infer authorization. The plain visual resource read still checks fresh
learner/attempt access; the checkpoint owner was retired in F2. The compiled Preview regression receives
the identity from the actual same Main runtime, with observation disabled in the
fixture; this identity proof is separate from installed/native/browser acceptance.


## Original practical gesture coordination

Training owns the original Colleague client ticket collector and Online workspace
settling observer once, with immediate reuse by their original consumers. Original
trusted-click grammar, question fields, eight-ticket bound, awaited-read fences,
12-second settling deadline, drawer/phone gates and real App port correlation stay
with those bodies. No browser pass, receipt journal, grader, player or native
controller is added. Main attaches the same collector only for an exact selected
saved practice target and original authoritative trainingQuestion, using its
existing presentation clientId and the original Learning observation route. The
server derives its typed conversation identity and reauthorizes the saved pin.

The Main composable captures the shell's component-provided gesture channel,
workspace refs, Preview, voice and action-feedback facilities during setup. Its
existing retained application can then be created after the saved identity loads
without losing those ancestor providers. The retained scope clears only its own
gesture channel on disposal; replacement Main or Colleague ownership is preserved.
No collector, ticket grammar or admission guard is replaced. A page reload may
register a fresh current browser connection for the same delivered question;
its actual steps and accepted explanation must use that same current client.

Every selected Learning Main, including a source-less lesson, publishes one
current polling-task descriptor to the original Colleague client. It contains the
exact attempt, project/session, Main conversation, immutable pin and either the
current delivered question reference or a person-supplied bounded criterion.
After trusted named controls settle, the same Training owner can submit one
allowlisted view/control observation to its separate watcher independently of any
practical receipt. Colleague starts and controls that watcher through its existing
surface and hosts the persisted record; neither Colleague's model nor Main checks
what the learner is doing. Practical evidence remains authoritative and a polling
delivery failure does not invalidate it. The host focus publishes only the exact
workspace and Learning view; source-less attempts retain their real session
identity. Navigation performed for Colleague is labelled as a demonstration,
while target or identity changes retire the current polling authority.
Start, Resume and observation recheck the same browser connection and exact
task after source reads. A departure during admission cannot install an active
watch or restore guidance discarded by the existing focus-change owner. This
uses the original watch record, cursor and control serialization; no second
watcher or liveness timer is introduced.
An unavailable source pauses the same watch and retires pending guidance through
its existing pause cleanup. Explicit Resume reauthorizes the source without
replaying undelivered help from before the failure.
Colleague binds browser focus to its existing authenticated realtime socket.
Disconnect or component release retires only that binding through the same
focus-change cleanup; another tab and a newer connection remain independent.
Reconnect registers current focus without automatically resuming its watch.
Replacing/removing Main's task descriptor retires the old watch even when its
attempt/project/session focus remains selected. The existing binding comparison
checks the conversation and Learning client too; retained pane switches keep the
same binding and continue observation.
Start, Resume and observation require that binding's live socket owner. A saved
HTTP focus without a connected browser cannot install or resume a watch; an
explicit retry after connection uses the existing admission path.
The public status claims saved assessment support only for a passed result whose
assessment ID matches the watched task's existing question reference. Unrelated
passes and free-text criteria retain visible saved outcomes without inferred
completion or a new assessment writer.

Training's watcher owns the hidden guidance operation paired with that descriptor.
It rechecks the active attempt, pin, exact Main session and current criterion before
opening the original teacher conversation. A working Main defers delivery so a
learner message keeps priority. An accepted application-origin wake carries only
the allowlisted observation and current saved progress, explicitly excludes an
authored answer or pass, and reuses its stable receipt on retry. Confirmed events
may be related to the criterion; explicit settle/response failures may receive one
hint. No inactivity event, second goal format or assessment write is added; the
watcher's timer performs code-only reconciliation and never asks Main to observe.
The wake's saved text is the teacher's full prompt and stays unchanged in
history. Main's transcript presents a turn as that guidance only when its
server-owned `learning-guidance-` message ID and exact heading both match the
shared `learningGuidance` module that writes it; it then renders a short
system status line instead of a learner bubble, as application-origin and
project messages already do. Saved history needs no upgrade.

In-app request failures reuse that path. The Preview bridge posts a separate
reduced `vibe64:preview-app-request` (bridge version 7) only for a same-origin
POST/PUT/PATCH/DELETE started within 3 s of a trusted click/submit in the frame
that ends in HTTP 4xx/5xx or a network failure: method, path with numeric/UUID
segments as `:id`, status and failure code; the diagnostics feed never joins it.
The output surface forwards it only from the current visible bound Learning
Preview to the gesture owner, which requires the active polling watch, preview
focus and no phone overlay, and keeps the path only when it equals a route the
pinned lesson declared (`task.appRoutes`), otherwise `other`. The watcher refuses
other request facts, keys the once-only evidence by method/path/status and caps
app-request guidance at one per 30 s per watch; it remains hint-only context.

The shared root provides the original companion refs and one actual Colleague
body handle. Online keeps its authenticated AuthGate viewer and original host;
standalone explicitly supplies its established local display scope and mounts the
same Colleague component. No local routed-navigation adapter is invented. The
selected Learning Autopilot publishes original layout/view facts after its same
Main snapshot is present; this does not grant project access. On release, only an
already-mounted original Working page reclaims its original layout.

Practice project lists actual loaded own-learner saved rows and delegates to the
same original session selector. It captures a person click before selection and
settles only a confirmed selection. Like the Working project selector, its label
shrinks to an ellipsis and chevron on narrow app bars instead of overlapping the
Preview | Dashboard | graduation-cap tab group. Automatic Start/Resume callbacks supply no
gesture. Saved Main session and App choices forward their native event, while the original
App observer retains server instance, interaction, player/frame and request IDs.
Main and general Colleague remain different conversations: only the real drawer's
hide/use/restore is eligible for that rubric. Main's pending return question keeps
one exact actual body/conversation provenance; a replaced drawer requires a genuinely
repeated question, and temporary missing data never resets it. Original Colleague
collector defaults have no new drawer provenance watcher.

The original collector/settler and Main/Panel/context composition are implemented
in the source cohort. Focused original-owner component checks have run. Actual
standalone browser checks at 1280×900 and 390×844 retain the Working draft and
App counter across Learning switches, with a 380-pixel right Colleague drawer
on desktop and a full-screen Colleague dialog on phone. The launcher status
uses the existing on-surface text token after a real white-on-white contrast
failure. A preview course offers **Try preview** (the same start) only when
`courses.list` reports `canTryPreviews`. These checks do
not establish actual native question-to-gesture-to-Send, Helper/check/rubric
progress, genuine trusted browser clicks, mobile display, speech or whole-lesson
acceptance. Those remain separate required gates.


## Saved hosted author-trial launcher

The host opts into one original owner-only `author-preview.read` HTTP adapter.
Normal standalone resources/defaults perform no extra preview read. The existing
Learning owner masks its saved trial on actor/role change and uses the same
actor-envelope endpoint resource. One card in the original launcher displays that
isolated active pin and delegates Resume to the same saved-attempt preparation,
empty-body Learning Create and loaded-row Panel selector. It neither reserves on
read nor merges normal progress. A changed trial/role/account fences new Create
and late selection while keeping already admitted effects truthful. An uncertain
Create retries exact Resume/Create through the original idempotent opener.
Snapshot acquisition and explicit end/new-start refresh remain the existing
hosted Colleague actions with original Git/source/account guards. Published Start
eligibility and immutable pins are unchanged; no draft course is promoted. Main
uses the existing paired saved-scope teacher/player/progress owners. Actual
installed owner/member/browser/native simultaneous normal/trial acceptance and
standalone snapshot admission remain separate gates.

An exact outer-project idle-close event retains the selected Learning view. The
original dormant cleanup marks the close through an internal option that the
public Close input cannot set. Its publisher carries that bounded flag and close
reason; the page only
defers the idle-timeout redirect while Learning has its current selected binding.
It retires Working readiness and ignores retired Open success/error replies
without keeping that runtime alive. Returning to
Working calls the original project Open through fresh access and readiness
checks, without restarting its former work. Ordinary Working, explicit Close,
deletion, missing markers and foreign-project events keep their existing policy.

Exact watch reads use the action host’s attempt-scoped learner reader when supplied, with the existing attempt ID. Ordinary progress keeps its normal reader. Hosted composition supplies the existing normal/author scope selector, including current owner admission for preview attempts. Guidance keeps its original `guideTask` WRITE admission; polling does not acquire a second generic WRITE barrier around that owner.

## Local practice-project address

Standalone (local) Vibe64 serves only its selected project, plus one exception:
the current learner's own practice projects. Training registers
`registerLocalPracticeAdmission` (`practiceProjects.js`
`admitLocalPracticeProject`); core `resolveProjectRequestContext` derives the
attempt from the `training-<attempt>` slug, rechecks the saved attempt through
`readExerciseProjectScope` (observe, so an ended attempt still qualifies) and
admits it with ordinary `write` access marked `ordinary`, which
`captureProjectRequestContext` retains for helpers and agent turns. Learning v2:
a practice project and its sessions are ordinary; ending a lesson leaves them
the learner's.

## Learning as a third option of Preview | Dashboard

The project page renders one tab group for both modes (`headerTabs`): Working
shows `projectTabs` (Preview | Dashboard); Learning appends one icon-only
graduation-cap option (aria-label "Learning", title "Learning: courses and
lesson") to the same markup. Each option carries `data-vibe64-guide`
(`preview`, `dashboard`, `learning`). Selecting the cap sets the
route's `learningView` to `learning`; selecting Preview or Dashboard sets it to
`workspace` and runs the ordinary `selectProjectPane`, so Colleague, Main and
the watch use the same values. There is no separate Learning tab or panes
toggle. A source-less lesson disables Preview and Dashboard and stays on the
cap. The same Preview toolbar host is shown whenever Preview is the selected
option.

## Teacher guide overlay

Main's `vibe64.training.view.open` was retired with the Main lesson teacher;
Colleague's `navigation.open` and `navigation.open-learning` guides use the same
closed product list of real places (`guideTargets.js`): `preview`, `dashboard`, `database-erd`,
`database-data`, `files` (optional relative `filePath` without `..`), `changes`,
`git-log`, `session-info`, `architecture` and `learning`. The older
`workspace-preview` and `workspace-erd` names remain aliases that open their view.
Each place is a path of `data-vibe64-guide` ids on existing controls: the Learning
page's Preview/Dashboard/Learning tabs, the real Dashboard section items (`guideId` in `vibe64SessionToolDefinitions.js`,
rendered by `Vibe64ActiveSessionNavItem` and `SurfaceAwareMenuLinkItem`), the
Database Overview/ERD/Data toggle, and file-tree rows (`data-vibe64-guide-path`).
Lessons supply no selectors.

The default (`navigate=false`, `highlight=true`) is point only: the server sends a
command with only `guide` and no Learning mode/pane, so no view changes. The Main
browser (`useTrainingMainPresentation` → `runTrainingGuideCommand`) rings the
deepest visible step, i.e. the next control the learner must click, with a caption
such as "Dashboard → Database → ERD". `navigate=true` ("show me") first runs the
ordinary browser navigator with the normal command and, for `filePath`, the lesson
view handle's `openFile`, which reuses `openSourceEditorFile` (selecting
Dashboard → Files) in the lesson's attempt-scoped Files editor; `dashboard` cannot be opened. Opening with
`highlight=false` is the ordinary navigation command.

`TrainingGuideOverlay` (mounted by the project page in Learning mode, teleported to
the body) draws a ring, pulse and caption with `pointer-events: none`, keeps the
ring still under `prefers-reduced-motion`, and clears after about 8 seconds, on the
learner's first pointer or key press, or when the control disappears. The ACK
carries `guide: { shown, reason?, step? }`; the coordinator rejects a receipt that
claims a drawn highlight without its step or an undrawn one without a reason
(`highlight-off`, `target-hidden`, `overlay-unavailable`). The Main ACK focus pane
also accepts `files`, `changes`, `repository` and `system` for opened sections.

## Full Dashboard in a practice lesson

Learning v2 (F1) retired the lesson-scoped Dashboard. A practice project is an
ordinary project of its learner and the session preparation creates in it is an
ordinary project session (no `learning_session` binding). The learner opens it
like any project, so every Dashboard section, Preview, the chat and AI Terminal
are the ordinary project-scoped ones under `/api/app/<slug>/vibe64/…`, with
ordinary project authorization and realtime routing. The database, project,
source-editor, system-graph and terminal-output providers no longer register
`/api/learning/<attempt>/vibe64/…` routes and their actions declare no
`learningAccess`; `vibe64.training.code.file.save` is gone.

Authorship: Training installs `createTrainingCodeSaveOwner`
(`codeEditorActions.js`) on the source editor with `setFileSaveOwner`. The
ordinary `vibe64.source-editor.file.save` then records the save in the learner's
authorship ledger (`codeAuthorship.js` `saveLearnerFile`) only when the request
project is the actor's own practice project with an active attempt; every other
save is the editor's plain save. Agent or other-route writes stay unledgered and
still void a code attempt. Hosted Online does not install the owner yet.

F2 retired the remaining lesson-scoped server transport: the source-less
teacher's Session routes, the voice learning socket, the learning-scoped Training
visual route and the teacher actions. No server route registers an
`/api/learning/<attempt>/…` path any more; the `learningAttemptId` reads left in
the terminal socket and action context serve no route. Client code that still
calls `/api/learning` for Database, Architecture or old Learning mode is dead
transport removed in F3.

Evidence: `tests/server/vibe64LearningDashboardRoutes.unit.test.js` (no Dashboard
action declares lesson access; no lesson URLs), `vibe64TrainingCodePracticals`
(ledgered save through the owner) and `vibe64TrainingLearnerState` (ordinary
practice session after the lesson ends).
