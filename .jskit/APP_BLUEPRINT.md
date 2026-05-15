# App Blueprint

## Product

- App purpose: JSKIT AI Studio is a local-first operator UI for the JSKIT app in the current working directory.
- Primary users: the local operator running the Studio process.
- Success criteria: inspect, run, review, verify, and later deploy the current JSKIT app without a hosted service or project registry.
- First-run rule: Studio gates readiness behind the Bootup/Setup flow at `/bootup-setup`. The default tab is `bootup`; missing or unknown `tab` query values normalize to `bootup`.
- Root rule: the controlled project root is the launcher/invocation directory, not necessarily the Studio implementation directory. If the Studio executable has to start the server from the Studio app root, the launcher must preserve the original project root in `JSKIT_STUDIO_TARGET_ROOT`.
- Target-readiness rule: after Bootstrap Doctor passes and before any app inspection, Studio runs Target App Doctor in `/bootup-setup?tab=app-bootup` to prove target identity, filesystem access, Git state, and GitHub control capability without reading app metadata.
- App-setup rule: after Target App Doctor passes and before `/home`, Studio runs App Setup Doctor in `/bootup-setup?tab=app-setup` to make the target root a doctor-ready JSKIT app without duplicating `jskit app verify`.

## Platform Choices

- Tenancy mode: none.
- Database engine: none for Studio V0.
- Auth provider: none for Studio V0.
- Optional extras: no realtime, assistant runtime, uploads, users, workspaces, or database packages in the initial baseline.
- Mandatory bootstrap runtime: a reliable, Studio-managed environment able to run MySQL, Node 22, npm, git, GitHub CLI, and Codex. The target direction is container-provided runtimes rather than relying on whatever happens to be installed on the host.

## Actors And Access

- Actor list: local operator.
- Permission boundaries: local-only browser UI and local server; dangerous actions will need explicit confirmation when added.
- Console/admin-only areas: none in V0.
- Bootstrap boundary: before the Bootstrap Doctor passes, the operator cannot inspect, run, modify, verify, or deploy a project. `/bootup-setup?tab=bootup` remains directly available for diagnostics and explicit setup/provisioning steps.

## Surfaces

- Global surfaces: home.
- Workspace surfaces: none.
- Settings surfaces: none.

## Data Model

| Entity | Purpose | Ownership | Notes |
| --- | --- | --- | --- |
| BootstrapEnvironment | Machine-level runtime readiness for Studio | public | Checks Docker/runtime ability to provide MySQL capability, Node 22, npm, git, GH auth, and Codex auth before project work begins. |
| TargetAppReadiness | Pre-inspection Git/GitHub readiness for the target root | public | Derived from target path, Git, and GitHub CLI checks; blocks app inspection and edits until ready or repaired. |
| AppSetupReadiness | Sequential setup state for the target app | public | Derived from filesystem, Git/GitHub remote state, JSKIT scaffold markers, local dependencies, runtime service needs, and `jskit app verify`. |
| CurrentApp | Runtime snapshot of the target project root | public | Derived from filesystem and git on request; not persisted. The target root comes from the invocation directory or `JSKIT_STUDIO_TARGET_ROOT`, not from a stored project list. |

## Route And Screen Plan

- Home/global routes: `/bootup-setup` is the single Bootup/Setup route and renders three query-addressable tabs: `?tab=bootup`, `?tab=app-bootup`, and `?tab=app-setup`. `/home` shows Current App inspection. The legacy `/bootup`, `/app-bootup`, and `/app-setup` file routes are intentionally removed and are not compatibility redirects.
- Account routes: none.
- Console routes: none.
- Workspace app routes: none.
- Workspace admin routes: none.

## Package Plan

- Baseline runtime packages: `@jskit-ai/shell-web`, `@local/main`, `@local/bootstrap-doctor`, `@local/target-app-doctor`, `@local/app-setup-doctor`, `@local/current-app`.
- Optional runtime packages: none for V0.
- Generator packages to use: `feature-server-generator` for Bootstrap Doctor, Target App Doctor, and Current App endpoints.
- Package-owned workflows to accept as baseline: base JSKIT app runtime.
- Package-owned workflows to override or extend: none.

## Implementation Notes

- CRUDs to scaffold: none.
- Non-CRUD pages to scaffold: none; adapt the existing generated home page.
- Custom code areas: bootstrap runtime checks, target app Git/GitHub readiness checks, app setup orchestration checks, current-app server inspection service, the Bootup/Setup tab host, and gated home page UI.
- Bootup/Setup UI ownership: `src/pages/bootup-setup.vue` owns the single `ShellLayout` wrapper and lazy-mounts one active doctor screen at a time. The reusable doctor screens live under `src/components/studio/` and must not include their own `ShellLayout`.
- Gate route state: `resolveStudioGate()` stores the shared route `/bootup-setup` plus a `tab` value (`bootup`, `app-bootup`, or `app-setup`) instead of storing old route strings.

## Bootstrap Runtime Plan

- Scope: machine/runtime readiness only. Do not inspect the controlled app in this slice.
- Required capabilities: Docker engine, Docker Compose plugin, managed MySQL that can create/drop a temporary probe database and table, Node 22 runtime, npm, git, GitHub CLI installed and logged in, Codex installed and logged in.
- Reliability rule: prefer container-provided runtimes with pinned images/build inputs; do not silently pass by using arbitrary host-installed Node or Codex.
- MySQL boundary: Bootstrap Doctor must not ask for or create the controlled app's database name. App-specific database names and schemas are decided later from the current app; bootstrap only proves that the managed MySQL container works and has DDL rights.
- Host prerequisite: Docker is the one accepted host prerequisite in V0. Podman can be added later behind the same container-engine boundary.
- Gate rule: every required check must be `pass`; `warn`, `fail`, `skip`, or `unknown` keeps Studio in bootstrap mode.
- Failure behavior: show what failed, what was expected, observed evidence, and the exact command or provisioning step that would address it. Repairs run through an xterm-backed terminal stream so the operator can see commands as they happen.
- Codex auth behavior: prefer normal browser login by running the Codex login terminal with Docker host networking when that is available; expose device auth as the fallback for Docker Desktop without host networking, unsupported hosts, and remote/SSH-like environments.
- Persistence: if bootstrap receipts are needed later, they are machine-level receipts, not project database rows. No Studio database.

## Target App Doctor Plan

- Scope: target identity and Git/GitHub readiness only. Do not read JSKIT app metadata, source, package manifests, or config in this stage.
- Required checks: target root exists and is readable/writable, target root is not the Studio implementation root, target repo is not the Studio repo, target is inside a Git work tree, current branch is known, Git identity is configured, working tree is clean for V0, GitHub CLI auth works, and GitHub remote/API access works when a GitHub remote exists.
- Repair behavior: offer explicit terminal actions for `git init`, Git identity setup, and GitHub repo creation when repo/remote state is missing. GitHub repo creation pushes only when commits exist; empty repos are created and linked without pushing. Commands must be shown before running.
- Blocking behavior: target root equal to Studio root, target repo equal to Studio repo, dirty working tree, missing Git identity, missing GH auth, and unreachable GitHub remote keep Studio in the App Bootup tab.
- Boundary: creating issues/PRs and app-specific DB/table checks belong to later stages, after Target App Doctor and app inspection.

## App Setup Doctor Plan

- Scope: sequential target setup after machine and target-control gates are ready. This stage may read project setup files because it is explicitly about making the current directory app-ready.
- Authority boundary: Studio does not duplicate JSKIT internals. It only checks the safe outer state needed to run `jskit app verify`; the final JSKIT Doctor stage owns app correctness.
- Admissible starting states: an empty directory with no `.git`, or an existing coherent Git repository. A directory with files but no `.git` is a hard stop.
- Hard stops: linked worktrees/submodule-style `.git` files, bare repos, detached/unknown branches, non-GitHub `origin`, inaccessible GitHub repositories, local/remote history divergence, remote content not mirrored locally, malformed `.jskit/lock.json`, and existing non-JSKIT files where the generator would overwrite user-owned work.
- Sequential stages: Directory admissibility, Git ready, Remote ready, Remote/local sync, Initial JSKIT scaffold, Dependencies runnable, Runtime services, JSKIT doctor, Ready.
- Repair behavior: offer terminal actions for `git init`, GitHub repo creation/linking, JSKIT scaffold creation, `npm install` followed immediately by `npm run devlinks` when that script exists, app database creation when a database runtime is actually installed, and explicit JSKIT doctor runs.
- Database boundary: fresh minimal scaffolds do not require a database. Database checks only run when the target app has a JSKIT database runtime installed; Studio itself still has no database.

## CRUD Planning

| CRUD | Operations | List Fields | View Form Shape | Edit/New Form Shape | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## Delivery Plan

| Chunk | Goal | Type | Depends on | Done when |
| --- | --- | --- | --- | --- |
| Bootstrap Doctor | Block Studio behind machine runtime checks for Docker, MySQL capability, Node 22, npm, git, GH, and Codex. | Generated server package plus gated shell-web UI | Base scaffold | `/bootup-setup?tab=bootup` shows bootstrap status, all checks return structured pass/fail data, project UI is unavailable until every required check passes, and tests/Playwright verify the blocked bootstrap screen. |
| Target App Doctor | Block app inspection behind target identity and Git/GitHub readiness. | Generated server package plus gated shell-web UI | Bootstrap Doctor | `/bootup-setup?tab=app-bootup` shows target readiness after bootstrap, terminal repair actions are available for missing Git/GitHub setup, and Current App inspection is unavailable until every required check passes. |
| App Setup Doctor | Sequentially make the target root a doctor-ready JSKIT app. | Generated-style server package plus gated shell-web UI | Target App Doctor | `/bootup-setup?tab=app-setup` shows sequential setup stages, hard-stops unsafe Git/filesystem states, repairs safe missing setup through terminal actions, and only passes after JSKIT doctor passes. |
| Current App inspection | Show current-directory JSKIT metadata on `/home` from a local endpoint. | Generated server package plus UI adaptation | Base scaffold | Endpoint returns filesystem/git metadata, UI displays loading/error/empty states, tests and UI verification pass. |

## Verification

- Commands to run: `npm run lint`, `npm test`, `npm run test:client`, `npm run build`, targeted Playwright for Current App UI, `npx --no-install jskit app verify-ui ...`.
- Playwright coverage plan: load `/bootup-setup`, `/bootup-setup?tab=bootup`, `/bootup-setup?tab=app-bootup`, `/bootup-setup?tab=app-setup`, and `/home` at compact, medium, and expanded widths where applicable; assert tab clicks update URL query state, ready continue actions move through the tab flow, old bootup routes do not redirect to `/bootup-setup`, and no horizontal overflow occurs.
- Test auth strategy: none; V0 has no auth.
- UI review expectations: dense local operator UI with clear status, scripts, packages, surfaces, runtime needs, and git status.
- Known open questions: Podman support, ephemeral startup token, command runner, persistent job logs, and ready-state UI verification after a real managed bootstrap are later chunks.
