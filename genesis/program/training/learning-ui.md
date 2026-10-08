# Learning UI request coordination

One client adapter connects the root and project views to the original Training
reads and commands without creating a second session panel or progress owner.

## Sources

- `src/composables/useVibe64LearningMode.js`
- `packages/vibe64-training/src/server/registerRoutes.js`
- `packages/vibe64-training/src/server/actions.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-training/src/server/learningSessions.js`

## Public contract

`useVibe64LearningMode({onConversationOpened})` reads the original router's
`mode=learning` flag; absence means Working. `setLearningMode` preserves the
route's path, hash and other query fields. This flag is presentation, never
Training or session authority. The host attaches the existing L control, picker
and same original session panel; this adapter does not mount them.

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

This is an unattached UI prerequisite. Actual mode placement, installed host,
Main application-tool coordination, teaching and browser acceptance remain
separate gates. Focused adapter evidence uses the actual endpoint resource and
query observers with bounded command-placement fixtures; it does not prove the
real command placement or server/native/browser composition.
