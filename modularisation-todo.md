# Modularisation TODO

Goal: make AI Studio server code JSKIT-ish by turning hidden `server/lib` domains into explicit local packages, while keeping each move small enough to verify.

Rules for each stage:

- Move one cohesive domain at a time.
- Keep feature packages as route/action/service owners.
- Keep shared core packages narrow and named by domain.
- Leave compatibility re-export shims only when needed for a staged migration.
- Run `npm run lint`, relevant server tests, `npx jskit lint-descriptors`, and `npx jskit app verify` before marking a stage done.

## Stage 0: Baseline Package Boundary

- [x] Create narrow `@local/ai-studio-core` package for shared AI Studio primitives.
- [x] Move AI Studio feature route helpers into `@local/ai-studio-core`.
- [x] Move AI Studio response helpers into `@local/ai-studio-core`.
- [x] Move local Studio request guards into `@local/ai-studio-core`.
- [x] Move AI Studio session realtime event helpers into `@local/ai-studio-core`.
- [x] Move generic terminal websocket route helper into `@local/ai-studio-core`.
- [x] Register AI Studio terminal websocket routes from `@local/ai-studio-terminals`.
- [x] Register current-app target-script websocket route from `@local/current-app`.
- [x] Remove feature-specific websocket route registration from `server.js`.
- [x] Verify with `npx jskit app verify`.

## Stage 1: Adapter Domain

Create `@local/ai-studio-adapters`.

- [ ] Scaffold/install `packages/ai-studio-adapters`.
- [ ] Move adapter contract and project/application type primitives:
  - `server/lib/aiStudio/adapter.js`
  - `server/lib/aiStudio/projectType.js`
  - `server/lib/aiStudio/applicationTypes.js`
  - `server/lib/aiStudio/adapterBlueprints.js`
- [ ] Move adapter config primitives:
  - `server/lib/aiStudio/configStore.js`
  - `server/lib/aiStudio/configValues.js`
- [ ] Move adapter registry creation and public adapter exports out of `server/lib/aiStudio/index.js`.
- [ ] Move existing built-in adapter implementations that are clearly adapter-owned:
  - `fakeAdapter.js`
  - `nodeWebProject.js`
  - JSKIT adapter modules that do not belong to workflow/session runtime
- [ ] Update `@local/ai-studio-project` to import adapter APIs from `@local/ai-studio-adapters`.
- [ ] Update runtime/session code to import adapter APIs from `@local/ai-studio-adapters`.
- [ ] Add descriptor dependencies for packages that consume adapter APIs.
- [ ] Add or update tests proving adapter registration/project-type listing still works.
- [ ] Verify no feature package imports adapter APIs through `server/lib/aiStudio/index.js`.
- [ ] Run verification commands.

Completion criteria:

- Adding a new adapter happens inside `@local/ai-studio-adapters` or a future adapter package, not inside session/project feature services.
- `@local/ai-studio-project` owns the API surface, not adapter implementation details.
- `server/lib/aiStudio/index.js` is no longer the adapter registry boundary.

## Stage 2: AI Studio Runtime Domain

Create `@local/ai-studio-runtime`.

- [ ] Scaffold/install `packages/ai-studio-runtime`.
- [ ] Move session runtime/store primitives:
  - `runtime.js`
  - `sessionStore.js`
  - `sessionDebugLog.js`
  - `sessionDebugLogCore.js`
  - `setupReadiness.js` if it remains runtime-owned
- [ ] Move workflow engine primitives:
  - `workflowMachine.js`
  - `workflowRegistry.js`
  - `workflowAdapter.js`
  - `workflowArtifacts.js`
  - `workflowCommandFacts.js`
  - `workflowCommandTerminal.js`
  - `workflowSessionActions.js`
- [ ] Move workflow definition modules/builders:
  - `workflow.js`
  - `workflowDefinitionBuilders.js`
  - `workflowStepFactories.js`
  - `workflowStepMachineHelpers.js`
  - `workflowStepMachines.js`
  - `registerCoreWorkflowModules.js`
  - `workflowModules/*`
- [ ] Move presentation only if it remains server-runtime owned:
  - `workflowPresentation.js`
- [ ] Update `@local/ai-studio-sessions` to depend on `@local/ai-studio-runtime`.
- [ ] Update `@local/ai-studio-project` only for runtime APIs it genuinely needs.
- [ ] Keep API route/action ownership in `@local/ai-studio-sessions`.
- [ ] Add contract tests around workflow registry, session creation, and presentation output.
- [ ] Run verification commands.

Completion criteria:

- `@local/ai-studio-sessions` is a JSKIT feature/API package over a runtime package.
- Workflow/session internals are not imported from app-global `server/lib`.
- Runtime depends on adapters through explicit package imports.

## Stage 3: Terminal Runtime Core

Create `@local/studio-terminal-core`.

- [ ] Scaffold/install `packages/studio-terminal-core`.
- [ ] Move terminal session/process primitives:
  - `server/lib/terminalSessions.js`
  - `server/lib/containerRuntime.js`
  - `server/lib/aiStudio/runtimeContainers.js`
- [ ] Move shared Studio runtime identity/tool-home primitives:
  - `server/lib/studioRuntimeIdentity.js`
  - `server/lib/studioToolHome.js`
  - relevant terminal cleanup/label helpers if shared
- [ ] Move shell command helpers if they are terminal-platform primitives:
  - `server/lib/shellCommands.js`
  - `server/lib/shellScript.js`
  - `server/lib/gitToolchainMounts.js`
- [ ] Update terminal, doctor, current-app, and setup packages to import from `@local/studio-terminal-core`.
- [ ] Keep terminal feature route/controller ownership in `@local/ai-studio-terminals`.
- [ ] Add or update tests around PTY lifecycle, container command specs, and websocket IO.
- [ ] Run verification commands.

Completion criteria:

- Terminal/process/container machinery is explicit shared infrastructure.
- `@local/ai-studio-terminals` owns terminal feature behavior, not low-level process primitives.
- Doctor/current-app packages no longer deep-import terminal primitives from `server/lib`.

## Stage 4: Setup Doctor Core

Create `@local/setup-doctor-core`.

- [ ] Scaffold/install `packages/setup-doctor-core`.
- [ ] Move doctor shared route/stream/cache/plugin primitives:
  - `doctorRoutes.js`
  - `doctorStream.js`
  - `doctorStatusCache.js`
  - `doctorPlugins.js`
  - `doctorPluginToolkit.js`
- [ ] Move doctor check/toolchain primitives:
  - `doctorCheckItems.js`
  - `doctorToolchain.js`
  - `doctorToolchainCommands.js`
- [ ] Move Git/GitHub setup helpers if they are doctor-owned:
  - `setupDoctorGit.js`
  - `githubRemote.js`
  - `githubRepoSetupScript.js`
- [ ] Update `studio-setup-doctor`, `adapter-setup-doctor`, `project-setup-doctor`, and `ai-studio-accounts` to import from `@local/setup-doctor-core`.
- [ ] Keep each doctor package as the owner of its service/actions/routes.
- [ ] Add or update tests around readiness, repair commands, and doctor route behavior.
- [ ] Run verification commands.

Completion criteria:

- Doctor packages share explicit doctor infrastructure.
- Doctor feature packages do not rely on app-global `server/lib` toolkits.

## Stage 5: Current App / Launch Ownership

- [ ] Audit current-app and launch-related files after stages 1-4.
- [ ] Move current-app-owned behavior directly into `@local/current-app`.
- [ ] Move adapter-specific launch inspection into `@local/ai-studio-adapters`.
- [ ] Move terminal/process launch plumbing into `@local/studio-terminal-core`.
- [ ] Ensure current-app package owns routes/actions/service only.
- [ ] Run verification commands.

Completion criteria:

- Current-app behavior is not split between package service code and hidden app-global implementation files.
- Adapter-specific launch behavior lives with adapters.

## Stage 6: Burn Down `server/lib`

- [ ] List remaining `packages/** -> server/lib/**` imports.
- [ ] Classify remaining imports as platform glue, compatibility shim, or missed domain code.
- [ ] Remove compatibility shims once no package imports them.
- [ ] Keep `server.js` and `server/lib` focused on app startup/platform concerns only:
  - runtime env
  - surface runtime
  - browser lifecycle
  - static serving helpers
  - startup cleanup, if not moved elsewhere
- [ ] Add a test or lint guard preventing feature packages from deep-importing `server/lib`.
- [ ] Run final `npx jskit app verify`.

Completion criteria:

- JSKIT feature packages own feature routes/actions/services.
- Shared implementation code lives in explicit local packages.
- `server.js` is platform glue.
- `server/lib` is no longer an undeclared package.
