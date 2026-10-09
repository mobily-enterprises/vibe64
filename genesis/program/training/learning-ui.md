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
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64SessionRuntimeHost.js`
- `packages/vibe64-training/src/client/TrainingPreviewPresentation.vue`
- `packages/vibe64-training/src/client/useTrainingLearnerGestures.js`
- `packages/vibe64-training/src/client/useTrainingWorkspaceObservation.js`
- `src/components/Vibe64AssistantShellContext.vue`
- `src/components/Vibe64LocalColleagueHost.vue`
- `src/components/studio/Vibe64LearningPracticeProjectSelector.vue`
- `packages/vibe64-training/src/client/useTrainingPresentationCue.js`
- `packages/vibe64-training/src/client/createTrainingNavigation.js`
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
- `packages/vibe64-training/src/server/learningSessions.js`
- `packages/vibe64-sessions/src/server/service.js`

## Public contract

`useVibe64LearningMode({onConversationOpened})` reads the original router's
`mode=learning` flag; absence means Working. `setLearningMode` preserves the
route's path, hash and other query fields. This flag is presentation, never
Training or session authority. The root app and project page attach the existing L control and original picker
to the same session panel. The adapter itself owns no mounting or session state.

The original root, project and hosted project Learning pane buttons keep their
existing gesture-aware toggle handlers. `StudioAppShellLayout` supplies one
shared presentation rule: at widths up to 400px, that same button occupies 48px
and shows its chat or lesson icon instead of the text label. The full next-action
accessible name and tooltip remain `Show chat` or `Show lessons`. This leaves
room for the host's compact resource control and minimized Colleague controls;
it does not add a second header or pane owner.

`coursesResource` and `learningResource` use the original endpoint resource,
Vue Query cache and HTTP cancellation, scoped by the injected actual viewer
actor. A private reader envelope masks old data synchronously on actor changes;
signed-out and denied readers expose no progress. Same-actor transient errors
retain loaded state. Reads remain available in Working mode so hidden Learning
sessions can stay mounted. The API-only own `learnerId` remains separate from
the shared viewer and Colleague identities. Refresh does nothing when signed out.

`startLesson` accepts the existing picker's course/release/code/revision intent
and retains one generated request ID with those exact inputs after uncertainty.
`retryStart` does not rebase the revision or admit changed intent. `resumeLesson`
targets the requested attempt. Both use the original Training HTTP actions and
by default open only their confirmed active attempt through the original
learning-scoped Session Create route with an empty body. An ended original
replay never opens an unrelated current successor. Admission, replay, pins,
capacity, progress and grading remain with their original server owners.

The adapter serializes its UI operation only. Captured actor, API learner and
route generation fence new follow-up requests and the selection callback.
Changing mode, account or route does not undo or resend admitted work. Late
results return original attempt/learner/session IDs without selecting a new
view. `openConversation:false` skips opening and selection. No automatic teacher
message is sent. Retry identity is temporary UI state, not a new persisted
journal or a promise of hard-unload recovery.

## Original panel attachment

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
an opt-in Lessons slot. Its default two-view names/policy stay intact; the actual
Learning composition offers App/Lessons/Presentation, with one retained App,
original picker slot and original sandboxed controller player across view
switches. The captured Learning Host exports only its existing exact attempt ID;
the wrapper refuses a different attempt and retires changed scope. Actor fences,
resource pin verification, commands, cues and checkpoint receipts retain their
original owners. No pin/progress reader or native receipt is invented.

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
message. A source-less saved Main identity can now register the same original
Preview handle and use the original player through its captured learner, actor,
attempt, session and exact Learning API path. Invalid or changed bindings retire
selection and cannot read, open or checkpoint a diagram. The registration owner
was moved from Onboarding unchanged; source-backed Onboarding immediately reuses
it at the same active/presentationActive sites, while only an actual source-less
Learning wrapper supplies the new registration. Hidden App still reports no
setup screen. No extra bridge, renderer, progress reader or receipt writer is
introduced. Main supplies its canonical question/cue/navigation/ACK integration through the
same original owners. Actual installed/native/browser/device acceptance remains
a separate gate.

Original checkpoint/cue methods retain their implementation. Exact before-source
runs exposed a prior hidden-pause race: a genuine second hide was dropped while
an earlier pause waited for fresh checkpoint authority. The existing pause owner
now compares a local shown-to-hidden revision when settling, and honours only a
newer hide on the same alive selection still hidden. Phase events do not enqueue
repeated pauses; no prior uncertain checkpoint/request is replayed. This is a
necessary lifecycle correction, not a different player or progress protocol.

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

This move retains Colleague compatibility. Main supplies its canonical delivered
question, cue and receipt transport through its existing selected presentation
binding. No selected attempt, saved
progress or flattened Main history is promoted into those facts. Main speech now reuses its original voice controller with the actual Learning
transport scope described below; an empty project path cannot supply that scope. Native/source-less visual
and installed/browser/audio acceptance remain open.

## Source-less Main optional voice transport

The existing VoiceProvider registers one additional Learning socket URL with the
same original JSKIT proxy/configuration. Original origin validation precedes the
canonical Session Inspect action; its existing contributor reauthenticates the
actor and exact saved attempt, then Training and Store validate the immutable
session/owner/pin. Successful exact inspected ID is required before upstream.
There is no project fallback, copied auth reader, separate proxy/controller or
new active-work rule. Inspect grants observation; every original Main Send still
requires fresh write authority. Voice is optional and local typed Learning stays
independent of the service.

The same projectVoiceBinding branches only on its captured typed Learning Main
identity, requiring exact API path/learner/actor and no project. Its explicit
Learning voice ID includes learner/attempt/session, the socket uses that captured
path, and its label is Lesson plus actual session name. Capture/submission retain
exact learner/attempt/API provenance; an accepted old target never retargets or
resends after navigation. Original Working URL/ID, narration preferences,
controller, retention and queued delivery remain unchanged. No cue/current
question/native receipt field is created by this routing increment.

Original Voice and Runtime tests retain exact full prefixes. Appended cases
exercise the real canonical contributor/action/proxy and same retained Main
binding; the Voice unit saved-context/session reader is explicitly controlled.
Actual saved-state owners retain their own original proof. Installed service,
physical audio, browser/phone and canonical teacher narration cues remain open.


## Original navigation client ownership

The same Training client layer owns Colleague's original navigation execution and
ACK cache, with immediate consumer reuse. Five concrete facilities retain actual
mounted/actor/client scope, the original host callback getter, host mobile
preparation, original acknowledgement operation and error ref. Its actor-reset
order and unmount fence remain at the original consumer sites. Cached receipts
retry acknowledgement without repeating navigation; mobile preparation remains
outside that cache and only its original async branch yields. Main attaches the same navigation owner with its captured initiating client,
typed browser/native identity and canonical cue/ACK fields from the original
server coordinator. Actual browser/native acceptance remains separate.


## Actual viewer and retained Learning identity

The Main Learning binding captures the original viewerActorKey before deriving
its composite actorKey for transport, draft and learner/attempt isolation. The
Preview compares only that captured viewer field with the current global viewer,
while retaining both keys in its selected-resource and held-read retirement fence.
It does not parse or replace the composite key, mutate Working identities or
infer authorization. The original server resource/checkpoint owners still check
fresh learner/attempt/pin/session access. The compiled Preview regression receives
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

The shared root provides the original companion refs and one actual Colleague
body handle. Online keeps its authenticated AuthGate viewer and original host;
standalone explicitly supplies its established local display scope and mounts the
same Colleague component. No local routed-navigation adapter is invented. The
selected Learning Autopilot publishes original layout/view facts after its same
Main snapshot is present; this does not grant project access. On release, only an
already-mounted original Working page reclaims its original layout.

Practice project lists actual loaded own-learner saved rows and delegates to the
same original session selector. It captures a person click before selection and
settles only a confirmed selection. Automatic Start/Resume callbacks supply no
gesture. Show chat and App choices forward their native event, while the original
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
failure. Preview-course ordinary Start remains disabled. These checks do
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
