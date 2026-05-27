# Modularisation TODO

Goal: make Vibe64 server code JSKIT-ish by turning hidden `server/lib` domains into explicit local packages, while keeping each move small enough to verify.

Rules for each stage:

- Move one cohesive domain at a time.
- Keep feature packages as route/action/service owners.
- Keep shared core packages narrow and named by domain.
- Leave compatibility re-export shims only when needed for a staged migration.
- Run `npm run lint`, relevant server tests, `npx jskit lint-descriptors`, and `npx jskit app verify` before marking a stage done.

## Stage 0: Baseline Package Boundary

- [x] Create narrow `@local/vibe64-core` package for shared Vibe64 primitives.
- [x] Move Vibe64 feature route helpers into `@local/vibe64-core`.
- [x] Move Vibe64 response helpers into `@local/vibe64-core`.
- [x] Move local Studio request guards into `@local/vibe64-core`.
- [x] Move Vibe64 session realtime event helpers into `@local/vibe64-core`.
- [x] Move generic terminal websocket route helper into `@local/vibe64-core`.
- [x] Register Vibe64 terminal websocket routes from `@local/vibe64-terminals`.
- [x] Register current-app target-script websocket route from `@local/current-app`.
- [x] Remove feature-specific websocket route registration from `server.js`.
- [x] Verify with `npx jskit app verify`.

## Stage 1: Adapter Domain

Create `@local/vibe64-adapters`.

- [x] Scaffold/install `packages/vibe64-adapters`.
- [x] Move adapter contract and project/application type primitives:
  - `server/lib/vibe64/adapter.js`
  - `server/lib/vibe64/projectType.js`
  - `server/lib/vibe64/applicationTypes.js`
  - `server/lib/vibe64/adapterBlueprints.js`
- [x] Move adapter config primitives:
  - `server/lib/vibe64/configStore.js`
  - `server/lib/vibe64/configValues.js`
- [x] Move adapter registry creation and public adapter exports out of `server/lib/vibe64/index.js`.
- [x] Move existing built-in adapter implementations that are clearly adapter-owned:
  - `fakeAdapter.js`
  - `nodeWebProject.js`
  - JSKIT adapter modules that do not belong to workflow/session runtime
- [x] Update `@local/vibe64-project` to import adapter APIs from `@local/vibe64-adapters`.
- [x] Update runtime/session code to import adapter APIs from `@local/vibe64-adapters`.
- [x] Add descriptor dependencies for packages that consume adapter APIs.
- [x] Add or update tests proving adapter registration/project-type listing still works.
- [x] Verify no feature package imports adapter APIs through `server/lib/vibe64/index.js`.
- [x] Run verification commands.

Completion criteria:

- Adding a new adapter happens inside `@local/vibe64-adapters` or a future adapter package, not inside session/project feature services.
- `@local/vibe64-project` owns the API surface, not adapter implementation details.
- `server/lib/vibe64/index.js` is no longer the adapter registry boundary.

## Stage 2: Vibe64 Runtime Domain

Create `@local/vibe64-runtime`.

Note: adapter-facing workflow helpers (`workflowAdapter.js`, workflow command terminal specs, command facts, and workflow session actions) landed in `@local/vibe64-adapters` instead of `@local/vibe64-runtime` so adapters do not depend on the runtime package.

- [x] Scaffold/install `packages/vibe64-runtime`.
- [x] Move session runtime/store primitives:
  - `runtime.js`
  - `sessionStore.js`
  - `sessionDebugLog.js`
  - `sessionDebugLogCore.js`
  - `setupReadiness.js` if it remains runtime-owned
- [x] Move workflow engine primitives:
  - `workflowMachine.js`
  - `workflowRegistry.js`
  - `workflowAdapter.js`
  - `workflowArtifacts.js`
  - `workflowCommandFacts.js`
  - `workflowCommandTerminal.js`
  - `workflowSessionActions.js`
- [x] Move workflow definition modules/builders:
  - `workflow.js`
  - `workflowDefinitionBuilders.js`
  - `workflowStepFactories.js`
  - `workflowStepMachineHelpers.js`
  - `workflowStepMachines.js`
  - `registerCoreWorkflowModules.js`
  - `workflowModules/*`
- [x] Move presentation only if it remains server-runtime owned:
  - `workflowPresentation.js`
- [x] Update `@local/vibe64-sessions` to depend on `@local/vibe64-runtime`.
- [x] Update `@local/vibe64-project` only for runtime APIs it genuinely needs.
- [x] Keep API route/action ownership in `@local/vibe64-sessions`.
- [x] Add contract tests around workflow registry, session creation, and presentation output.
- [x] Run verification commands.

Completion criteria:

- `@local/vibe64-sessions` is a JSKIT feature/API package over a runtime package.
- Workflow/session internals are not imported from app-global `server/lib`.
- Runtime depends on adapters through explicit package imports.

## Stage 3: Terminal Runtime Core

Create `@local/studio-terminal-core`.

- [x] Scaffold/install `packages/studio-terminal-core`.
- [x] Move terminal session/process primitives:
  - `server/lib/terminalSessions.js`
  - `server/lib/containerRuntime.js`
  - `server/lib/vibe64/runtimeContainers.js`
- [x] Move shared Studio runtime identity/tool-home primitives:
  - `server/lib/studioRuntimeIdentity.js`
  - `server/lib/studioToolHome.js`
  - relevant terminal cleanup/label helpers if shared
- [x] Move shell command helpers if they are terminal-platform primitives:
  - `server/lib/shellCommands.js`
  - `server/lib/shellScript.js`
  - `server/lib/gitToolchainMounts.js`
- [x] Update terminal, doctor, current-app, and setup packages to import from `@local/studio-terminal-core`.
- [x] Keep terminal feature route/controller ownership in `@local/vibe64-terminals`.
- [x] Add or update tests around PTY lifecycle, container command specs, and websocket IO.
- [x] Run verification commands.

Completion criteria:

- Terminal/process/container machinery is explicit shared infrastructure.
- `@local/vibe64-terminals` owns terminal feature behavior, not low-level process primitives.
- Doctor/current-app packages no longer deep-import terminal primitives from `server/lib`.

## Stage 4: Setup Doctor Core

Create `@local/setup-doctor-core`.

Note: generic doctor check item builders landed in `@local/vibe64-core` because terminal runtime, adapters, and doctor tooling all consume them.

- [x] Scaffold/install `packages/setup-doctor-core`.
- [x] Move doctor shared route/stream/cache/plugin primitives:
  - `doctorRoutes.js`
  - `doctorStream.js`
  - `doctorStatusCache.js`
  - `doctorPlugins.js`
  - `doctorPluginToolkit.js`
- [x] Move doctor check/toolchain primitives:
  - `doctorCheckItems.js`
  - `doctorToolchain.js`
  - `doctorToolchainCommands.js`
- [x] Move Git/GitHub setup helpers if they are doctor-owned:
  - `setupDoctorGit.js`
  - `githubRemote.js`
  - `githubRepoSetupScript.js`
- [x] Update `studio-setup-doctor`, `adapter-setup-doctor`, `project-setup-doctor`, and `vibe64-accounts` to import from `@local/setup-doctor-core`.
- [x] Keep each doctor package as the owner of its service/actions/routes.
- [x] Add or update tests around readiness, repair commands, and doctor route behavior.
- [x] Run verification commands.

Completion criteria:

- Doctor packages share explicit doctor infrastructure.
- Doctor feature packages do not rely on app-global `server/lib` toolkits.

## Stage 5: Current App / Launch Ownership

- [x] Audit current-app and launch-related files after stages 1-4.
- [x] Move current-app-owned behavior directly into `@local/current-app`.
- [x] Move adapter-specific launch inspection into `@local/vibe64-adapters`.
- [x] Move terminal/process launch plumbing into `@local/studio-terminal-core`.
- [x] Ensure current-app package owns routes/actions/service only.
- [x] Run verification commands.

Completion criteria:

- Current-app behavior is not split between package service code and hidden app-global implementation files.
- Adapter-specific launch behavior lives with adapters.

## Stage 6: Burn Down `server/lib`

- [x] List remaining `packages/** -> server/lib/**` imports.
- [x] Classify remaining imports as platform glue, compatibility shim, or missed domain code.
- [x] Remove compatibility shims once no package imports them.
- [x] Keep `server.js` and `server/lib` focused on app startup/platform concerns only:
  - runtime env
  - surface runtime
  - browser lifecycle
  - static serving helpers
  - startup cleanup, if not moved elsewhere
- [x] Add a test or lint guard preventing feature packages from deep-importing `server/lib`.
- [x] Run final `npx jskit app verify`.

Completion criteria:

- JSKIT feature packages own feature routes/actions/services.
- Shared implementation code lives in explicit local packages.
- `server.js` is platform glue.
- `server/lib` is no longer an undeclared package.
