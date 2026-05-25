# Yet Another TODO

This file tracks the current outstanding findings from the AI Studio state-machine review.

Canonical product/design decisions live in `.jskit/APP_BLUEPRINT.md`.

## Original Finding Status

| Finding | Status |
| --- | --- |
| 1. Client autopilot still contains workflow recovery policy | Outstanding |
| 2. Background Codex bootstrap is not visible enough | Outstanding |
| 3. Session list/detail reads are pure but still heavy | Outstanding |
| 4. Command action completion and session publishing are still loosely coupled | Done |
| 5. Skip-merge flow is still procedural | Done |
| 6. Non-command actions run inside the session mutation queue | Not to do by design |
| 7. `workflowStepMachines.js` is too large and repetitive | Done, targeted factories only |
| 8. Public payload still exposes raw autopilot definition | Done |
| 9. Numbered questions must remain UI sugar | Done |
| 10. Simple markdown does not parse pointlists | Done |

## Outstanding Findings

### Finding 1 - P1 High: Client autopilot still contains workflow recovery policy

Evidence:

- `src/composables/useAiStudioAutopilotController.js`
- `server/lib/aiStudio/sessionRealtimeEvents.js`

Problem:

The client still knows too much about stale command starts, operation key drift, command-completion polling, and stuck execution recovery. That code exists because the server operation/realtime contract does not return enough lifecycle truth.

Tackle:

- Include session revision/state details in realtime events or operation responses.
- Make command-terminal completion return a clear post-operation state.
- Keep the client as a transport/retry shell over explicit server lifecycle states.

### Finding 2 - P1 High: Background Codex bootstrap is not visible enough

Evidence:

- `packages/ai-studio-terminals/src/server/commandTerminal.js`
- `packages/ai-studio-terminals/src/server/service.js`

Problem:

Successful command completion schedules Codex thread/bootstrap work in the background. Failures are logged but not represented as durable, visible session state.

Tackle:

- Persist a visible background task/bootstrap status on the session.
- Surface status in `presentation.terminal` or a dedicated `presentation.backgroundTasks` block.
- Add recovery/retry action when bootstrap fails.

### Finding 3 - P2 Medium: Session list/detail reads are pure but still heavy

Evidence:

- `server/lib/aiStudio/runtime.js`
- `packages/ai-studio-sessions/src/server/service.js`

Problem:

Listing sessions builds full projected views and enriches open sessions with Codex terminal state. This is read-only now, but still does unnecessary work for list views.

Tackle:

- Make list payload intentionally shallow.
- Keep full projection/enrichment for selected session detail.
- Batch terminal-state reads if list enrichment remains necessary.

## Explicit Non-TODOs

### Finding 6 - Keep Non-Command Actions Serialized

Evidence:

- `server/lib/aiStudio/runtime.js`

Decision:

Do not split prompt/adapter/finish action handlers out of the per-session mutation queue by default.

Why:

- AI Studio is an interactive, sequential workflow.
- Long-running prompt work is already made visible by the live Codex terminal.
- Long-running command work is already made visible by the command terminal.
- Releasing the mutation queue would add run-token state, stale completion handling, and extra recovery paths without a demonstrated UX gain.
- Sequential behavior is desirable: users should not be able to start the next workflow action while the current action is still being prepared or executed.

Only revisit this if timestamped logs show a real user-visible gap before the Codex/command terminal appears. This decision is documented in `.jskit/APP_BLUEPRINT.md`.

## Completed Findings

### Prior completed finding: Centralized workflow presentation/intent contract

Evidence:

- `server/lib/aiStudio/workflow.js`
- `server/lib/aiStudio/workflowMachine.js`
- `server/lib/aiStudio/workflowPresentation.js`
- `server/lib/aiStudio/workflowStepMachines.js`
- `tests/server/aiStudioWorkflowMachine.unit.test.js`

Previous problem:

Step definitions were split across the workflow profile, step machines, presentation code, intent dispatch, and autopilot projection.

Done:

- Made the workflow catalog the canonical place for declarative presentation and intent contract data.
- Kept evaluated autopilot state server-internal.
- Moved public presentation generation to read from the centralized workflow metadata.

### Finding 7 - Targeted workflow machine factories

Evidence:

- `server/lib/aiStudio/workflowStepMachines.js`
- `tests/server/aiStudioWorkflowMachine.unit.test.js`

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

- `server/lib/aiStudio/workflow.js`
- `server/lib/aiStudio/workflowPresentation.js`
- `tests/server/aiStudioWorkflowMachine.unit.test.js`

Previous problem:

Skip merge recorded declarative readiness metadata, but the intent handler still owned the follow-through with a skip-specific bounded advance loop and a hard-coded main-checkout special case.

Done:

- Replaced the skip-specific server operation with generic `sequence` and `advance_to_step` operations.
- Moved the skip-merge intent behavior into the workflow catalog: run `skip_merge`, write `merge_skipped`, then advance to `session_finished`.
- Removed the hard-coded `continueAfterSkipMerge` path from presentation code.

### Finding 4 - Command lifecycle is explicit

Evidence:

- `server/lib/aiStudio/sessionStore.js`
- `packages/ai-studio-terminals/src/server/commandTerminal.js`
- `src/composables/useAiStudioAutopilotController.js`
- `tests/server/aiStudioSessionStore.unit.test.js`
- `tests/server/aiStudioTerminalsService.unit.test.js`
- `tests/client/useAiStudioAutopilotController.vitest.js`

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
- `src/lib/aiStudioNumberedQuestionSugar.js`
- `src/composables/useAiStudioStepInputForm.js`
- `tests/client/aiStudioNumberedQuestionSugar.vitest.js`
- `tests/client/useAiStudioStepInputForm.vitest.js`

Previous problem:

The product decision was correct, but the implementation did not make the client-only contract obvious enough. Generated question field names looked like possible server payload fields, and the parser lived inside the step-input composable.

Done:

- Kept the server contract as one prompt/message and one logical `response` field.
- Extracted numbered-question handling into a client-only UI-sugar helper.
- Generated private UI field names such as `__ui_question_1`.
- Added tests that structured server input is not reinterpreted and that submit payloads contain only one `response` field.

### Finding 8 - Public payload no longer exposes raw autopilot definition

Evidence:

- `server/lib/aiStudio/workflowMachine.js`
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
