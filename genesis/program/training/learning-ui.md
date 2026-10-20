# Learning UI request coordination

One client adapter connects the Learning environment (L) to the original
Training reads and commands without creating a second progress owner.

Lesson start and resume create no conversation: a practice lesson's initial
session is an ordinary project session with the ordinary Senior default, and the
Chat mode menu keeps its usual Senior, Junior and Custom choices. The L
controller itself is described in [Learning environment (L)](learning-environment.md).

## Sources

- `src/composables/useVibe64LearningCourses.js`
- `src/components/learning/Vibe64LearningCourses.vue`
- `src/components/learning/Vibe64LearningOverlay.vue`
- `src/components/learning/Vibe64LearningPractice.vue`
- `src/composables/useVibe64PracticeProjects.js`
- `src/lib/vibe64Learning.js`
- `src/components/learning/Vibe64LearningButton.vue`
- `src/components/StudioAppShellLayout.vue`
- `src/components/studio/Vibe64LocalAppIndex.vue`
- `src/components/studio/ProjectSelectionGate.vue`
- `src/components/Vibe64AssistantShellContext.vue`
- `src/components/Vibe64LocalColleagueHost.vue`
- Main: `packages/vibe64-training/src/client/TrainingLessonPicker.vue`
- `packages/vibe64-training/src/client/trainingGuide.js`
- `packages/vibe64-training/src/client/TrainingGuideOverlay.vue`
- `packages/vibe64-training/src/shared/guideTargets.js`
- `packages/vibe64-training/src/server/visualResourceActions.js`
- `packages/vibe64-training/src/server/visualResourceRoutes.js`
- `packages/vibe64-training/src/server/registerRoutes.js`
- `packages/vibe64-training/src/server/actions.js`
- `packages/vibe64-training/src/server/practiceProjects.js`
- `packages/vibe64-colleague/src/client/Vibe64Colleague.vue`
- `packages/vibe64-colleague/src/client/colleagueNavigation.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-core/src/server/featureRoutes.js`

## Public contract

`useVibe64LearningCourses({ authorPreview, active })` is the Courses adapter of
the L overlay; `active` is L's open state. `coursesResource` and
`learningResource` use the original endpoint resource, Vue Query cache and HTTP
cancellation, scoped by the injected actual viewer actor. A private reader
envelope masks old data synchronously on actor changes; signed-out and denied
readers expose no progress. Same-actor transient errors retain loaded state. The
API-only own `learnerId` (returned by the browser `learning.read`, removed from
Colleague's tool result) binds lesson requests and remains separate from the
shared viewer and Colleague identities. `available` (the official catalogue, read by the server from GitHub)
is read only while L is open.

`startLesson` accepts the picker's course/release/code/revision intent and
retains one generated request ID with those exact inputs after uncertainty.
`starting` marks the in-flight request; `startRetry` offers the exact retry only
after a start settles unconfirmed. `retryStart` does not rebase the revision or
admit changed intent. `resumeLesson` targets the requested attempt. Both use the
original Training HTTP actions; a confirmed result opens the lesson reader in L
(`Vibe64LearningCourses` emits `opened`). No session or conversation is created
or selected by the client. `createCourse` posts the owner's custom-course name,
ordered topics and displayed catalogue revision to `courses.create`, then
rereads courses. `installCourse` posts `{courseId, release}` to
`course.install`, polling the catalogue for progress, then rereads courses and
catalogue. The picker shows **New course** only when `courses.list` reports
`canCreateCourses` and **Try preview** only when it reports `canTryPreviews`.

The adapter serializes its UI operation only. Captured actor and L's open
generation fence follow-up requests; closing L or changing account does not undo
or resend admitted work. Retry identity is temporary UI state.

## Retired Learning mode

The earlier client Learning mode, its lesson Dashboard and learning-scoped client
transport are gone; Training navigation lives in Colleague as
`createColleagueNavigation`. Remaining compatibility: Colleague's
`navigation.open` refuses the retired `learningMode`/`learningView` inputs by
schema; incoming browser focus (focus updates, messages, navigation
acknowledgements and start-fresh evidence) still accepts the retired focus keys
from tabs loaded before this release and drops them before use, so an open tab
keeps working until it reloads; an old `?mode=learning` address renders the
ordinary project page; and session realtime matchers ignore events that carry a
`learningAttemptId`, because the server can still emit them without a project.

## Saved hosted author-trial reader

The host opts into one original owner-only `author-preview.read` HTTP adapter by
passing `authorPreview` to the L overlay (hosted: the workspace owner's AuthGate).
Normal standalone resources perform no extra preview read. The adapter masks its
saved trial on actor/role change and uses the same actor-envelope endpoint
resource. One card in the Courses surface displays that isolated active pin and
delegates Resume to the same saved-attempt preparation. It neither reserves on
read nor merges normal progress. Snapshot acquisition and explicit end/new-start
refresh remain the existing hosted Colleague actions. Published Start
eligibility and immutable pins are unchanged; no draft course is promoted.

## Practice section in L

L's Courses surface shows `Vibe64LearningPractice.vue` between the courses and
the teacher notes, in both hosts. It feeds `useVibe64PracticeProjects` with L's
own `learning.read` resource (`learningResource` option, no second read and no
project listing), so it works in single-project local mode, where
`GET /api/vibe64/projects` is not registered and the project picker cannot load.
Rows are attempts carrying `practiceSlug`, named by `practiceProjectName`
(src/lib/vibe64PracticeProjectName.js) from the lesson title that L's course
catalogue read (`coursesResource`, passed to useVibe64PracticeProjects) gives
for the lesson pin; the
section and the teacher notes use the full content width like the course
cards. Open minimises L and pushes the
practice project's address, and the trash button posts `practice.delete` once
(D-b, snackbar) and rereads. `learning.read` and `lesson.read` include
`practiceSlug` only while the host facility's read-only `exists({slug, actor})`
reports the project (standalone: the learner's own practice scope still holds a
record; Online: the archive service's `practiceProjectExists`). A project whose
deletion stopped part-way keeps its record and stays listed for the retry.
Leftover storage whose ownership no longer matches counts as present, and a
presence check that throws keeps that row listed instead of failing the read,
so one damaged or uninstalled old attempt never hides progress; delete then
reports the actual refusal.

## Local practice-project address

Standalone (local) Vibe64 serves only its selected project, plus one exception:
the current learner's own practice projects. Training registers
`registerLocalPracticeAdmission` (`practiceProjects.js`
`admitLocalPracticeProject`); core `resolveProjectRequestContext` derives the
attempt from the `training-<attempt>` slug, rechecks the saved attempt through
`readOwnPracticeScope` over `readExerciseProjectScope` (control, so an ended
attempt still qualifies; local deletion and the Files save owner use the same
own-project check) and
admits it with ordinary `write` access marked `ordinary`, which
`captureProjectRequestContext` retains for helpers and agent turns. Ending a
lesson leaves the practice project and its sessions the learner's.

## Teacher guide overlay

Colleague's `navigation.open` and `navigation.open-learning` guides use one
closed product list of real places (`guideTargets.js`): `preview`, `dashboard`,
`database-erd`, `database-data`, `files` (optional relative `filePath` without
`..`), `changes`, `git-log`, `session-info`, `architecture` and `learning`. The
older `workspace-preview` and `workspace-erd` names remain aliases. Each place is
a path of `data-vibe64-guide` ids on existing controls: the project page's
Preview/Dashboard tabs, the L button, the real Dashboard section items
(`guideId` in `vibe64SessionToolDefinitions.js`), the Database
Overview/ERD/Data toggle, and file-tree rows (`data-vibe64-guide-path`). Lessons
supply no selectors. An open place's pane also carries
`data-vibe64-guide-pane`: the Preview pane (and the no-session Preview pane),
each session tool pane by its `guideId` (`vibe64SessionToolGuideId`), and the
Dashboard section navigation (`SectionContainerShell` `navigationGuidePane`,
its menu or, at phone width, its section select) as `dashboard`. Standalone
tool panes (Files, Database, Architecture, Current changes) hide the Dashboard
shell, so each pane's `Vibe64DashboardBackButton` is also a `dashboard` pane
anchor. For each step
a visible control wins over its pane, so desktop still rings tabs; on a phone,
where tabs and the Dashboard menu are hidden, Show me rings the real open pane.
Only when no step is visible does the ring fall back to the last visible
header `pane-switch`. A pane that fills the screen gets its caption inside its
top edge (`inside` placement).

The default (`navigate=false`, `highlight=true`) only points. The Colleague
client (`Vibe64Colleague.vue`) and the Learning step reader (`vibe64Learning.js`)
run `runTrainingGuideCommand`, which rings the deepest visible step with a
caption such as "Dashboard → Database → ERD". `navigate=true` first runs the
ordinary browser navigator and, for `filePath`, opens the file in Dashboard →
Files. `TrainingGuideOverlay`, mounted once by the L overlay and teleported to
the body, draws a ring, pulse and caption with `pointer-events: none`, keeps the
ring still under `prefers-reduced-motion`, and clears after about 8 seconds, on
the learner's first pointer or key press, or when the control is hidden. A
ringed control or pane that the navigated view removes and renders again (a
phone opening another project's Preview replaces its pane just after the ring
lands) is looked up again for the same step, so the ring stays for its full
time; a control that is merely hidden means the learner's view changed. The
ACK carries `guide: { shown, reason?, step? }`; the coordinator rejects a
receipt that claims a drawn highlight without its step or an undrawn one without
a reason (`highlight-off`, `target-hidden`, `overlay-unavailable`).

## Full Dashboard in a practice lesson

A practice project is an ordinary project of its learner and the session
preparation creates in it is an ordinary project session (no `learning_session`
binding). The learner opens it like any project, so every Dashboard section,
Preview, the chat and AI Terminal are the ordinary project-scoped ones under
`/api/app/<slug>/vibe64/…`, with ordinary project authorization and realtime
routing. No server route registers an `/api/learning/<attempt>/…` path and no
action declares `learningAccess`.

Authorship: Training installs `createTrainingCodeSaveOwner`
(`codeEditorActions.js`) on the source editor with `setFileSaveOwner`. The
ordinary `vibe64.source-editor.file.save` then records the save in the learner's
authorship ledger (`codeAuthorship.js` `saveLearnerFile`) only when the request
project is the actor's own practice project with an active attempt; every other
save is the editor's plain save. Agent or other-route writes stay unledgered and
still void a code attempt. Hosted Online installs the same owner with its
normal/author-preview store selector (`selectOwners`).

Evidence: `tests/server/vibe64LearningDashboardRoutes.unit.test.js` (no Dashboard
action declares lesson access; no lesson URLs), `vibe64TrainingCodePracticals`
(ledgered save through the owner) and `vibe64TrainingLearnerState` (ordinary
practice session after the lesson ends).
