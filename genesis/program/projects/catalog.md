# Project catalog

People can create, select, and reopen the projects available to their Vibe64
workspace.

## Sources

- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/settingsAssistantContracts.js`
- `tests/server/vibe64SettingsActionTools.unit.test.js`
- `packages/vibe64-project/src/server/onboardingAssistantContracts.js`
- `packages/vibe64-project/src/shared/onboardingRequest.js`
- `tests/server/vibe64OnboardingActionTools.unit.test.js`
- `tests/server/vibe64ProjectActionDispatch.unit.test.js`
- `packages/vibe64-project/src/server/managedProject.js`
- `packages/vibe64-genesis/src/server/index.js`
- `src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `packages/vibe64-core/src/server/studioProjectContext.js`
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
bounded diagnostics and configured starter identities. The action accepts a
purpose for preparing the same setup request as the UI; reading never starts an
agent. Colleague delegates an agreed request through the existing Junior
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
or access reads; the HTTP resources remain authoritative.
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
