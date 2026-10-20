# Project catalog

People can create, select, and reopen the projects available to their Vibe64
workspace.

## Sources

- Main: `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/settingsAssistantContracts.js`
- `tests/server/vibe64SettingsActionTools.unit.test.js`
- `packages/vibe64-project/src/server/onboardingAssistantContracts.js`
- `packages/vibe64-project/src/shared/onboardingRequest.js`
- `tests/server/vibe64OnboardingActionTools.unit.test.js`
- `tests/server/vibe64ProjectActionDispatch.unit.test.js`
- `packages/vibe64-project/src/server/managedProject.js`
- `packages/vibe64-project/src/server/managedRepository.js`
- `packages/vibe64-training/src/server/preparation.js`
- `packages/vibe64-training/src/server/Vibe64TrainingProvider.js`
- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `tests/server/vibe64ManagedProject.unit.test.js`
- `tests/server/vibe64TrainingPreparation.unit.test.js`
- `tests/server/vibe64WorkspaceSetup.unit.test.js`
- `tests/server/vibe64TerminalSessionWorkAdmission.unit.test.js`
- `packages/vibe64-genesis/src/server/index.js`
- `src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue`
- `docs/colleague-usage/starter-apps.md`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `packages/vibe64-core/src/server/studioProjectContext.js`
- `packages/vibe64-core/src/server/projectState.js`
- `packages/vibe64-core/src/server/projectRequestContext.js`
- `packages/vibe64-core/src/server/actionContext.js`
- `tests/server/vibe64ActionContext.unit.test.js`
- `packages/vibe64-training/src/server/learnerState.js`
- `tests/server/studioProjectContext.unit.test.js`
- `tests/server/vibe64TrainingLearnerState.unit.test.js`
- `tests/server/assistantRoutingStateInventory.unit.test.js`
- `src/composables/useVibe64ProjectsResource.js`
- `src/composables/useProjectSelectionGate.js`
- `src/composables/useVibe64AppPage.js`
- `src/components/StudioAppShellLayout.vue`
- `src/pages/app/project/[slug].vue`
- `tests/server/mobilePaneSwipe.unit.test.js`
- `src/components/studio/ProjectSelectionGate.vue`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-core/src/server/projectRuntimeOpenState.js`

## Public contract

Official JSKIT starter choices are Basic app, Database app and Accounts app.
They include server/client/browser tests and a declared browser-tests target;
Database adds MySQL migrations without login, while Accounts adds authentication
and account-persistence tests. Import and Workspace setup remain separate.
The task guide is `docs/colleague-usage/starter-apps.md`.

A practice project is an ordinary project of its learner, and its sessions are
ordinary sessions, but it lives in the learner's learning space rather than the
catalogue (see **Practice projects** below).

Practice admission uses the same Project context, record creation, rollback and
request-context storage as any project. Core `runWithPracticeProjectScope` is
the one scope on both hosts: it derives the namespace from the learning space
root, learner key and practice ID, and requires the immutable training marker
and managed Git policy. Runtime roots remain in the original
`system/projects/<slug>` tree so upgrade inventory, canonical repository,
restart recovery, resource policies and cleanup ownership remain intact.
Existing unmarked, mismatched or aliased storage is refused without repair.
The private grant survives exact nested Project resolution but expires with its
owning callback; it cannot come from HTTP fields. Ordinary local catalogue and
route refusals remain unchanged.

The original managed repository creation and exact exercise source verification
operations now live beside the original Public managed initializer. Online calls
that same owner, retaining its hosted slug prevalidation and one configuration
facility for its existing development database defaults. Standalone composition
supplies no hosted database policy. The original initial commit, source exclusion,
identity checks and atomic rollback remain with their original owners. Private
creation obtains its exact root through Core rather than a catalogue-path guess.

The same preparation coordinator enters this Core scope around its original
exercise effect block, inside the already-held non-reentrant learner barrier.
It preserves the server-reserved project/session identities and pinned source
commit. Missing preparation facilities retain the original early refusal, and
pending Workspace setup remains pending rather than lesson or Preview readiness.
No old pin, progress or project record is migrated.

Core captures an admitted practice context as exact same-owner observation/control
only. The original delayed Workspace execution/completion observers and Codex
context captures retain that projection after the request callback returns.
Original record/marker/path checks still apply to reads, including later aliases.
Fresh session/repository creation, user sends, temporary sends, terminal starts/
writes and goal set/resume require a new create/write admission. The original
naming, review, native goal continuations, Stop and reconciliation owners retain
their admitted control flow; neutral source locks are not new-effect admissions.
Ordinary project context capture and admission are unchanged.

Working-project actions retain only their original request metadata under a
private Core symbol through the existing in-memory context capture. Delayed
setup can use that request to dispatch a freshly authorized receiving action;
the previous action's authority is never retained with it. Each action replaces
or clears the metadata, and Learning/practice contexts exclude it. The symbol
is omitted from JSON and is not a saved permission or credential store.

Focused component evidence covers private canonical creation/source cloning,
held-barrier preparation, accepted delayed Workspace completion and denied fresh
user effects. Practice projects and their sessions are ordinary since Learning
v2; all-provider native lifetime acceptance is still required. Source renewal remains unsupported for this practice increment;
its existing ordinary policy is unchanged. This is not installed/browser proof.

Core’s exact project-slug validator and read-only runtime-root inventory live in
`projectState.js`. The live Project context retains its original exports and
callers. Offline Training state upgrades use the same implementations without
loading live Project execution or Genesis dependencies.

All thirty-six project HTTP operations dispatch named `vibe64.project.*` actions.
The canonical inputs enforce required fields and exclude caller-supplied actors;
HTTP and direct callers resolve fresh identity and project access before entering
the existing project service. GitHub credentials, repository/PR review checks,
source mutation locks and resource admission remain with their existing owners.
Secret reveal keeps its uncached HTTP response around the same owner-only action.
Project refresh events identify the affected result project, including creation
or selection from a different requesting project. Action registration alone does
not expose these operations to Colleague; bounded assistant contracts are separate.

Colleague can read the current Project settings and change the requested GitHub
pull-request requirement or managed development database scope through the same
canonical actions. The workflow setting remains owner-only and GitHub-specific.
Database scope retains the existing installation and open-session guards; a
refusal never authorizes archiving a session to make the change possible. Its
bounded result reports the saved policy or the actual blocker, without credentials.
Changing policy does not migrate application data or change unsaved session source.

The compact project shell shares its existing chat/project pane state with
touch navigation. A deliberate single-finger horizontal swipe left reveals the
currently selected Preview or Dashboard; right reveals chat, without route
changes or remounting either side. The shared header accepts swipes above the
embedded preview; suitable chat/dashboard content does too. Form controls,
editors, terminals, horizontal scrollers, selected text, multi-touch, long holds,
vertical gestures and browser screen-edge gestures remain outside this action.
The embedded application's own gestures stay inside its iframe. Header taps and
the existing pane-switch buttons retain their ordinary actions.

The catalog lists stable project identities, creates projects, and selects one
project as the current context. The default creation path produces one real Git
commit containing a technology-neutral, current-format Genesis foundation; a
trusted technology template is materialized only when a caller selects it
explicitly. Selection changes the active project without rewriting its
application source. A hosted project namespace may contain repository mirrors
and session state without itself being a Git worktree; only an explicit checkout
is treated as inspectable source.

The Preview pane uses Genesis's read-only inspection of the current session:
empty/bootstrap source offers explicit starter choices or conversation; existing
source without a completed Genesis description asks what the project does;
current described projects show their outputs; outdated or incomplete Genesis
configuration shows the specific repair needed. Missing Genesis files never
authorize overwriting an existing application.
Both existing-project setup requests ask the coding agent to initiate Preview
identity setup when the application has authenticated web pages. Account and role
choices come from the person before configuration, with prior answers reused;
the request neither supplies credentials nor authorizes creating users or changing
roles. Public/non-web projects skip this, and a deferred choice stays pending.
Opening inspections and their refresh subscriptions run only for the visible
Preview in an active session. Hiding Preview keeps already-rendered outputs
mounted and running; returning refreshes inspection through the same resource.
An admitted starter operation may finish while hidden or after leaving the
project, but it does not request another inspection from the hidden or disposed
view. Returning to Preview performs its normal fresh inspection.
Finishing a temporary coding conversation refreshes visible setup for that exact
project and session, including work delegated by Colleague. Once setup is ready,
the same pane reveals its outputs without a page reload. Streaming messages and
other sessions do not cause setup inspections.

Starter catalogues are owned by Genesis and map a namespace-qualified choice to
one technology repository and branch. Applying a choice uses the ordinary
session and project source-write locks, preserves Git history and existing
bootstrap preferences, and leaves the added source for the normal Save flow.
Selection waits up to ten seconds for brief source-lock contention, then
rechecks the active session and assistant work before importing.
The browser sends only the selected catalogue ID. Neither session startup nor
inspection runs application verification or workspace preparation.
All onboarding conversation actions use the session's existing Temporary AI
workspace, opening a new task with the current diagnostics or entered purpose.
Colleague reads the same `vibe64.project.onboarding.read` action for setup state,
bounded diagnostics, compact available request kinds and configured starter
identities. An ordinary explanatory read omits the potentially large delegated
request body. After direct authorization, `includeSetupRequests` returns the
exact same request as the UI; the action also accepts a purpose for preparing an
adopt/create request. Reading never starts an agent. Colleague delegates an agreed request through the existing Junior
temporary-conversation actions, then rereads setup after completion. Starter
selection uses the same `vibe64.project.templates.apply` action and source locks.
The tool pages starters ten at a time and excludes repository locations and
environment values. Application readiness still requires inspecting its outputs;
a successful setup request is not a launch or Save.
Main-assistant activity does not disable help, including failed inspections and
newer-format warnings. Direct assistant access, an active unarchived session,
and duplicate-click protection still apply. Starter import retains its separate
source-work busy guard. Help leaves the main draft and History untouched; the
person can recheck setup after the task finishes.
Starter command failures use the shared action feedback and leave the choice
available for retry. Import success is returned independently of the subsequent
read-only setup check, so a later inspection failure cannot report copied
source as a failed import. Pending UI state includes that separate refresh while
Preview remains visible; an inspection failure uses the existing setup warning
and recheck action.

The hosted project namespace is the catalog authority. When that namespace has
been removed outside Vibe64, the next catalog read removes its stale private
project state so the deleted project cannot remain or block recreation. If it
was selected, that read retires the selection as well; an explicit external
source folder remains independent of the hosted catalog. Cleanup rechecks the
exact namespace before deleting suspected orphan state, and a listing cannot
retire a different target selected while it was reading.

Durable project mutations publish one shared project refresh event. Consumers
use it only to invalidate their project list, selection, settings, repository,
access reads, or session creation eligibility; the HTTP resources remain authoritative.
The routed shell and selection gate share the query for that route's scoped
project response. The gate owns its refresh-event subscription and invalidates
that shared query once, even while both readers are mounted. Its cache identity
remains separate from the global catalog, whose selected project may differ
from the current browser route.
Opening a project URL confirms that its runtime has reopened before mounting
session, assistant and preview controls, including with cached project data.
Selecting the current project retries that opening without a browser reload.
Duplicate navigation retries opening only when the current opening has failed;
clicking an already-active dashboard tab leaves the project and chat mounted.
Failed opening offers an inline retry; late
responses from another project cannot unlock the current project's controls.
Project-data and opening failures share one inline Try again action. It awaits
any host-supplied access recheck, reloads the selection, then requests another
runtime opening. Repeated failures retain the action, concurrent clicks share
the pending attempt, and clearing an error restores ready state even when the
refreshed data is unchanged. An already-open session remains mounted while its
selection refresh reports an error.
Runtime lifecycle publication uses that same project-event owner. Deletion
publishes only a catalog refresh hint, so clients can remove a deleted project
without exposing its former identity to a broader audience.
Opening a runtime publishes only its closed-to-open transition. Repeated tab
opens still refresh the persisted runtime timestamp for dormancy, but do not
invalidate every open tab's project resources. The terminal service serializes
opens per runtime root so simultaneous visits observe one transition.

## Practice projects

Practice projects live only in the learning space, apart from normal projects,
by the same mechanism on both hosts. Core `learningSpace.js` owns the space: the
`training-<32 hex>` slug and its practice ID (a UUID; the attempt that first
creates the project supplies it), the immutable marker `training`
`{schemaVersion: 2, learnerKey, practiceId, pin, exercise}` (only schema 2 is
accepted), the layout and `PRACTICE_PROJECT_DELETED_CODE`.

| | Path |
|---|---|
| Learning space root | `createStudioProjectContext({learningSpace: {root}})`; standalone default `<managedSourceRoot>/.learning`, Online `<projectsRoot>/.learning` |
| Project namespace and session source root | `<root>/<learnerKey>/<practiceId>/<slug>` |
| Runtime root | `<systemRoot>/projects/<slug>` (the shared runtime inventory) |

The space sits inside the managed source tree, so agents, Preview and Files
reach it through the managed-source permission contract (group, default ACL and
umask); practice directories get no explicit mode, except the runtime root
under the daemon-private system root. `.learning` is not a valid slug, so the
catalogue never lists it. `listWorkspaceProjects` never shows a practice
project, and its orphan-runtime sweep leaves every `training-<hex>` runtime
whose record has a training marker (a warning when its learning-space project
is missing). `createWorkspaceProjectRecord` and `assertWorkspaceProjectAvailable`
refuse a new catalogue project with a `training-<hex>` name
(`vibe64_project_slug_reserved`); a pre-existing one still opens.
`listLearningSpaceProjects({learnerKey?})` returns
`{slug, learnerKey, practiceId, training}` for each valid project and skips an
unsafe or invalid entry with a warning; `readLearningSpaceProject(slug)` reads
one.

`resolveProjectRequestContext` admits every `training-<hex>` slug through core
`admitPracticeProject` before the explicit, local or catalogue branch. A person
(an actor, or a request that carries headers) opens only their own practice
project; anything else, including another learner's and the workspace owner's
request, is `vibe64_practice_project_deleted` (404). Work without a person
(agent turns after the browser closes, maintenance, archive) is admitted as the
marker's learner. Admission reads the marker, not an attempt. A local host
supplies the person of its local transport through `registerPracticeRequestActor`.
When the learning space has no such project, only a pre-existing project of that
name (the explicit local project or `<projectsRoot>/<slug>`) opens. Learning
mode (`learningMode.js`) allows only the active lesson's `practiceSlug`.

People see a practice project by its lesson, never its `training-<practice ID>`
slug, which stays the address. The client `vibe64PracticeProjectName.js`
(`projectDisplayName`, `practiceProjectName`) is the one naming rule for both
hosts: **Practice:** plus the lesson title where the client knows it (the open
lesson's own practice project in `useVibe64AppPage`'s `projectTitle`; each
`practice.list` row's lesson in `useVibe64PracticeProjects`), else that row's
lesson code, else "Practice project" for a bare practice slug; no catalogue
marker is read. Headers, the project
switcher, both Practice lists and Online Management use it; Colleague's
protocol names practice projects the same way. On phones (≤600px) the project
page heading takes only the room the header actions leave: the pane controls
and the session controls teleported into the title area (new session, local Git
branch, GitHub actor) keep their size and are never clipped; only the selector's
own `.studio-home-shell-project-name` wrapper is clipped and is the `@container`
that hides the selector below 4rem rather than show a sliver. The GitHub actor
shows its icon (account kept in its title and accessible name), the session
controls leave the bar while the project pane is shown, and at ≤480px the
next-pane button becomes a pane icon that keeps its "Go to …" name.
`vibe64.project.projects.create` is `ownerRequired`: members get practice
projects only through lessons.

Archiving and deleting a practice project belong to Training's learning-space
owner, which uses the shared project archive service inside the learner's
practice scope.

A page left open on a deleted practice project is a clean not-found on both
hosts: core `practiceProjectDeletedError` (`vibe64_practice_project_deleted`,
404, "This practice project was deleted. Its lesson is still in Learning.") is
thrown by the page admission (`resolveProjectRequestContext` passes
`requireProject` to `runWithPracticeProjectScope`) for a practice project whose
record is missing or carries the deletion marker (an exact delete request with
`allowDeleting` still resumes), checked before the ownership refusal so storage
recreated by a late request is not a 500. Other practice scopes keep refusing
unmarked leftover storage. Feature routes and the Online gate map the code to 404
with a top-level `code`; `useProjectSelectionGate` exposes `practiceDeleted` for
the routed project page. That page re-reads its selection without a reload on
the project-changed event (the hosted delete publishes the catalogue change), on
Learning's own `vibe64.training.learner.changed` notice with reason `practice`
(Learning's archive or delete on both hosts; other reasons are ignored), and whenever any
other query of the page fails with the deleted code (a query-cache subscription
in the gate). `ProjectSelectionGate` then shows **This practice project
was deleted** with **Open Learning** (L on its course list) instead of the error.
The delete's own `runtime-closed` event (reason `project-delete`) does not send
an open practice page to the hosted Projects page (`useVibe64AppPage`), which a
local installation does not have; ordinary projects still leave on it.
Evidence: `tests/server/studioProjectContext.unit.test.js`,
`tests/server/vibe64FeatureRoutes.unit.test.js` and
`tests/client/vibe64PracticeProjectDeleted.vitest.js`.

Project metadata optionally stores `allowSharedDatabaseSessions`, defaulting to
false without rewriting old records. The existing locked database settings action
may change this override with open sessions while retaining the scope-change guard.
The shared session-admission policy uses the normal three-session limit when it
is enabled; disabling preserves sessions and blocks additional creation under
project scope. Settings shows the checkbox and shared-data warning only for
project scope. Colleague uses the same action and reports the saved override.
