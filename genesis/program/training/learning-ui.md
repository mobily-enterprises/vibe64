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
- `src/components/learning/Vibe64LearningAttempts.vue`
- `src/components/learning/Vibe64LearningFinished.vue`
- `src/components/learning/Vibe64LearningStepBar.vue`
- `src/components/learning/Vibe64LearningRouteHold.vue`
- `src/lib/vibe64Learning.js`
- `src/components/learning/Vibe64LearningButton.vue`
- `src/components/StudioAppShellLayout.vue`
- `src/pages/app/index.vue`
- `src/pages/app/learning.vue`
- `src/pages/app/project/[slug].vue`
- `src/composables/useVibe64AppPage.js`
- `src/components/dashboard/Vibe64DashboardShell.vue`
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
- `packages/vibe64-training/src/server/learningSpace.js`
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
after a start settles unconfirmed; retrying passes that exact `startRetry` to
`startLesson` again, without rebasing the revision or admitting changed intent.
`startLesson` also passes `archiveCurrent`; a definite
`VIBE64_TRAINING_LESSON_IN_PROGRESS` refusal clears the retry. `resumeLesson`
targets the requested attempt. All use the original Training HTTP actions; a
confirmed result is opened by the shared controller (`learning.opened`: it
uses the mode read already in flight or rereads it, goes to the lesson's place
and shows the lesson). A start or resume given `onAdmitted` hands over as soon
as the server confirms it, before the progress reread: the controller's
`admitted` closes Courses (not as the learner's close) and opens the Lesson pane
once the mode read of the start's realtime change names the attempt; after the
hand-over only another person or revoked access makes the outcome not current. No session
or conversation is created or selected by the client. `courseProgress` marks the
lesson whose saved progress is `open` as `current`: the course page offers
**Start lesson** on every other offered lesson, and the picker allows a start
while another lesson is in progress (the server refuses it once and the
controller asks). `createCourse` posts the owner's custom-course name,
ordered topics and displayed catalogue revision to `courses.create`, then
rereads courses. `installCourse` posts `{courseId, release}` to
`course.install`, polling the catalogue for progress, then rereads courses and
catalogue. The picker shows **New course** only when `courses.list` reports
`canCreateCourses` and start buttons on a preview course only when it reports
`canTryPreviews`. While a start is in flight, the card or course page that
requested it shows **Starting lesson…** on that lesson's button and
`TrainingStartFeedback` (progress, or the host's `startError` on failure, or
the unconfirmed-start note) in place; the host shows a start failure only there.

The adapter serializes its UI operation only. Captured actor and L's open
generation fence follow-up requests; closing L or changing account does not undo
or resend admitted work. Retry identity is temporary UI state.

## Retired Learning mode

The earlier client Learning mode, its lesson Dashboard and learning-scoped client
transport are gone; Training navigation lives in Colleague as
`createColleagueNavigation`. Remaining compatibility: Colleague's
`navigation.open` refuses the retired `learningMode`/`learningView` inputs by
schema, and focus with a retired key is refused like any unknown field; an old
`?mode=learning` address renders the ordinary project page; and session realtime matchers ignore events that carry a
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

## Learn and Develop modes

`vibe64Learning.js` reads the learner's mode from `GET learning-mode`
(`{on, currentAttemptId, lessonCode, lessonTitle, practiceSlug}`, normalized by
`normalizeLearningMode`) once the overlay binds the viewer and again on every
`learner.changed` except `steps` and `notes`; an unreadable mode
counts as Develop. `learnMode`, `lessonTitle` and `mode` are its getters, and
the current attempt is shown (read) for the step bar and Colleague. `setMode` /
`toggleMode` post `{on}`; the L button calls `toggleMode`, which saves the
current route as the leaving mode's place and pushes the other mode's place
(`modePlace()`). Places live in this browser's localStorage under
`vibe64:mode-place:v1:<actor>:<develop|learn>`; a saved place the mode no
longer allows falls back to the mode's home (`learnHomePath(mode)`: the current
practice project, else `/app/learning`; Develop: `/app`).

`modeRedirect({mode, slug, path})` keeps each address in its mode: in Learn
another project goes to the practice project (or `/app/learning` with no
practice project) with `VIBE64_LEARNING_MODE_NOTE`, and `/app/learning` goes to
the practice project when there is one; in Develop the current practice project
and `/app/learning` go to `/app` (the project with
`VIBE64_DEVELOP_MODE_NOTE`). Other training projects are left to the server's
refusal. The overlay applies it on every route and mode change, showing the
note only when the learner opened the address. It waits while `state.modeBusy`
is set, so it never cancels `setMode`'s own move to the saved place. It sets body class
`vibe64-learn-mode` (the yellow app bar) in Learn. `Vibe64LearningRouteHold.vue`
wraps each host's routed pages (public `App.vue`, hosted AuthGate's prepared
content; locally also the AI onboarding host) and renders them only once the
mode is read and no redirect applies, so a redirected page never sends requests
the server would refuse. It also holds a project page while `state.modeBusy` is
`"set"`: L always leaves a project page, so the page goes at the press, before
the server switches. When it starts holding a page it cancels that project's
queries in flight (`["vibe64", ...vibe64ProjectQueryScope(slug)]`, which revert)
and removes any that hold the `VIBE64_LEARNING_MODE_PROJECT_CODE` refusal (a
switch made elsewhere can answer first), so a refresh issued during a switch
never shows "Session data could not refresh" when the project opens again.

Lesson actions: `startLesson(selection, start)` calls the Courses adapter's
start; on `VIBE64_TRAINING_LESSON_IN_PROGRESS` it sets `confirmArchive`
(`{next, current: {attemptId, lessonTitle}}`), shown by the overlay's archive
dialog; `confirmArchiveAndStart()` starts again with `archiveCurrent: true` and
`cancelArchive()` drops it. `restart()` and `finish()` post `lesson.restart` /
`lesson.finish` for the current attempt with the revision read from
`GET learning`; `deleteAttempt()` and `deleteArchived(attemptId)` post
`lesson.delete` / `archives.delete` with `{confirmed: true}`. `readPractice()`
reads `GET practice` into `practice` (`normalizePractice`: one `current` row
and `archived` rows by lesson, reason and date), reread on a non-notes
`learner.changed` once read. A loaded lesson opens at the saved reader place,
else, once any step has passed for this lesson content, the first required step
not passed, else the first step.

## Courses overlay surfaces

The L button switches mode; in Learn it is followed by a Courses button
(`openCourses`) and the lesson title. The overlay (`aria-label` Courses) has
surfaces `courses`, `progress`, `archived` and `lesson`, and a close button
(`closeCourses`, also Escape) that keeps its place. **In progress** and
**Archived** (`Vibe64LearningAttempts.vue`) show the one current row with Open
(`openCurrent`: the lesson's place, overlay closed), Restart and Delete (each
confirmed by a second click), and archived rows with Delete; a loader stands in
until the first `practice.list` read answers. The **Lesson finished**
screen (`Vibe64LearningFinished.vue`) finishes its attempt once, then offers
**Next lesson** (through `startLesson`) and **Back to courses**. The step bar
(`Vibe64LearningStepBar.vue`, on the project page) shows the current lesson's
step in Learn with Previous/Next, always in full (it has no collapse
toggle, and no Open button: the page's Lesson tab opens the lesson). `openLesson` also asks the page layout (`VIBE64_COLLEAGUE_LAYOUT_KEY`,
passed to the controller as `layout`) to show the project side, so on a phone
it reveals the Lesson pane even when the address already names it. The project picker (`ProjectSelectionGate`) never lists
practice projects and, for a mode refusal, shows the server's message with
**Switch to Develop/Learn**; a deleted practice project points to Courses →
Archived.

Local `/app` (`src/pages/app/index.vue`) has no Projects page: once the mode is
read it opens Learn's place in Learn, else the started project, found by
following the server's `/app` redirect with a `HEAD` fetch, with an error notice
and **Try again**. The page is not reloaded, so the overlay keeps its place. The
local server redirects `/` there too. `/app/learning` is the project page
(`project/[slug].vue`) with no slug, rendering `Vibe64NoProjectPane` (Online's
project shell renders the same pane and step bar): **No project selected** in the chat column
and both panes, Preview/Dashboard switching in place (`useVibe64AppPage`'s
empty pane, kept in the `pane` query), the Dashboard's section list without
routing (`Vibe64DashboardShell` `no-project`, selection kept in the `section`
query), no project read and no sessions. A host routes these addresses itself.
An ended lesson's step offers **Go to Courses**, where it can be started again.

## Local practice-project address

Standalone (local) Vibe64 serves only its selected project, plus one exception:
the current learner's own practice projects in the learning space
(`<managedSourceRoot>/.learning`). Training registers the local person with
core `registerPracticeRequestActor`, and core `resolveProjectRequestContext`
admits a `training-<hex>` slug through `admitPracticeProject`, which reads the
project's own training marker: only its learner is admitted, with ordinary
`write` access that `captureProjectRequestContext` retains for helpers and
agent turns. Archiving a lesson keeps the practice project and its sessions the
learner's.

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
still void a code attempt. A host with several learner stores installs the same
owner with its normal/author-preview store selector (`selectOwners`).

Evidence: `tests/server/vibe64LearningDashboardRoutes.unit.test.js` (no Dashboard
action declares lesson access; no lesson URLs), `vibe64TrainingCodePracticals`
(ledgered save through the owner) and `vibe64TrainingLearnerState` (ordinary
practice session after the lesson ends).
