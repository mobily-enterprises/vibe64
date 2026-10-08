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

Lessons presently use the original right-pane slot with a clear Lessons label.
A source-less Host's existing sourceWorkspaceAvailable projection hides Save,
Temporary AI/workspace and source-backed App children; true/default keeps the
original Working controls even while source operations are suspended. It does
not construct a second player or pretend that a source-less App is available.
The combined App/Lessons/Presentation Preview, Main teaching coordination,
installed host and browser/device acceptance remain open.

Focused evidence retains the original app-index assertion, project-opening
assertions and command/attention fixtures. Actual compiled setup/templates prove
L placement, exact Start intent and loaded-row selection; loading/error slot
cases prove retained object/draft identity and active projection. Native work,
real device geometry and teacher delivery are not proved by these fixtures.
