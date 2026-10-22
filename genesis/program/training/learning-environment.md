# Learning environment (L)

One client controller per host shell owns what the Learning environment shows
above every signed-in page, so Learning needs no project and never replaces the
page underneath. Admission, progress, checks and practice projects stay with the
Training actions.

## Sources

- Main: `src/lib/vibe64Learning.js`
- `src/components/Vibe64AssistantShellContext.vue`
- `src/components/learning/Vibe64LearningOverlay.vue`
- `src/components/learning/Vibe64LearningButton.vue`
- `src/components/learning/Vibe64LearningReader.vue`
- `src/components/learning/Vibe64LearningCourses.vue`
- `src/components/learning/Vibe64LearningTeacherNotes.vue`
- `src/components/learning/Vibe64LearningMarkdown.vue`
- `src/App.vue`
- `src/components/ShellLayout.vue`
- `src/components/StudioAppShellLayout.vue`
- `packages/vibe64-training/src/client/TrainingVisualPlayer.vue`
- `packages/vibe64-training/src/client/trainingGuide.js`
- `packages/vibe64-training/src/shared/learnerEvents.js`
- `src/composables/useVibe64OutputControlsSurface.js`
- `packages/vibe64-core/src/server/learningMode.js`
- `packages/vibe64-training/src/server/learningSpace.js`
- `packages/vibe64-training/src/server/stepActions.js`
- `packages/vibe64-training/src/server/preparation.js`
- `packages/vibe64-training/src/server/actions.js`

## Public contract

`createVibe64Learning({ request?, browserNavigation?, colleagueView?, runGuide? })`
returns one frozen controller. `Vibe64AssistantShellContext` provides it under
`VIBE64_LEARNING_KEY`; public `App.vue` (and a host's own authenticated shell)
mount `Vibe64LearningOverlay` once, and the **L** button
(`Vibe64LearningButton`, anchor `data-vibe64-guide="learning"`) sits first in
`StudioAppShellLayout` and the management `ShellLayout` headers. Stacking is
guide overlay 3000 above L 2400 above Colleague.

- Mode: `mode` (`{on, currentAttemptId, lessonCode, lessonTitle,
  practiceSlug}`), `learnMode`, `lessonTitle`, `readLearningMode()`,
  `setMode(on)` and `toggleMode()`. **L** toggles the mode; it opens no
  overlay. In Learn mode the overlay sets `body.vibe64-learn-mode`, which
  `vibe64-m3.css` uses to give every `.shell-layout__app-bar` (Studio and
  management shells) the `--v64-learning-app-bar` wash, and the L plate is
  solid with the current lesson's title beside it. Each side keeps its own
  place in `localStorage` (`vibe64:mode-place:v1:<actor>:<develop|learn>`, the
  full route): `toggleMode` saves the current route to this side, switches
  through `learning-mode.set`, then opens the other side's saved place (Learn
  defaults to the practice project or `/app/learning`, Develop to `/app`).
  `modeRedirect({mode, slug})` sends a Learn tab off a normal project and a
  Develop tab off a practice project.
- Courses overlay: `coursesOpen`, `openCourses()` and `closeCourses()` (the
  learner's own button and close), `show({surface, attemptId, stepId})` and
  `minimise()` (Colleague, Show me and app navigation), `surface`
  (`courses`, `progress`, `archived` or `lesson`), `attemptId`, `stepId`,
  `scroll`, the read `lesson`, its `steps`, `results`, `stepStatus(stepId)` and
  `focus` (`learningOpen` is the overlay being open, `learningSurface`,
  `learningAttemptId`, `learningStepId`), which both hosts send as Colleague
  focus. **Courses** sits beside L in Learn mode only. `setViewer` binds the
  signed-in person; a change of person closes the overlay, drops the previous
  person's lesson, notes and pending requests, and restores only the new
  person's own saved place. The reader place is kept per tab in
  `sessionStorage` and saved for the account through `reader.save`, so a
  reload or another browser reopens the same step and scroll.
- Lesson operations: `startLesson(pin)` (a 409
  `VIBE64_TRAINING_LESSON_IN_PROGRESS` sets `confirmArchive {current, next}`;
  `confirmArchiveAndStart()` repeats with `archiveCurrent: true`,
  `cancelArchive()` keeps the lesson in progress), `openCurrent()`,
  `restart()`, `finish()`, `deleteAttempt()`, `practice` (from
  `practice.list`, refreshed by `readPractice()`) and
  `deleteArchived(attemptId)`. The collapsible lesson step bar
  (`stepBarCollapsed`, `toggleStepBar()`, `stepBarVisible`) shows the current
  lesson at the top of its project.
- Beat player (`src/lib/vibe64LessonPlayer.js`, `learning.player`): plays the
  current step's `beats` in the step bar. A show beat rings its place
  point-only (`showTrainingGuide`, its own ring cleared on change) and advances
  after clamp(5 s + 50 ms per character, 5–12 s), held while paused
  (`beatPaused`), while the pointer or focus is in the bar (`hold`), while
  Courses is open, the bar is collapsed or the document hidden, and never
  advancing under reduced motion. Back/Next move by beat and cross steps
  (`selectStep(id, beat)`; Back enters a step at its end). A step ends on its
  check beat, else one past its last beat, where the bar shows its own verdict
  control; steps never advance by themselves. `beat` and `beatPaused` are this
  tab's place (`sessionStorage`); nothing of the player is saved on the server.
  `showMe` on a step with beats restarts them (`player.start`).
- Do beats: the player completes the current do beat when the page focus
  (`VIBE64_PAGE_FOCUS_KEY`, written by each host from its existing Colleague
  focus) shows its place (`trainingPlaceShown`), or when the page activity it
  names (`src/lib/vibe64PageActivity.js`, `VIBE64_PAGE_ACTIVITY_KEY`, names in
  `TRAINING_BEAT_EVENTS`) arrives for the practice project while that beat is
  current. Emitters: the session view's accepted send (`message-sent`), the
  agent turn ending (`agent-finished`), a successful Save (`saved`), Preview
  Reload (`preview-reloaded`), Files opening a file (`file-opened`), the
  practice App's orientation button (`app-pressed`), Colleague opening and
  closing (`colleague-opened`, `colleague-minimised`), the L switch
  (`learn-toggled`, place `learning`). It shows a confirmation for 1.5 s, then moves on. The
  detected do beats are this tab's only; when all of a `self` step's do beats
  were detected the controller records `done`.
- I'm stuck (`stuck(stepId)`): the bar offers it in the final state of an
  unpassed `auto` or `review` step; it records a Colleague request of kind
  `stuck` with the fixed `VIBE64_LEARNING_STUCK_MESSAGE` ("I'm stuck on this
  step."), sent by `watchColleagueLearningRequests` like Teach me.
- Do it for me (`doItForMe`, `doItForMeKind`): navigates through the same
  guide command as Show me, reveals the chat (`layout.showChat`), opens
  Courses, the Lesson pane or Colleague (a Colleague request of kind `open`,
  which reveals and sends nothing), presses the Preview's Reload, or sends the
  quoted prompt through the session view handle's `sendLessonMessage` (the
  ordinary Main chat send with `messageSource:"lesson"`, stored as turn
  metadata `source:"lesson"` and shown as **Sent by the lesson**). Save is
  pointed at only.
- ≡ Step (`stepTextOpen`, `setStepText(open)`, this tab's place): the step bar
  drops the current step open under itself, rendering the reader's own
  `Vibe64LearningStep.vue` (max 60 % of the viewport, scrolling; ≡ or Escape
  closes it; hidden while the bar is collapsed). `showMe` closes it. A choice
  step's final beat state offers **Answer in Step**, which opens it.
- Learn mode (server): Vibe64 has two modes, Develop and Learn, with the same
  screens. Learn mode is a saved per-learner flag
  (`<sys>/training/users/<key>/learning-mode.json`, `{on}`), separate from any
  lesson; absent means Develop. The current lesson is the one in progress (the
  learner's active attempt), so it is derived, not stored.
  `learning-mode.read` and `learningMode` in `learning.read` expose
  `{on, currentAttemptId, lessonCode, lessonTitle, practiceSlug}`;
  `learning-mode.set {on}` (`POST /api/vibe64/training/learning-mode`, the L
  toggle) switches it and emits `learner.changed` with reason `learning-mode`
  only when it changed. Switching never ends, archives or changes an attempt.
  `lesson.start` and `lesson.restart` turn Learn mode on. Core
  `learningMode.js` holds one host-registered reader (a failed read counts as
  Develop) and the Learn/Develop project rule.
- Attempt lifecycle (server, `preparation.js` and
  `packages/vibe64-training/src/server/learningSpace.js`): an attempt is one
  run of a lesson and the parent of its step results, its practice project
  (`training-<attemptId hex>`, only when the lesson has an exercise; the
  marker's `practiceId` is the attemptId) and its teacher conversation
  (Colleague's Learn thread for that attempt). At most one attempt is in
  progress. `lesson.start` with a different lesson in progress refuses 409
  `VIBE64_TRAINING_LESSON_IN_PROGRESS` with `details {attemptId, lessonTitle}`
  (the client's one confirmation); repeating it with `archiveCurrent: true`
  checks the admitted revision, archives the current attempt, then reserves
  the new one. The same lesson in progress, or a replayed start request, goes
  straight to the learner store. `lesson.restart {attemptId, requestId,
  expectedRevision}` archives the attempt and reserves a new attempt with the
  same pin and request (a retry finishes a stopped restart through the
  replayed reservation); preparation then creates a fresh project and session
  `training-<attemptId>` with exercise-source proof. `lesson.finish {attemptId,
  expectedRevision}` is refused
  (`VIBE64_TRAINING_LESSON_INCOMPLETE`) until every required step passed, then
  archives with reason `finished` (the learner store records the completion).
  `lesson.delete {attemptId, confirmed?}` removes the project and conversation
  with no archive (reason `deleted`).
- Close (`learningSpace.closeAttempt({actor, attemptId, archive, reason})`) is
  the one implementation behind finish, restart, start-with-archive and delete.
  An archive at the cap of 20 per learner refuses first. Then, holding the
  learner's preparation barrier until the attempt has ended (so no preparation
  recreates the project meanwhile) and inside the learner's practice scope,
  the shared project archive service (a host's
  `trainingHost.projectArchive`, a standalone `createProjectArchiveService`
  locally) archives or removes the project; for an archive its `beforeRemove`
  step, under the per-slug lock after every refusal (pinned session, storage
  headroom), writes `attempt.json` from `learners.readAttemptRecord`, so a
  refusal changes nothing. A lesson without a project writes `attempt.json`
  directly. A delete then removes any partial bundle. Next the learner store
  ends the attempt (request `close-<attemptId>`), which also forgets its code
  ledger. Last, with the attempt ended so Colleague no longer resolves its
  thread, core `releaseLearnThread` lets Colleague release it, and the thread
  file (`learnThreadFile`) moves into the bundle as `conversation.json`
  (archive) or is removed (delete). A close that stops before the end leaves
  the attempt in progress (its project `deleting`); repeating it resumes, and
  a close of an ended attempt only finishes the thread step (restart and
  finish retries do this too). Bundles:
  `<systemRoot>/training/practice-archives/<learnerKey>/<attemptId>/` with
  `attempt.json` (`{schemaVersion: 1, attemptId, learnerKey, pin, lessonTitle,
  reason: finished|archived, createdAt, archivedAt, stepProgress}`),
  `conversation.json` and `project/<slug>/<UTC>-<slug>/`. `practice.list`
  returns `current` (`{attemptId, lesson {code, title}, slug?, status
  in-progress|deleting}` or null; author-preview attempts are left out) and
  `archived` (`[{attemptId, lesson, reason, archivedAt, hasProject}]`, newest
  first; a folder without a valid `attempt.json`, or the attempt still in
  progress, is left out). `practice.archived.delete {attemptId, confirmed?}`
  removes one bundle. Deletions are one click for the learner and need the
  person's confirmation (`confirmed: true`) from Colleague. Routes:
  `POST …/attempts/:attemptId/{restart,finish,delete}`, `GET …/practice` and
  `POST …/archives/:attemptId/delete`. `learner.changed` carries
  `{learnerId, attemptId?, reason}` with reason `learning-mode`, `lesson`,
  `steps`, `practice` or `notes`.
- Lesson: `loadLesson(attemptId)` reads `lesson.read`; every step action is
  followed by a fresh read. `answer(stepId, selected)` (`step.answer`),
  `done(stepId)` (`step.done`) and `runCheck(stepId)` (`step.check.run`) are the
  learner's own browser actions with a stable request ID. Statuses come only
  from these results.
- App press (`step.observe`): `exerciseStep(projectSlug)` names L's current
  step only for its prepared, not-ended version 2 attempt whose practice
  project is `projectSlug`, while L is not open over the app, when that step's
  automatic check is a response check (an `auto` check without files).
  `beginExercise` and `exerciseCurrent` fence the viewer, attempt, step and
  project of one press (at most 8 in flight); `finishExercise` posts the
  learner-origin receipt with the App instance, interaction and request
  identities and the Preview session, then rereads the lesson.
  `prepareExercise` reads a remembered but unread attempt when a practice App
  announces itself. The Preview output surface
  (`src/composables/useVibe64OutputControlsSurface.js`) is the only caller.
- `showMe(stepId)` minimises L and runs the step's guide through the browser
  navigator and `runTrainingGuideCommand`; a `files` guide waits for the
  navigated project view and opens the file in Dashboard → Files. A place that
  cannot be shown reopens L with the reason.
- `teachMe(stepId)` minimises L and records one `colleagueRequest` carrying the
  fixed text "Teach me this step."; Colleague consumes it once
  (`consumeColleagueRequest`). Colleague's **Step N/M** header button and its
  current-step dialog read and act through this controller only. The button
  is in the desktop drawer header or, on a phone, the eager phone dialog's
  header, never both.
- `complete` is true when every required step of a version 2 lesson passed.
  A learner's own Done, answer, Check now or Preview press result that makes
  the lesson complete (`finishedBy`) calls `showFinished()`, which shows L's
  lesson surface with `finished` set; `closeFinished()` returns to the steps.
- Notes: `readNotes`, `saveNotes(text)` (1 to 4000 characters, refused when the
  notes changed since they were read) and `clearNotes` call the learner-notes
  routes for the signed-in person only.
- `learnerChanged(payload)` handles the realtime
  `vibe64.training.learner.changed` event delivered only to that learner:
  a notes change rereads shown notes, an attempt change rereads the displayed
  lesson.

The reader shows each step's Markdown body, an optional diagram whose **Play**
restarts the diagram without a snapshot (its declared initial state and the
controller's own labels) and runs its declared commands in order through
`TrainingVisualPlayer` (the diagram and the scroll place watch the attempt and
step IDs as separate sources, so a realtime lesson reread does not remount a
playing diagram or move the scroll), a choice question (**Check answer**; a passed question shows the options of its
latest passing result's `evidence.selected`, so another browser shows them too),
**Done** for a self-check (no instruction line of its own: the step text says
when; a step this attempt already passed says so, as a passed
question does), **Check now** for an automatic check (a code step, one declaring
`check.files`, says saving does not check it; a not-passed result's reason, or
the server's `alreadyPassed` answer for a step already passed, is shown under
**Check now** or **Check answer** until the step changes; it never changes the
status),
**Show me** (a Database place carries the practice project's selected
`sessionId`, which both hosts require for a Database view; from another page it
opens the practice project first), **Teach me**,
lesson notes, previous/next and **Open practice project**. On a phone L is a
full-screen sheet whose **Courses** tab never shrinks, with a row of numbered
step circles and, for a complete lesson, one short row of **✓ Lesson complete**,
**Lesson finished** and **Practice**; when the row overflows,
`revealCurrentStep` scrolls only that row to keep the current step visible on
step changes and reopening. A
version 2 lesson whose required steps all passed offers **Lesson finished**,
which reopens `Vibe64LearningFinished`. That screen finishes the attempt with
`lesson.finish` (retried while unconfirmed) and offers **Next lesson** and
**Back to courses**. The step body is `Vibe64LearningStep`, shared
with Colleague's current-step dialog. A passed choice
question is not compared again (the server keeps the pass), so the reader says
so and disables **Check answer**. Links in lesson Markdown to another origin open
in a new tab (`openLessonLink`), keeping the app and L open.

Evidence: `tests/server/vibe64TrainingLearningSpace.unit.test.js`,
`tests/server/vibe64TrainingLearningMode.unit.test.js`,
`tests/server/vibe64TrainingPreparation.unit.test.js`,
`tests/server/vibe64TrainingStepActions.unit.test.js`,
`tests/client/vibe64LearningEnvironment.vitest.js` and
`tests/client/vibe64LearningCourses.vitest.js`; the App press capture and its sent
identities in `tests/client/vibe64OutputControlsSurface.vitest.js`; live browser
acceptance is a separate gate.
