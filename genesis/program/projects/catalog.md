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

Learning v2: a practice project is an ordinary project of its learner and its
sessions are ordinary sessions; the learning-bound practice context described
below is retired (see the Training Program).

Standalone lesson practice admission uses the same Project context, record
creation, rollback and request-context storage. Training reads the actual actor's
saved attempt and verifies its installed pin and bundled exercise before entering
the bounded `resolvePracticeContext` callback. Fresh creation and writing require
the exact current active attempt under the original preparation barrier; ended
history may be observed without admitting new work. A supplied session must be
the saved initial session and is read through the original Project runtime/store.

Core derives the private namespace from installation roots, learner key and
attempt, and requires the original immutable project training marker and managed
Git policy. Runtime roots remain in the original `system/projects/<slug>` tree so
upgrade inventory, canonical repository and cleanup ownership remain intact.
Existing unmarked, mismatched or aliased storage is refused without repair.
Original catalogue orphan cleanup retains a runtime only when its normalized
managed Git training marker, exact reserved slug and real private namespace match.
This protects practice history if the same installation is opened with catalogue
enabled, without listing the practice project or granting catalogue access.
The private grant survives exact nested Project resolution but expires with its
owning callback; it cannot come from HTTP fields or inherit source-less Learning
authority. Ordinary local catalogue and route refusals remain unchanged.

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

A practice project is an ordinary project whose immutable record carries the
saved Learning `training` marker. Core `practiceProjects.js` derives the public
`practice: {learnerKey, attemptId}` field from it and adds `mine` only for a
known viewer; it never reads or changes saved progress. The workspace listing
stays unfiltered for internal callers; a listing for a viewer omits other learners' practice
projects (`practiceProjectsForViewer`), and the presentation splits Practice from
ordinary projects. `practiceProjectAccessBlock` refuses a non-owner whose learner
key differs with `vibe64_practice_project_private` ("This practice project
belongs to another learner."); the workspace owner keeps access for support.
`vibe64.project.projects.create` is `ownerRequired`: members get practice
projects only through lessons.

Deletion is Training's `practice.delete`, through the host facility
`practiceProjects.remove({slug, actor})`. The standalone implementation
(`createLocalPracticeProjects`) runs the archive service's lifecycle without the
archive steps under a per-slug lock: deletion marker, runtime close, resource,
source and runtime removal, then `forgetProject`; a pinned session refuses with
an unpin message and changes nothing, and a retry continues from the failed
step. The attempt that owned the project is ended with reason `discard`;
progress is kept. Online supplies its own implementation through its archive
service. Both also offer the read-only `canRemove` preflight and
`exists({slug, actor})`, which leaves a completely removed practice project out
of Training's `learning.read`/`lesson.read` (L's Practice section). The prepared-practice onboarding read under the retired Learning
attempt/session URL was removed with the lesson-scoped routes; practice
onboarding uses the ordinary project read.

Project metadata optionally stores `allowSharedDatabaseSessions`, defaulting to
false without rewriting old records. The existing locked database settings action
may change this override with open sessions while retaining the scope-change guard.
The shared session-admission policy uses the normal three-session limit when it
is enabled; disabling preserves sessions and blocks additional creation under
project scope. Settings shows the checkbox and shared-data warning only for
project scope. Colleague uses the same action and reports the saved override.
