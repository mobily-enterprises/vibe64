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

## Public contract

`createVibe64Learning({ request?, browserNavigation?, colleagueView?, runGuide? })`
returns one frozen controller. `Vibe64AssistantShellContext` provides it under
`VIBE64_LEARNING_KEY` in both hosts; public `App.vue` and Online's authenticated
`Vibe64AuthGate` mount `Vibe64LearningOverlay` once, and the **L** button
(`Vibe64LearningButton`, anchor `data-vibe64-guide="learning"`) sits first in
`StudioAppShellLayout` and the management `ShellLayout` headers. Stacking is
guide overlay 3000 above L 2400 above Colleague.

- State: `open`, `minimised`, `surface` (`courses` or `lesson`), `attemptId`,
  `stepId`, `scroll`, the read `lesson`, its `steps`, `results` and
  `passedStepIds` (passes kept from any attempt of the same lesson content),
  `stepStatus(stepId)` (passed when either shows a pass) and `focus` (`learningOpen`, `learningSurface`,
  `learningAttemptId`, `learningStepId`) which both hosts send as Colleague
  focus. `setViewer` binds the signed-in person; a change of person closes L, drops
  the previous person's lesson, notes and pending requests, and restores only
  the new person's own saved place.
- Place: `show({surface?, attemptId?, stepId?})`, `minimise(by?)` (state kept,
  app and Colleague visible), `toggle()` (L is the one open/hide control: open
  L shows, hiding is `minimise("learner")`; there is no separate close); the
  overlay covers the app bar, so its header L plate is the same toggle button,
  and Escape also calls `minimise("learner")`. `hiddenBy` is
  `"learner"` only when the learner's own L or Escape hid it (Colleague
  then returns a phone learner to its dialog), and `""` for Show me, Teach me,
  Open practice project and app navigation, `selectStep`, `setScroll`. The
  place is kept per tab in `sessionStorage` and saved for the account through
  `reader.save` (debounced, flushed on minimise), so a reload or another
  browser reopens the same step and scroll.
- Lesson: `loadLesson(attemptId)` reads `lesson.read`; every step action is
  followed by a fresh read. `answer(stepId, selected)` (`step.answer`),
  `done(stepId)` (`step.done`) and `runCheck(stepId)` (`step.check.run`) are the
  learner's own browser actions with a stable request ID; `endLesson` ends an
  earlier-format attempt. Statuses come only from these results.
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
  (`consumeColleagueRequest`). The pinned step card in Colleague reads this
  controller only.
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
when; a step already passed in any attempt of the lesson says so, as a passed
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
**Finish lesson** and **Practice**; when the row overflows,
`revealCurrentStep` scrolls only that row to keep the current step visible on
step changes and reopening. An earlier-format
(version 1) attempt is shown as readable history with **End this lesson**; a
version 2 lesson whose required steps all passed offers **Finish lesson**. Both
call `lesson.end` with reason `restart` (results kept), emit `ended` so the
overlay rereads saved learning, and Finish returns to Courses. A passed choice
question is not compared again (the server keeps the pass), so the reader says
so and disables **Check answer**. Links in lesson Markdown to another origin open
in a new tab (`openLessonLink`), keeping the app and L open.

Evidence: `tests/client/vibe64LearningEnvironment.vitest.js` and
`tests/client/vibe64LearningCourses.vitest.js`; the App press capture and its sent
identities in `tests/client/vibe64OutputControlsSurface.vitest.js`; live browser
acceptance is a separate gate.
