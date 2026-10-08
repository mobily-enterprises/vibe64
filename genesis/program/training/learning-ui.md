# Learning UI request coordination

One client adapter connects the root and project views to the original Training
reads and commands without creating a second session panel or progress owner.

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
- `packages/vibe64-training/src/client/useTrainingPresentationCue.js`
- `packages/vibe64-colleague/src/client/Vibe64Colleague.vue`
- `packages/vibe64-voice/src/server/Vibe64VoiceProvider.js`
- `packages/vibe64-voice/src/client/projectVoiceBinding.js`
- `src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue`
- `packages/vibe64-training/src/server/registerRoutes.js`
- `packages/vibe64-training/src/server/actions.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-training/src/server/learningSessions.js`

## Public contract

`useVibe64LearningMode({onConversationOpened})` reads the original router's
`mode=learning` flag; absence means Working. `setLearningMode` preserves the
route's path, hash and other query fields. This flag is presentation, never
Training or session authority. The root app and project page attach the existing L control and original picker
to the same session panel. The adapter itself owns no mounting or session state.

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
owners, hides Save and Temporary/workspace tools, and shows truthful unavailable
presentation. True/default keeps original Working controls, including suspended
Working behavior. The original empty Learning pane uses the same host without a
fake project, player or teaching message. Main teaching/current-question/cue
connection and source-less visual authority remain unimplemented; this frontend
composition does not complete LM10's installed/browser/device acceptance.

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

This move retains Colleague compatibility while Main's canonical delivered
question/cue and receipt transport remain absent. No selected attempt, saved
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
