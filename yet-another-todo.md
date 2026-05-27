# Yet Another TODO

This file tracks the current outstanding findings from the Vibe64 state-machine review.

Canonical product/design decisions live in `.jskit/APP_BLUEPRINT.md`.

## Original Finding Status

| Finding | Status |
| --- | --- |
| 1. Client autopilot still contains workflow recovery policy | Done |
| 2. Background Codex bootstrap is not visible enough | Done |
| 3. Session list/detail reads are pure but still heavy | Done |
| 4. Command action completion and session publishing are still loosely coupled | Done |
| 5. Skip-merge flow is still procedural | Done |
| 6. Non-command actions run inside the session mutation queue | Not to do by design |
| 7. `workflowStepMachines.js` is too large and repetitive | Done, targeted factories only |
| 8. Public payload still exposes raw autopilot definition | Done |
| 9. Numbered questions must remain UI sugar | Done |
| 10. Simple markdown does not parse pointlists | Done |

## Outstanding Findings

None.

## Explicit Non-TODOs

### Finding 6 - Keep Non-Command Actions Serialized

Evidence:

- `server/lib/vibe64/runtime.js`

Decision:

Do not split prompt/adapter/finish action handlers out of the per-session mutation queue by default.

Why:

- Vibe64 is an interactive, sequential workflow.
- Long-running prompt work is already made visible by the live Codex terminal.
- Long-running command work is already made visible by the command terminal.
- Releasing the mutation queue would add run-token state, stale completion handling, and extra recovery paths without a demonstrated UX gain.
- Sequential behavior is desirable: users should not be able to start the next workflow action while the current action is still being prepared or executed.

Only revisit this if timestamped logs show a real user-visible gap before the Codex/command terminal appears. This decision is documented in `.jskit/APP_BLUEPRINT.md`.

## Completed Findings

### Finding 3 - Session list reads are shallow; detail reads stay full

Changed files:

- `server/lib/vibe64/sessionStore.js`
- `server/lib/vibe64/runtime.js`
- `packages/vibe64-sessions/src/server/service.js`
- `src/composables/useVibe64SessionData.js`
- `src/components/studio/Vibe64SessionPanel.vue`
- `src/components/studio/ArchivedVibe64Sessions.vue`
- `tests/client/useVibe64SessionData.vitest.js`
- `tests/server/vibe64SessionStore.unit.test.js`
- `tests/server/vibe64SessionsService.unit.test.js`
- `tests/server/vibe64WorkflowMachine.unit.test.js`

Implemented:

- Added store/runtime session summary reads for `GET /sessions`.
- Kept `GET /sessions/:sessionId` as the full projected/enriched session detail read.
- Removed Codex terminal enrichment from list responses.
- Kept selected-session Run/Shell controls on the selected detail record, not the shallow list item.
- Added tests that list summaries omit detail-heavy fields such as `presentation`, `stepDefinitions`, `artifactReadiness`, `commandLifecycles`, and `codexTerminal`.

Verification:

- `node --test tests/server/vibe64SessionStore.unit.test.js tests/server/vibe64WorkflowMachine.unit.test.js tests/server/vibe64SessionsService.unit.test.js`
- `npx vitest run tests/client/useVibe64SessionData.vitest.js tests/client/vibe64SessionPanelModel.vitest.js`
- `npm run test:client`
- `npm run build`
- `npx playwright test --config playwright.config.ts tests/e2e/base-shell.spec.ts -g "session history"`
- `git diff --check`

### Finding 2 - Background Codex bootstrap is visible session state

Changed files:

- `server/lib/vibe64/sessionStore.js`
- `server/lib/vibe64/workflowPresentation.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `src/composables/useVibe64BackgroundTasks.js`
- `src/components/studio/vibe64-session/Vibe64BackgroundTasks.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64SessionCurrentStep.vue`
- `src/components/studio/vibe64-session/Vibe64SessionWorkspace.vue`
- `src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue`
- `tests/client/useVibe64BackgroundTasks.vitest.js`
- `tests/server/vibe64SessionStore.unit.test.js`
- `tests/server/vibe64TerminalsService.unit.test.js`
- `tests/server/vibe64WorkflowMachine.unit.test.js`

Implemented:

- Added durable session background-task records under `.vibe64/sessions/active/<session>/background-tasks/`.
- Codex bootstrap now writes `running`, `ready`, and `failed` task status from the actual bootstrap path.
- `presentation.backgroundTasks` exposes the status, timestamps, error, terminal id, and retry metadata.
- Autopilot and Inspect render failed/running background tasks and retry failed Codex bootstrap through the existing Codex terminal action.

Verification:

- `node --test tests/server/vibe64SessionStore.unit.test.js tests/server/vibe64TerminalsService.unit.test.js tests/server/vibe64WorkflowMachine.unit.test.js`
- `npx vitest run tests/client/useVibe64BackgroundTasks.vitest.js`
- `npm run test:client`
- `npm run build`
- `git diff --check`

### Finding 1 - Client autopilot uses server-owned recovery state

Changed files:

- `server/lib/vibe64/workflowPresentation.js`
- `server/lib/vibe64/sessionRealtimeEvents.js`
- `server/lib/vibe64/serverResponses.js`
- `server/lib/vibe64/runtime.js`
- `packages/vibe64-terminals/src/server/commandTerminal.js`
- `src/composables/useVibe64AutopilotController.js`
- `src/composables/useVibe64HeadlessCommandRunner.js`
- `src/composables/useVibe64SessionActions.js`
- `tests/client/useVibe64AutopilotController.vitest.js`
- `tests/server/vibe64WorkflowMachine.unit.test.js`
- `tests/server/vibe64SessionRealtimeEvents.unit.test.js`

Done:

- Server presentation now exposes explicit command and recovery state through `presentation.command` and `presentation.recovery`.
- Client autopilot no longer decides stuck recovery from local timers, raw step-machine age, or raw command lifecycle phases.
- Server stale/state-rejected operation responses include `operationOutcome`, `refreshRecommended`, and session revision context.
- Realtime session-change payloads include revision/current-step context when the changed session is available.
- Recovery remains an explicit user action; it is not auto-run by Autopilot.

### Prior completed finding: Centralized workflow presentation/intent contract

Evidence:

- `server/lib/vibe64/workflow.js`
- `server/lib/vibe64/workflowMachine.js`
- `server/lib/vibe64/workflowPresentation.js`
- `server/lib/vibe64/workflowStepMachines.js`
- `tests/server/vibe64WorkflowMachine.unit.test.js`

Previous problem:

Step definitions were split across the workflow profile, step machines, presentation code, intent dispatch, and autopilot projection.

Done:

- Made the workflow catalog the canonical place for declarative presentation and intent contract data.
- Kept evaluated autopilot state server-internal.
- Moved public presentation generation to read from the centralized workflow metadata.

### Finding 7 - Targeted workflow machine factories

Evidence:

- `server/lib/vibe64/workflowStepMachines.js`
- `tests/server/vibe64WorkflowMachine.unit.test.js`

Previous problem:

The original finding was too broad. The step machines are repetitive, but most of that repetition is step-specific workflow meaning and should stay explicit. The genuinely repeated classes are interactive AI conversation turns and editable artifact review turns.

Done:

- Added a `createChatWithAiMachine` factory.
- Reused it for `agent_conversation`, `maintenance_conversation`, `implementation_reviewed`, and `changes_accepted`.
- Made completion ownership configurable: user-decided chat turns say the user decides when to continue; AI-decided tweak turns include an explicit `enoughWhen` condition in the prompt contract.
- Added a `createEditableArtifactReviewMachine` factory.
- Reused it for `issue_file_created`, `seed_application_defined`, and `create_pull_request`.
- Kept draft origin explicit: issue and seed start with user-provided editable fields; pull request starts with an AI-created draft and only shows editable fields after Codex submits the draft.
- Kept command execution declarative by action id and completion metadata instead of passing arbitrary command functions through the machine.
- Left the other prompt, command, review, and input machines unfactored by design.

### Finding 5 - Skip-merge flow is declarative

Evidence:

- `server/lib/vibe64/workflow.js`
- `server/lib/vibe64/workflowPresentation.js`
- `tests/server/vibe64WorkflowMachine.unit.test.js`

Previous problem:

Skip merge recorded declarative readiness metadata, but the intent handler still owned the follow-through with a skip-specific bounded advance loop and a hard-coded main-checkout special case.

Done:

- Replaced the skip-specific server operation with generic `sequence` and `advance_to_step` operations.
- Moved the skip-merge intent behavior into the workflow catalog: run `skip_merge`, write `merge_skipped`, then advance to `session_finished`.
- Removed the hard-coded `continueAfterSkipMerge` path from presentation code.

### Finding 4 - Command lifecycle is explicit

Evidence:

- `server/lib/vibe64/sessionStore.js`
- `packages/vibe64-terminals/src/server/commandTerminal.js`
- `src/composables/useVibe64AutopilotController.js`
- `tests/server/vibe64SessionStore.unit.test.js`
- `tests/server/vibe64TerminalsService.unit.test.js`
- `tests/client/useVibe64AutopilotController.vitest.js`

Previous problem:

Command result persistence, advance-on-success, post-commit publishing, and background follow-up effects were separate phases with no single durable lifecycle record. The client had to infer completion from terminal exit plus `attempting_execution` refresh timing.

Done:

- Added persisted per-command lifecycle records under each session.
- Recorded command phases including `starting`, `started`, `terminal_exited`, `result_writing`, `result_written`, `advanced`, `post_commit_running`, `done`, and `failed`.
- Kept command terminal completion independent from slow post-commit effects.
- Exposed the latest current-step lifecycle in the session payload.
- Updated autopilot completion waiting to stop polling when the server lifecycle says result application has finished.

### Finding 9 - Numbered questions remain UI sugar

Evidence:

- `.jskit/APP_BLUEPRINT.md`
- `src/lib/vibe64NumberedQuestionSugar.js`
- `src/composables/useVibe64StepInputForm.js`
- `tests/client/vibe64NumberedQuestionSugar.vitest.js`
- `tests/client/useVibe64StepInputForm.vitest.js`

Previous problem:

The product decision was correct, but the implementation did not make the client-only contract obvious enough. Generated question field names looked like possible server payload fields, and the parser lived inside the step-input composable.

Done:

- Kept the server contract as one prompt/message and one logical `response` field.
- Extracted numbered-question handling into a client-only UI-sugar helper.
- Generated private UI field names such as `__ui_question_1`.
- Added tests that structured server input is not reinterpreted and that submit payloads contain only one `response` field.

### Finding 8 - Public payload no longer exposes raw autopilot definition

Evidence:

- `server/lib/vibe64/workflowMachine.js`
- `tests/client/dumbClientOwnership.vitest.js`

Previous problem:

The client is tested not to read `currentStepDefinition.autopilot`, but the public payload still exposes it.

Done:

- Removed `currentStepDefinition.autopilot` from normal public session payloads.
- Kept evaluated autopilot state server-internal for `presentation.auto.nextOperation`.
- Added server test coverage that the raw autopilot field is absent while the presentation operation is still present.

### Finding 10 - Simple markdown parses pointlists

Evidence:

- `src/lib/studioLongTextBlocks.js`
- `tests/client/studioLongTextBlocks.vitest.js`

Previous problem:

The simple markdown parser handles `-`, `*`, `+`, and ordered lists, but not point/bullet list forms like `• item`.

Done:

- Extend unordered list parsing to include point bullets such as `•`.
- Add tests for pointlists.
