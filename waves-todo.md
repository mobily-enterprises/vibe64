# State Machine Fix Waves

This plan slices the state-machine cleanup so agents can work with minimal collision risk. The main rule is that only one worker should edit the state-machine spine at a time:

- `server/lib/vibe64/runtime.js`
- `server/lib/vibe64/workflowStepMachines.js`
- `server/lib/vibe64/workflowPresentation.js`
- `server/lib/vibe64/workflowMachine.js`

## Wave 0: Read-Only Mapping

Status: completed

Purpose: identify the exact server and client mutation/control paths before implementation.

Agents:

- Server mutation map
  - Type: explorer
  - Edit scope: none
  - Read scope:
    - `server/lib/vibe64/*`
    - `packages/vibe64-*/*/server/*`
  - Output:
    - Every place that writes session state, step state, metadata, artifacts, terminal results, or publishes session changes.
    - Any path where a read can mutate state.
    - Any race-prone or duplicate mutation path.
    - File and line references.

- Client workflow map
  - Type: explorer
  - Edit scope: none
  - Read scope:
    - `src/composables/*Vibe64*`
    - Vibe64 runtime/autopilot/session components
  - Output:
    - Every place the client advances, refreshes, retries, infers state, or starts terminal work.
    - Any duplicate client/server responsibility.
    - Any stale-snapshot or optimistic UI path.
    - File and line references.

Exit criteria:

- Server mutation paths are cataloged. Completed.
- Client control paths are cataloged. Completed.
- Wave 1 implementation scope is confirmed. Completed.

### Wave 0 Findings

Server mutation map:

- Core durable writers live in `server/lib/vibe64/sessionStore.js`.
- `runtime.advance`, `workflowPresentation.forceAdvanceCurrentStep`, session creation, intent handling, and command-terminal close all have paths that can advance or mutate session state.
- `runtime.rewind` can delete action, artifact, completed-step, metadata, and step-state records while terminal close callbacks can still write late results.
- `getSession` and `listSessions` call `sessionView`, which calls `applyStepMachineView`; that path can initialize or transition step state, so read paths are not pure.
- Artifact preview/readiness, terminal status, Codex terminal state, launch status, inspect, diff, and list paths can inherit the read-side mutation problem when they call `runtime.getSession`.
- Session events are split between provider service events and manual publishers, especially around terminal controllers.

Client workflow map:

- Session create, advance, action, intent, rewind, current-step input, manual command terminal, headless command terminal, and Codex terminal start paths are all client-triggered from Vibe64 composables/components.
- The client still auto-advances after normal action success in `useVibe64SessionActions.js`.
- The client still auto-advances after manual command-terminal completion in `useVibe64SessionCommandTerminal.js`; this overlaps with server command completion advancement.
- Autopilot uses `presentation.auto.nextOperation`, but `session-advance` still flows through `advanceSession`, which also gates on `session.next.enabled`.
- Client freshness is inferred locally in `useVibe64SessionData.js` instead of using a server revision.
- Autopilot has stale-command and delayed-progress compensation around command execution and `attempting_execution`.

Confirmed Wave 1 scope additions:

- Include `server/lib/vibe64/sessionStore.js`; it is the durable write boundary.
- Include `server/lib/vibe64/sessionRealtimeEvents.js`; event publication needs to align with the mutation contract.
- Include package providers/services for sessions, artifacts, and terminals because their read/status paths can invoke session views and their event paths are split.
- Include command, Codex, launch, shell terminal controllers as mutation/event participants.

Confirmed Wave 2 scope additions:

- Include `src/composables/useVibe64SessionActions.js`; it owns manual action and advance behavior.
- Include `src/composables/useVibe64SessionCommandTerminal.js` and `src/composables/useVibe64CommandTerminalController.js`; they own manual command terminal settle behavior.
- Include `src/composables/useVibe64AutopilotController.js` and `src/composables/useVibe64HeadlessCommandRunner.js`; they own headless command/autopilot behavior.
- Include `src/composables/useVibe64SessionData.js`; it owns list/detail freshness merging.
- Include `src/composables/useVibe64StepInputForm.js` and `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`; step input can immediately continue from stale state.

## Wave 1: Server State Contract

Status: completed

Use one worker only.

Owner files:

- `server/lib/vibe64/runtime.js`
- `server/lib/vibe64/workflowStepMachines.js`
- `server/lib/vibe64/workflowMachine.js`
- `server/lib/vibe64/workflowPresentation.js`
- `packages/vibe64-sessions/src/server/service.js`
- related tests

Tasks:

- Make `inspectSession`, `listSessions`, and `getSession` pure reads.
- Remove writes from step `view()` paths.
- Add per-session mutation serialization.
- Add durable session revision or updated timestamp.
- Route advance, rewind, intent, action completion, and command completion through the same mutation path.

Exit criteria:

- Read paths do not change session files. Completed.
- Mutations are serialized per session. Completed.
- State-changing endpoints use the shared mutation contract. Completed.
- Tests cover read purity and conflicting mutation attempts. Completed.

### Wave 1 Outcome

Changed files:

- `server/lib/vibe64/sessionStore.js`
- `server/lib/vibe64/runtime.js`
- `server/lib/vibe64/workflowPresentation.js`
- `server/lib/vibe64/workflowStepMachines.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-terminals/src/server/commandTerminal.js`
- `packages/vibe64-terminals/src/server/launchTargetTerminal.js`
- `tests/server/vibe64SessionStore.unit.test.js`
- `tests/server/vibe64WorkflowMachine.unit.test.js`

Implemented:

- Added a process-local per-session mutation queue in the session store.
- Added durable session `revision` and `updatedAt` markers.
- Exposed revision/update markers in session views.
- Made step-machine read/view paths compute missing or derived state in memory without writing.
- Routed advance, force-advance, rewind, action execution, current-step input, workflow intents, command action start/finish, command terminal completion, and related terminal metadata writes through the mutation boundary.
- Added stale-step protection for command terminal completion.
- Added focused tests for read purity and mutation serialization/revision behavior.

Verification:

- `git diff --check`
- `node --test tests/server/vibe64SessionStore.unit.test.js tests/server/vibe64WorkflowMachine.unit.test.js tests/server/vibe64ArtifactsService.unit.test.js tests/server/vibe64TerminalsService.unit.test.js tests/server/vibe64SessionsService.unit.test.js`
- `npm test`

Remaining risk:

- The mutation queue is process-local. It serializes this app process but is not a cross-process file lock if multiple Node processes mutate the same `.vibe64` session directory concurrently.

## Wave 2: Command Completion And Client Advance

Status: completed

Use two workers after Wave 1 lands.

Agents:

- Server command worker
  - Owner files:
    - `packages/vibe64-terminals/src/server/commandTerminal.js`
    - terminal service tests
  - Tasks:
    - Make command completion publish visible status quickly.
    - Ensure successful command completion advances only through the server mutation path.
    - Make terminal completion independent from slow bootstrap or session publishing.

- Client command/autopilot worker
  - Owner files:
    - `src/composables/useVibe64SessionCommandTerminal.js`
    - `src/composables/useVibe64AutopilotController.js`
    - `src/composables/useVibe64SessionData.js`
  - Tasks:
    - Remove client-side terminal `goNext()` after success.
    - Use server revision instead of freshness scoring where possible.
    - Keep bounded refresh/retry only where the server contract still requires it.

Exit criteria:

- Command success has one authoritative advance path. Completed.
- Inspect mode no longer performs stale duplicate advances after terminal completion. Completed.
- Autopilot uses server state instead of stale local inference where possible. Completed.

### Wave 2 Outcome

Changed files:

- `packages/vibe64-terminals/src/server/commandTerminal.js`
- `packages/vibe64-terminals/src/server/service.js`
- `src/composables/useVibe64CommandTerminalController.js`
- `src/composables/useVibe64SessionActions.js`
- `src/composables/useVibe64SessionCommandTerminal.js`
- `src/composables/useVibe64SessionData.js`
- `tests/client/useVibe64AutopilotController.vitest.js`
- `tests/client/useVibe64SessionCommandTerminal.vitest.js`
- `tests/client/useVibe64SessionData.vitest.js`
- `tests/server/vibe64TerminalsService.unit.test.js`

Implemented:

- Removed client-side auto-advance after manual command-terminal completion.
- Removed client-side auto-advance after normal action success.
- Forwarded manual command terminal `advanceOnSuccess` to the server command-terminal API.
- Kept command success advancement server-owned through the Wave 1 runtime mutation path.
- Moved command terminal publish/bootstrap effects after durable command completion.
- Added revision-aware stale terminal close protection for advance-and-rewind cases.
- Replaced client selected-session freshness scoring with server `revision` / `updatedAt` comparison.
- Updated tests so command success progress is modeled as server state publication rather than a client `advanceSession()` call.

Verification:

- `git diff --check`
- `node --test tests/server/vibe64TerminalsService.unit.test.js tests/server/vibe64WorkflowCommandTerminal.unit.test.js`
- `npx vitest run tests/client/useVibe64SessionCommandTerminal.vitest.js tests/client/useVibe64SessionData.vitest.js tests/client/useVibe64AutopilotController.vitest.js tests/client/dumbClientOwnership.vitest.js tests/client/useVibe64HeadlessCommandRunner.vitest.js`
- `npm run test:client`
- `npm test`
- `npm run test:e2e`
- `npm run build`

Remaining risk:

- Command terminal stale-close detection uses session revision, so unrelated session mutations during a long-running command can conservatively suppress a late command result. This is safer than writing results into an advanced/rewound state, but it may need a narrower command-run token if unrelated concurrent metadata updates become common.

## Wave 3: Presentation And Step Architecture

Status: completed

Use one worker only, or defer until correctness fixes are stable.

Owner files:

- `server/lib/vibe64/workflowPresentation.js`
- `server/lib/vibe64/workflowStepMachines.js`
- `server/lib/vibe64/workflow.js`
- presentation/state snapshot tests

Tasks:

- Move presentation, intents, automation, inputs, and transition behavior closer to step definitions.
- Reduce hard-coded step and action interpretation in `workflowPresentation.js`.
- Make step status, interaction, next operation, and client affordances come from one server-side projection.

Exit criteria:

- Step behavior and step presentation are no longer maintained in separate hard-coded maps. Completed.
- Snapshot tests cover key workflow profiles and states. Completed.

### Wave 3 Outcome

Changed files:

- `server/lib/vibe64/workflow.js`
- `server/lib/vibe64/workflowPresentation.js`
- `server/lib/vibe64/index.js`
- `tests/server/vibe64WorkflowMachine.unit.test.js`

Implemented:

- Added step-owned presentation metadata for conversation, review, optional decision, merge, and finished workflow stops.
- Made the workflow presentation projector consume step metadata for stop screens, decision screens, server-owned intents, and special automation operations.
- Moved final-review recheck and merge-and-sync automation triggers behind step metadata instead of hard-coded current-step checks.
- Preserved generic presentation fallbacks for states without explicit presentation metadata.
- Added runtime presentation snapshots covering representative workflow profiles and stop states.

Verification:

- `node --test tests/server/vibe64WorkflowMachine.unit.test.js`
- `npm test`
- `npm run test:client`
- `npm run build`
- `npx eslint server/lib/vibe64/workflow.js server/lib/vibe64/workflowPresentation.js server/lib/vibe64/index.js tests/server/vibe64WorkflowMachine.unit.test.js`
- `git diff --check`

## Wave 4: Low-Risk Cleanup

Status: completed

Use two or three workers in parallel.

Agents:

- Debug helper cleanup
  - Owner files:
    - `server/lib/vibe64/sessionDebugLog.js`
    - `src/lib/vibe64SessionDebugLog.js`
    - any shared module needed
  - Task: remove duplicate logging helper logic while keeping server/client wrappers.

- Dead code and misleading API cleanup
  - Owner files:
    - `src/composables/useVibe64SessionActions.js`
    - `packages/vibe64-sessions/src/server/Vibe64SessionsProvider.js`
    - `packages/vibe64-sessions/src/server/service.js`
  - Task: remove or intentionally wire dead values such as `waitingForPromptedArtifact` and unused service parameters.

- Workflow validation cleanup
  - Owner files:
    - `server/lib/vibe64/workflowMachine.js`
    - workflow tests
  - Task: validate condition DSL at workflow load or test time instead of discovering unknown conditions at runtime.

Exit criteria:

- Duplicate utility code is reduced. Completed.
- Dead code is removed or made intentional. Completed.
- Invalid workflow conditions fail early. Completed.

### Wave 4 Outcome

Changed files:

- `server/lib/vibe64/sessionDebugLogCore.js`
- `server/lib/vibe64/sessionDebugLog.js`
- `src/lib/vibe64SessionDebugLog.js`
- `src/composables/useVibe64SessionActions.js`
- `packages/vibe64-sessions/src/server/Vibe64SessionsProvider.js`
- `tests/server/vibe64SessionsService.unit.test.js`
- `tests/server/vibe64TerminalsService.unit.test.js`
- `server/lib/vibe64/workflowMachine.js`
- `tests/server/vibe64WorkflowMachine.unit.test.js`

Implemented:

- Moved the duplicated Vibe64 session debug logger implementation behind one shared core while keeping server and client wrapper import paths.
- Removed the constant-false `waitingForPromptedArtifact` client value.
- Removed unused `publishSessionChanged` plumbing from the sessions provider and related tests; session change publication remains wired through service events.
- Added workflow condition DSL validation during workflow construction, including recursive `any:` checks and malformed condition errors.
- Widened one command-terminal post-commit test timeout so the test still catches hook-blocking regressions without failing under full-suite load.

Verification:

- `node --test tests/server/vibe64WorkflowMachine.unit.test.js`
- `node --test tests/server/vibe64SessionsService.unit.test.js tests/server/vibe64SessionRealtimeEvents.unit.test.js`
- `node --test tests/server/vibe64TerminalsService.unit.test.js`
- `npx vitest run tests/client/dumbClientOwnership.vitest.js`
- `npm test`
- `npm run test:client`
- `npx vite build`
- `npx eslint server/lib/vibe64/sessionDebugLogCore.js server/lib/vibe64/sessionDebugLog.js src/lib/vibe64SessionDebugLog.js`

## Wave 5: UX And Data Shape Cleanup

Status: completed

Use one worker.

Owner files:

- `src/composables/useVibe64StepInputForm.js`

Tasks:

- Keep numbered-question rendering as client-only UI sugar over the existing single prompt/message contract.
- Keep current-step input submission as one response value; do not add a separate server question/answer shape.

Exit criteria:

- Client form can render the supported numbered-question format as separate fields. Completed.
- Client submits numbered answers back as one response value. Completed.
- Server-owned input shape stays unchanged. Completed.

### Wave 5 Outcome

Changed files:

- `tests/client/useVibe64StepInputForm.vitest.js`
- `waves-todo.md`

Implemented:

- Preserved the current server contract: a direct current-step input still carries one `response` field/message.
- Kept the numbered-question behavior as UI-only rendering sugar for plain response prompts.
- Added coverage that the sugar only applies to a single plain response field, so already-structured server input is not reinterpreted.

Verification:

- `npx vitest run tests/client/useVibe64StepInputForm.vitest.js`

## Recommended Execution Order

1. Run Wave 0 explorers.
2. Run Wave 1 with one server-state worker.
3. Run Wave 2 with two workers.
4. Dogfood non-commit maintenance in autopilot and inspect mode.
5. Run Wave 4 cleanup.
6. Run Wave 3 architecture cleanup only after behavior is stable.
7. Run Wave 5 if structured input still matters.
