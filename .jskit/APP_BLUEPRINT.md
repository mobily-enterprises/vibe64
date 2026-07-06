# App Blueprint

## Product

- App purpose: Vibe64 is a local-first operator UI for the target project selected by the local operator.
- Primary users: the local operator running the Studio process.
- Success criteria: choose or create a local project folder, then inspect, run, review, verify, and later deploy the selected target project from the local editor.
- First-run rule: when no explicit target root is provided, Studio opens to project selection at `/app` before project type, setup readiness, sessions, or project tools load. Only after a project is selected does Studio gate readiness behind the project dashboard Setup flow at `/app/project/[slug]/dashboard/setup`. The default setup tab is `studio-setup`; missing or unknown `tab` query values normalize to `studio-setup`.
- Project root rule: managed project folders live under `~/vibe64` by default, or under `VIBE64_PROJECTS_ROOT` when configured. Starting Studio with `vibe64 .`, `vibe64 /path/to/project`, `--target <path>`, or `VIBE64_TARGET_ROOT=/path/to/project` selects that explicit target root immediately. Without an explicit target, the process cwd is not treated as the target project.
- Project identity rule: the selected directory is a filesystem target, not the canonical application name. Directory name is only a fallback/convention for generated setup prompts when no better project identity exists.
- Target-readiness rule: after Studio Setup Doctor passes and before any app inspection, Studio runs Adapter Setup Doctor in `/app/project/[slug]/dashboard/setup?tab=adapter-setup` to prove target identity, filesystem access, Git state, and GitHub control capability without reading target-specific app metadata.
- App-setup rule: after Adapter Setup Doctor passes and before `/app/project/[slug]`, Studio runs Project Setup Doctor in `/app/project/[slug]/dashboard/setup?tab=project-setup` to make the target root ready for the selected adapter.

## Important Design Decisions

- Numbered questions are deliberately UI-only sugar. The server sends one prompt/message and one logical response field; the client may render supported numbered-question text as separate inputs, but it submits one combined response value. Do not replace this with server question metadata, structured question endpoints, or separate persisted question-answer fields.
- Non-command action handlers stay inside the per-session mutation queue by default. Vibe64 is an interactive, sequential workflow, and long-running Codex/command work is already made visible through live terminal surfaces. Do not split prompt/adapter/finish handlers out into parallel action execution unless timestamped logs show a real user-visible gap before the terminal appears; fix that measured pre-terminal stall before changing the serialization model.
- Vibe64 is a single-process local editor for one selected target root at a time. The selected root comes from explicit startup input or the in-process project selector; all project-specific services read that shared selection instead of inferring cwd. Session persistence is file-backed under the selected root's `.vibe64`; in-process mutation queues are the concurrency boundary. JSKIT realtime is used for local UI event fanout so the same operator can keep multiple browsers or devices in sync with the same Studio process. That realtime layer does not make session persistence distributed. Do not add Redis, Socket.IO clustering, cross-process locking, distributed session coordination, or project-registry assumptions unless this product contract is deliberately changed first.

## Platform Choices

- Tenancy mode: none.
- Database engine: none for Studio V0.
- Auth provider: none for Studio V0.
- Optional extras: no assistant runtime, uploads, users, workspaces, or database packages in the initial baseline. Realtime is part of the Studio baseline only for same-process multi-client UI synchronization.
- Mandatory Studio Setup runtime: host-installed tools able to run Node/npm/Corepack package managers, git, ripgrep, Playwright/Chromium, GitHub CLI, Codex, and Codex sandbox checks. Target-specific frameworks, databases, and framework doctors belong to adapter/project setup.

## Actors And Access

- Actor list: local operator.
- Permission boundaries: local-only browser UI and local server; dangerous actions will need explicit confirmation when added.
- Console/admin-only areas: none in V0.
- Studio Setup boundary: before the Studio Setup Doctor passes, the operator cannot inspect, run, modify, verify, or deploy a project. `/app/project/[slug]/dashboard/setup?tab=studio-setup` remains directly available for diagnostics and explicit setup/provisioning steps.

## Surfaces

- Global surfaces: home.
- Workspace surfaces: none.
- Settings surfaces: none.

## Data Model

| Entity | Purpose | Ownership | Notes |
| --- | --- | --- | --- |
| StudioSetupEnvironment | Machine-level runtime readiness for Studio | public | Checks host runtime tools, package managers, git, ripgrep, Playwright/Chromium, GH auth, Codex auth, and Codex sandboxing before project work begins. |
| StudioProjectSelection | In-process selected target root plus managed project folders | public | Lists and creates folders under `~/vibe64` or `VIBE64_PROJECTS_ROOT`. Explicit startup targets may be outside that managed root. This is process state, not a hosted registry or project database. |
| AdapterSetupReadiness | Pre-inspection Git/GitHub readiness for the target root | public | Derived from target path, Git, and GitHub CLI checks; blocks app inspection and edits until ready or repaired. |
| ProjectSetupReadiness | Sequential setup state for the target app | public | Derived from filesystem, Git/GitHub remote state, adapter setup plugins, local dependencies, runtime service needs, and the selected adapter's readiness checks. |
| CurrentApp | Runtime snapshot of the target project root | public | Derived from filesystem and git on request; not persisted. The target root comes from StudioProjectSelection or an explicit startup target. |
| IssueSession | Vibe64 session runtime state for the current target app | public | Derived from `.vibe64/sessions` and Vibe64 runtime APIs; not a database table. Active sessions stay on `/app/project/[slug]`; completed and abandoned archive views are read through Current App APIs. Adapter-specific framework work uses the selected adapter's commands. Vibe64 session state is inspected through `.vibe64`. |
| CurrentAppTargetScripts | Target scripts plus operator shortcuts | public | Derived from adapter-provided scripts and project-owned `.vibe64/scripts/*` files. Starred script overrides are target-root config in `.vibe64/config/starred_scripts`, not database or CRUD-owned data. |

## Route And Screen Plan

- App/global routes: `/app` hosts project selection. `/app/project/[slug]` hosts the active issue-session workspace after selection. `/app/project/[slug]/dashboard/setup` is the Setup route and renders three query-addressable tabs after project selection: `?tab=studio-setup`, `?tab=adapter-setup`, and `?tab=project-setup`.
- Active session title behavior: `/app/project/[slug]` shows the selected active `IssueSession` title in the shell app bar top-left area so it does not consume page content height. The title is unboxed and is not duplicated as a Session details fact. When no active title is available, the shell falls back to the normal `Sessions` label.
- Project tools route: `/app/project/[slug]/dashboard/run` is reached from the dashboard/session tool navigation as `Run`. It is separate from the active issue-session workspace so script shortcuts do not dominate the chat/preview surface.
- Session history route: `/app/project/[slug]/dashboard/history` is the archive list screen for issue sessions. It is reached from dashboard navigation as `Session History`, uses Vuetify tabs for `Completed` and `Abandoned`, stores the selected tab in `?tab=completed|abandoned`, and defaults missing or invalid tab state to `completed`. Individual archived sessions use `/app/project/[slug]/dashboard/history/[sessionId]` as a separate read-only view page with a Back to sessions link; the list does not inline the detail view.
- Session history title rule: `/app/project/[slug]/dashboard/history` keeps its in-page Session History heading and must not inherit the active `/app/project/[slug]` session title.
- Removed archive routes: `/app/project/[slug]/completed` and `/app/project/[slug]/abandoned` are intentionally not compatibility routes, aliases, or redirects. Completed and Abandoned should not appear in primary navigation.
- Account routes: none.
- Console routes: none.
- Workspace app routes: none.
- Workspace admin routes: none.

## Package Plan

- Baseline runtime packages: `@jskit-ai/shell-web`, `@local/main`, `@local/studio-setup-doctor`, `@local/adapter-setup-doctor`, `@local/project-setup-doctor`, `@local/current-app`.
- Optional runtime packages: none for V0.
- Generator packages to use: `feature-server-generator` for Studio Setup Doctor, Adapter Setup Doctor, and Current App endpoints.
- Package-owned workflows to accept as baseline: base Vibe64 app runtime.
- Package-owned workflows to override or extend: none.

## Implementation Notes

- CRUDs to scaffold: none.
- Non-CRUD pages to scaffold: use the JSKIT UI generator for new app pages when it fits; `/app/project/[slug]/dashboard/run` is a generated-style page customized around target scripts, and `/app/project/[slug]/dashboard/history` is a generated-style Vuetify page customized for Session History tabs. The dashboard Setup route owns doctor tabs and gate query behavior.
- Custom code areas: Studio Setup runtime checks, Adapter Setup Git/GitHub readiness checks, Project Setup orchestration checks, current-app server inspection service, issue-session UI, the Setup tab host, and gated home page UI.
- Setup UI ownership: `src/pages/app/project/[slug]/dashboard/setup/index.vue` owns the project setup surface and lazy-mounts one active doctor screen at a time. The reusable doctor screens live under `src/components/studio/` and must not include their own shell layout.
- Project selection ownership: `@local/vibe64-project` owns project selection state and routes. The client gates `/app/project/[slug]` and `/app/project/[slug]/dashboard/*` behind `ProjectSelectionGate` so project type, setup readiness, current app, sessions, and project tools do not load before a target root exists.
- Gate route state: project setup uses `/app/project/[slug]/dashboard/setup` plus a `tab` value (`studio-setup`, `adapter-setup`, or `project-setup`).
- Issue-session archives: `ArchivedIssueSessions` owns archive list loading, empty, error, refresh, and card-detail states. The Session History page reuses it with `archive=completed|abandoned`, hides archive-specific title/description copy inside tabs, and places one top-level Refresh action in the tab controls so the archive content does not gain an extra action-only header row.
- Active issue-session naming: derive display titles through `issueSessionDisplayTitle(session)` using trimmed `session.issueTitle`, then the first meaningful line from `session.issueText`, then `Session <shortIssueSessionId(session.sessionId)>`. `IssueSessionPanel` emits the selected title upward; `src/pages/app/project/[slug].vue` owns shell app-bar rendering and clears it when leaving the project workspace or when the current app/session is unavailable.
- Current-app archive API: completed and abandoned archive lists use `GET /api/studio/current-app/issue-sessions?archive=<completed|abandoned>`. This is app runtime data, not CRUD-owned persistence.
- Current-app target script API: `@local/current-app` owns `GET /api/studio/current-app/target-scripts`, `PUT /api/studio/current-app/target-scripts/starred`, `DELETE /api/studio/current-app/target-scripts/starred`, `POST /api/studio/current-app/target-script-terminal`, and `DELETE /api/studio/current-app/target-script-terminal/:terminalSessionId`. All are local-only Studio routes. Adapter scripts are validated by the adapter; project scripts are files under `.vibe64/scripts/` with safe filenames.
- Starred target script config: missing `.vibe64/config/starred_scripts` means adapter-provided defaults are used. A present blank file means no starred scripts. Saving writes stable script ids in sorted order; reset deletes the file.
- Target script terminal: script runs use the terminal session infrastructure and the selected adapter's terminal spec. Project-owned scripts run as `bash .vibe64/scripts/<scriptName>`. Adapter-owned scripts decide their own command shape.
- Shared terminal UI: Studio xterm lifecycle, websocket connection, output trimming, input, Ctrl-C, retry, and close behavior live in `src/composables/useStudioTerminal.js` and should be reused by new terminal surfaces instead of copied into each component.
- Local Studio request guard: Current App Studio HTTP and websocket routes are loopback-only by default. Container/host UI testing that cannot satisfy loopback host/origin checks must use the explicit `--bypass-localhost-check` flag or `VIBE64_BYPASS_LOCALHOST_CHECK=1`; `bin/dev.js` forwards the bypass as environment to Vite and the dev proxy rewrites origin only under that explicit bypass.
- App test run config: adapter/project-specific test commands are not a mainline Studio Setup concern. Studio self-testing may still use the explicit localhost-check bypass when a local browser runner must reach local-only Current App routes.
- Studio terminal cleanup: Codex/app-test terminals are tied to the Studio daemon PID so startup cleanup can remove stale process trees from dead Studio daemons without touching active sessions.

## Studio Setup Runtime Plan

- Scope: machine/runtime readiness only. Do not inspect the controlled app in this slice.
- Required capabilities: Node, npm, Corepack-backed pnpm/Yarn, Bun when present, git, ripgrep, Playwright/Chromium, GitHub CLI installed and logged in, Codex installed and logged in, and Codex sandboxing.
- Reliability rule: verify the host tools Studio will actually execute; do not pass by checking a different binary path or hidden runtime.
- Runtime boundary: Studio Setup Doctor must not ask for or create target-specific runtime state. App-specific dependencies, databases, services, and framework doctors are adapter/project setup responsibilities.
- Gate rule: every required check must be `pass`; `warn`, `fail`, `skip`, or `unknown` keeps Studio in Studio Setup mode.
- Failure behavior: show what failed, what was expected, observed evidence, and the exact command or provisioning step that would address it. Repairs run through an xterm-backed terminal stream so the operator can see commands as they happen.
- Codex auth behavior: prefer normal browser login using the real OS user's Codex home. Device auth remains available for remote/SSH-like environments where browser login is not usable.
- Persistence: if Studio Setup receipts are needed later, they are machine-level receipts, not project database rows. No Studio database.

## Adapter Setup Doctor Plan

- Scope: target identity and Git/GitHub readiness only. Do not read target app metadata, source, package manifests, or config in this stage.
- Required checks: target root exists and is readable/writable, target root is not the Studio implementation root, target repo is not the Studio repo, target is inside a Git work tree, current branch is known, Git identity is configured, working tree is clean for V0, GitHub CLI auth works, and GitHub remote/API access works when a GitHub remote exists.
- Repair behavior: offer explicit terminal actions for `git init`, Git identity setup, and GitHub repo creation when repo/remote state is missing. GitHub repo creation pushes only when commits exist; empty repos are created and linked without pushing. Commands must be shown before running.
- Blocking behavior: target root equal to Studio root, target repo equal to Studio repo, dirty working tree, missing Git identity, missing GH auth, and unreachable GitHub remote keep Studio in the Adapter Setup tab.
- Boundary: creating issues/PRs and app-specific DB/table checks belong to later stages, after Adapter Setup Doctor and app inspection.

## Project Setup Doctor Plan

- Scope: sequential target setup after machine and target-control gates are ready. This stage may read project setup files because it is explicitly about making the selected project app-ready.
- Authority boundary: Studio does not duplicate adapter internals. It only checks the safe outer state needed to run adapter setup plugins; the selected adapter owns framework correctness.
- Admissible starting states: an empty directory with no `.git`, or an existing coherent Git repository. A directory with files but no `.git` is a hard stop.
- Hard stops: linked worktrees/submodule-style `.git` files, bare repos, detached/unknown branches, non-GitHub `origin`, inaccessible GitHub repositories, local/remote history divergence, remote content not mirrored locally, malformed adapter metadata, and existing files where an adapter generator would overwrite user-owned work.
- Sequential stages: Directory admissibility, Git ready, Remote ready, Remote/local sync, adapter-provided setup checks, setup checkpoint, Ready.
- Repair behavior: offer terminal actions for `git init`, GitHub repo creation/linking, adapter scaffold creation, adapter dependency installation, adapter runtime service setup, and adapter doctor runs.
- Database boundary: fresh minimal scaffolds do not require a database. Database checks only run when the selected adapter declares a database runtime requirement; Studio itself still has no database.
- Verification seam: runtime Git-ready checks run through the host command layer. Verification should use fast unit/integration coverage for setup status shape and terminal action contracts; e2e coverage is intentionally deferred.

## CRUD Planning

| CRUD | Operations | List Fields | View Form Shape | Edit/New Form Shape | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## Delivery Plan

| Chunk | Goal | Type | Depends on | Done when |
| --- | --- | --- | --- | --- |
| Studio Setup Doctor | Block Studio behind machine runtime checks for host tools, git, GH, and Codex. | Generated server package plus gated shell-web UI | Base scaffold | `/app/project/[slug]/dashboard/setup?tab=studio-setup` shows Studio Setup status, all checks return structured pass/fail data, and project UI is unavailable until every required check passes. |
| Adapter Setup Doctor | Block app inspection behind target identity and Git/GitHub readiness. | Generated server package plus gated shell-web UI | Studio Setup Doctor | `/app/project/[slug]/dashboard/setup?tab=adapter-setup` shows target readiness after Studio Setup, terminal repair actions are available for missing Git/GitHub setup, and Current App inspection is unavailable until every required check passes. |
| Project Setup Doctor | Sequentially make the target root ready for the selected adapter. | Generated-style server package plus gated shell-web UI | Adapter Setup Doctor | `/app/project/[slug]/dashboard/setup?tab=project-setup` shows sequential setup stages, hard-stops unsafe Git/filesystem states, repairs safe missing setup through terminal actions, and only passes after adapter setup plugins pass. |
| Current App inspection | Show current target metadata on `/app/project/[slug]` from a local endpoint. | Generated server package plus UI adaptation | Base scaffold | Endpoint returns filesystem/git/adapter metadata, UI displays loading/error/empty states, fast checks and UI verification pass. |

## Verification

- Commands to run: `npm run lint`, fast targeted unit/integration tests, and `npm run build`. Do not write or run e2e tests for this version unless the rule is explicitly changed.
- UI verification plan: load `/app`, `/app/project/[slug]`, `/app/project/[slug]/dashboard/setup`, `/app/project/[slug]/dashboard/setup?tab=studio-setup`, `/app/project/[slug]/dashboard/setup?tab=adapter-setup`, `/app/project/[slug]/dashboard/setup?tab=project-setup`, `/app/project/[slug]/dashboard/history`, and `/app/project/[slug]/dashboard/run` at compact, medium, and expanded widths where applicable; assert tab clicks update URL query state, ready continue actions move through the tab flow, target script stars persist/reset, target script terminal opens with only one visible instance, and no horizontal overflow occurs.
- Test auth strategy: none; V0 has no auth.
- UI review expectations: dense local operator UI with clear status, scripts, packages, surfaces, runtime needs, and git status.
- Known open questions: Podman support, ephemeral startup token, command runner, persistent job logs, and ready-state UI verification after a real managed Studio Setup are later chunks.
