# App Blueprint

## Product

- App purpose: JSKIT AI Studio is a local-first operator UI for the JSKIT app in the current working directory.
- Primary users: the local operator running the Studio process.
- Success criteria: inspect, run, review, verify, and later deploy the current JSKIT app without a hosted service or project registry.
- First-run rule: Studio must gate all project functionality behind a mandatory Bootstrap Doctor. If the bootstrap runtime is not fully healthy, the web app shows only bootstrap setup/status screens.

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
- Bootstrap boundary: before the Bootstrap Doctor passes, the operator cannot inspect, run, modify, verify, or deploy a project. The only available actions are bootstrap diagnostics and explicit setup/provisioning steps.

## Surfaces

- Global surfaces: home.
- Workspace surfaces: none.
- Settings surfaces: none.

## Data Model

| Entity | Purpose | Ownership | Notes |
| --- | --- | --- | --- |
| BootstrapEnvironment | Machine-level runtime readiness for Studio | public | Checks Docker/runtime ability to provide MySQL capability, Node 22, npm, git, GH auth, and Codex auth before project work begins. |
| CurrentApp | Runtime snapshot of the current working directory | public | Derived from filesystem and git on request; not persisted. |

## Route And Screen Plan

- Home/global routes: `/home` must first show Bootstrap Doctor when bootstrap is not 100% healthy; after bootstrap passes, it can show Current App inspection.
- Account routes: none.
- Console routes: none.
- Workspace app routes: none.
- Workspace admin routes: none.

## Package Plan

- Baseline runtime packages: `@jskit-ai/shell-web`, `@local/main`, `@local/bootstrap-doctor`, `@local/current-app`.
- Optional runtime packages: none for V0.
- Generator packages to use: `feature-server-generator` for Bootstrap Doctor and Current App endpoints.
- Package-owned workflows to accept as baseline: base JSKIT app runtime.
- Package-owned workflows to override or extend: none.

## Implementation Notes

- CRUDs to scaffold: none.
- Non-CRUD pages to scaffold: none; adapt the existing generated home page.
- Custom code areas: bootstrap runtime checks, current-app server inspection service, and gated home page UI.

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

## CRUD Planning

| CRUD | Operations | List Fields | View Form Shape | Edit/New Form Shape | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## Delivery Plan

| Chunk | Goal | Type | Depends on | Done when |
| --- | --- | --- | --- | --- |
| Bootstrap Doctor | Block Studio behind machine runtime checks for Docker, MySQL capability, Node 22, npm, git, GH, and Codex. | Generated server package plus gated shell-web UI | Base scaffold | `/home` shows bootstrap status first, all checks return structured pass/fail data, project UI is unavailable until every required check passes, and tests/Playwright verify the blocked bootstrap screen. |
| Current App inspection | Show current-directory JSKIT metadata on `/home` from a local endpoint. | Generated server package plus UI adaptation | Base scaffold | Endpoint returns filesystem/git metadata, UI displays loading/error/empty states, tests and UI verification pass. |

## Verification

- Commands to run: `npm run lint`, `npm test`, `npm run test:client`, `npm run build`, targeted Playwright for Current App UI, `npx jskit app verify-ui ...`.
- Playwright coverage plan: load `/home` at compact, medium, and expanded widths; assert Bootstrap Doctor is visible while blocked and no horizontal overflow occurs.
- Test auth strategy: none; V0 has no auth.
- UI review expectations: dense local operator UI with clear status, scripts, packages, surfaces, runtime needs, and git status.
- Known open questions: Podman support, ephemeral startup token, command runner, persistent job logs, and ready-state UI verification after a real managed bootstrap are later chunks.
