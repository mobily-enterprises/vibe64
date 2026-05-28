# Dumb Client Ownership Checklist

## Execution Status

- [x] Server derives `session.presentation` from workflow/step-machine state and returns it with the session view.
- [x] Server exposes current-screen `intents` beside current-step `actions`.
- [x] Server handles intent dispatch through `POST /api/vibe64/sessions/:sessionId/intents/:intentId`.
- [x] Intent dispatch validates current availability, enablement, and optional stale `stepId`/`stepStatus`.
- [x] Review, final-review follow-up, merge, skip-merge, optional-check, conversation, continue, and archive choices are server-declared intents.
- [x] Autopilot client control logic no longer imports or branches on workflow-specific step IDs or action IDs.
- [x] Autopilot client executes only generic server operations: `advance`, `action`, `intent`, `wait`, and `stop`.
- [x] Autopilot view renders server-provided screen title, message, sections, and intents.
- [x] Numbered questions remain client-only rendering sugar and submit only the original logical `response` field.
- [x] Added a client source-scan drift guard for forbidden workflow vocabulary in Autopilot runtime files.
- [x] Added focused server unit coverage for presentation, intents, stale intent rejection, final-review follow-up, merge intent, and skip-merge intent.
- [x] Added focused client unit coverage for generic Autopilot operation execution and intent dispatch.
- [x] Added focused Playwright coverage for server-rendered presentation/intents and numbered-question submit shape.
- [x] Wired focused Playwright coverage into `npm run test:e2e`.
- [x] Verified with `npm test`, `npm run test:client`, `npm run test:e2e`, `npm run build`, and `npm run lint`.

## Goal

Make Vibe64 workflow ownership unambiguous:

- [x] Server owns workflow meaning.
- [x] Server owns current step, available actions, available intents, next availability, prompts, and step-machine state.
- [x] Server decides what the current workflow screen means.
- [x] Client renders the server-provided view.
- [x] Client dispatches server-provided actions or intents without knowing workflow-specific step IDs.
- [x] Client may keep generic transport mechanics: Codex prompt injection, terminal streaming, form rendering, and refresh loops.
- [x] Numbered questions remain pure UI sugar and never become persisted workflow state.
- [x] The resulting architecture is simple, readable, and easy to follow.
- [x] The code explains the product model through clear names and direct control flow.
- [x] Prefer expressive modern JavaScript over clever abstractions.
- [x] Avoid tricky code, hidden indirection, dynamic magic, or generic frameworks inside the feature.

## Simplicity Contract

- [ ] A new engineer can trace "server builds current view, client renders it, client dispatches action/intent" without jumping through many abstraction layers.
- [ ] Server presentation building is explicit and boring.
- [ ] Intent execution is explicit and boring.
- [ ] Client rendering is explicit and boring.
- [ ] Keep functions small enough that each one has one reason to exist.
- [ ] Name concepts after the product behavior, not implementation tricks.
- [ ] Use plain objects, arrays, maps, and direct functions unless a stronger abstraction clearly pays for itself.
- [ ] Do not introduce a generic workflow DSL beyond what already exists unless it removes more complexity than it adds.
- [ ] Do not introduce a generic client screen engine that requires reading metadata conventions to understand basic rendering.
- [ ] Do not hide important workflow decisions behind callbacks with vague names like `handle`, `process`, `resolve`, or `apply` without concrete context.
- [ ] Do not use stringly-typed mini languages for new presentation or intent logic.
- [ ] Prefer `switch` or explicit lookup tables over nested condition mazes when mapping a known set of screen/intent kinds.
- [ ] Prefer named helpers over inline complex boolean expressions.
- [ ] Keep server ownership code close to the workflow and step-machine code that gives it meaning.
- [ ] Keep client renderer code close to the components that render it.
- [ ] Add comments only where they explain a non-obvious product rule or ownership boundary.
- [ ] Do not add comments that restate the code.
- [ ] Every new file introduced for this refactor needs a clear, narrow purpose.
- [ ] If a helper's purpose cannot be explained in one sentence, split it or inline it.
- [ ] Refactor toward fewer places to look, not more.

## Non-Negotiable Boundary

- [x] No workflow-specific step IDs in Autopilot client control logic.
- [x] No workflow-specific action IDs in Autopilot client control logic unless the ID came from the current server response and is treated as opaque.
- [x] No client-side decisions like "if current step is `pr_merged`, show merge screen."
- [x] No client-side decisions like "rewind to `plan_made` unless `seed_plan_made` exists."
- [x] No client-side compound workflow sequences such as "prepare, merge, advance, sync."
- [x] No client-side ownership of review semantics.
- [x] No client-side ownership of merge semantics.
- [x] No client-side ownership of optional-check semantics.
- [x] Client may branch on generic render primitives only, such as `screen.kind`, `action.type`, `intent.type`, `field.kind`, and terminal/prompt transport state.
- [x] Every migrated ownership slice must be confirmed with a focused Playwright test/check before the slice is considered complete.
- [x] Focused Playwright checks must verify the user-visible rendered behavior and the dispatched request/intent/action, not just internal computed state.

## Current Ownership Leak Inventory

- [ ] Inventory all hard-coded workflow step IDs in `src/`.
- [ ] Inventory all hard-coded workflow action IDs in `src/`.
- [ ] Separate harmless fixtures/tests from runtime control logic.
- [ ] Mark every runtime client reference to these as an ownership bug unless it is an opaque value received from the server:
  - [ ] `issue_file_created`
  - [ ] `deep_ui_check_run`
  - [ ] `session_finished`
  - [ ] `local_session_finished`
  - [ ] `implementation_reviewed`
  - [ ] `main_checkout_synced`
  - [ ] `pr_merged`
  - [ ] `project_validated`
  - [ ] `changes_accepted`
  - [ ] `review_run`
  - [ ] `session_created`
  - [ ] `work_source_selected`
  - [ ] `plan_made`
  - [ ] `seed_plan_made`
- [ ] Mark every runtime client reference to these as an ownership bug unless it is an opaque value received from the server:
  - [ ] `agent_conversation`
  - [ ] `final_review_conversation`
  - [ ] `human_review_conversation`
  - [ ] `finish_session`
  - [ ] `prepare_for_merge`
  - [ ] `merge_pr`
  - [ ] `skip_merge`
  - [ ] `make_plan`
  - [ ] `make_seed_plan`
  - [ ] `run_deep_ui_check`
- [ ] Write down which current client branches are generic transport mechanics and can stay.
- [ ] Write down which current client branches are workflow meaning and must move server-side.

## Server Presentation Model

- [ ] Add a server-owned presentation object to the session view.
- [ ] Keep presentation derived; do not make it a separate durable state source.
- [ ] Include enough information for the client to render the current workflow screen without step-ID knowledge.
- [ ] Keep the presentation builder readable as a direct mapping from current server state to current UI model.
- [ ] Keep presentation object shapes stable and plain.
- [ ] Avoid nested presentation structures deeper than necessary for rendering.
- [ ] Avoid computed field names and dynamic object mutation where explicit properties are clearer.
- [ ] Proposed shape:

```js
presentation: {
  screen: {
    kind: "form" | "progress" | "review" | "merge" | "decision" | "finished" | "failure" | "idle",
    title: "",
    message: "",
    variant: "",
    sections: []
  },
  actions: [],
  intents: [],
  next: {},
  prompt: {},
  terminal: {},
  auto: {}
}
```

- [ ] Decide whether `presentation.actions` is an alias of `session.actions` or a screen-scoped subset.
- [ ] Keep `session.actions` as the authoritative atomic action list for compatibility during migration.
- [ ] Ensure `presentation.screen.kind` is generic enough for the client to render reusable layouts.
- [ ] Ensure `presentation.screen.variant` can distinguish server-owned variants, such as implementation review versus final review, without exposing step IDs.
- [ ] Ensure all labels, titles, messages, button text, and disabled reasons come from the server.
- [x] Ensure `currentStepDefinition.autopilot.kind` is either replaced by `presentation` or reduced to a server-private implementation detail.
- [ ] Add a short server-side comment or doc block explaining that presentation is derived view state, not durable workflow truth.
- [ ] Add focused Playwright coverage that loads a session fixture and confirms the client renders `presentation.screen` title/message/actions without deriving workflow-specific UI locally.

## Server Intent Model

- [ ] Add server-owned intents for higher-level workflow choices.
- [ ] Keep actions for atomic operations.
- [ ] Use intents for compound or semantic operations.
- [ ] Keep each intent handler explicit; do not create a clever generic intent pipeline.
- [ ] Keep intent validation easy to read: current session, current intent, enabled, stale state, execute.
- [ ] Keep compound intent sequences written in direct order with clear step names.
- [ ] Do not encode compound behavior in data strings that require a separate interpreter.
- [ ] Proposed intent fields:

```js
{
  id: "accept_review",
  label: "Looks good, continue",
  type: "workflow_intent",
  enabled: true,
  disabledReason: "",
  inputFields: [],
  confirm: null
}
```

- [ ] Add a route for dispatching current server-provided intents.
- [ ] Proposed endpoint:

```http
POST /api/vibe64/sessions/:sessionId/intents/:intentId
```

- [ ] Require the intent to exist in the current server session view.
- [ ] Require the intent to be enabled.
- [ ] Reject stale intent submissions with current step/status information.
- [ ] Include `stepId` and `stepStatus` in intent submissions where the intent depends on current step-machine state.
- [ ] Return the refreshed session view after every intent.
- [ ] Do not let clients pass target step IDs for workflow intents.
- [ ] If an intent waits for input, define that input shape server-side with `inputFields`.
- [ ] Add focused unit tests around intent handlers before adding more abstraction.
- [ ] Add focused Playwright coverage that clicks a server-provided intent and confirms the client sends the generic intent request, not a workflow-specific client sequence.

## Atomic Actions

- [ ] Keep `session.actions` as server-filtered current-step actions.
- [ ] Client renders only server-provided actions.
- [ ] Client disables actions where `enabled !== true`.
- [ ] Client displays server-provided `disabledReason`.
- [ ] Client does not create actions from the workflow catalog.
- [ ] Client does not infer hidden actions.
- [ ] Client does not map step IDs to action IDs.
- [ ] Server remains responsible for action visibility and enablement.
- [ ] Server remains responsible for action effects.
- [ ] Keep action rendering as a simple list render.
- [ ] Keep disabled behavior obvious: `enabled !== true` disables the control.
- [ ] Avoid client-side action decorators that change workflow meaning.
- [ ] Add focused Playwright coverage that renders enabled and disabled server-provided actions, including disabled reason display.
- [ ] Add focused Playwright coverage that proves actions absent from `session.actions` are not rendered.

## Generic Client Dispatch

- [ ] Keep a generic dispatch table for action transport:
  - [ ] `prompt` action: call action endpoint, receive prompt handoff, inject prompt into Codex terminal.
  - [ ] `command` action: start command terminal or headless command runner.
  - [ ] `adapter` action: call action endpoint.
  - [ ] `finish` action: call action endpoint.
  - [ ] `link` action: open server-provided URL or metadata-derived URL.
- [ ] Keep a generic dispatch path for intents:
  - [ ] `workflow_intent`: call intent endpoint.
  - [ ] `client_intent`: perform explicitly client-owned behavior, such as opening a diff dialog, only when the server declares it.
- [ ] Remove client branches that dispatch different workflow behavior based on current step ID.
- [ ] Remove client branches that dispatch different workflow behavior based on known workflow action ID.
- [ ] Keep dispatch as a small, readable map from generic type to transport.
- [ ] If dispatch needs more than one screen of code, split by transport type, not workflow type.
- [ ] Avoid promise chains or nested async callbacks where sequential `await` reads more clearly.
- [ ] Add focused Playwright coverage for each generic dispatch type that remains client-owned: prompt, command, adapter/finish action, link, workflow intent, and client intent.

## Autopilot Auto-Progress

- [ ] Preserve Autopilot as an auto-progress mode.
- [ ] Define server-owned `presentation.auto` fields.
- [ ] Proposed shape:

```js
auto: {
  canStart: true,
  canResume: true,
  continuePolicy: "until_stop_or_input",
  nextOperation: {
    kind: "advance" | "action" | "intent" | "wait" | "stop",
    id: "",
    label: ""
  }
}
```

- [ ] Server decides whether the next operation is an advance, action, intent, wait, or stop.
- [ ] Client executes `nextOperation` generically.
- [ ] Client refreshes session after each operation.
- [ ] Client stops when the server returns `nextOperation.kind === "stop"`.
- [ ] Client stops when the server returns a screen requiring user input.
- [ ] Client stops on generic transport failure.
- [ ] Client no longer calculates stop points from step IDs or `autopilot.stop`.
- [ ] Client no longer calculates whether a step can start or resume from workflow step IDs.
- [ ] Keep the auto-progress loop short and easy to read.
- [ ] The loop should read like: get operation, execute operation, refresh, repeat or stop.
- [ ] Move complicated decisions into server-provided `nextOperation`, not into client helpers.
- [ ] Avoid local state flags whose meaning is unclear outside the loop.
- [ ] Keep stop/failure handling explicit and visible.
- [ ] Add focused Playwright coverage for auto-progress through server-declared `nextOperation` values: `advance`, `action`, `intent`, `wait`, and `stop`.
- [ ] Add focused Playwright coverage that Autopilot stops at a server-declared input screen instead of using client step-ID rules.

## Prompt Waiting Contract

- [ ] Keep client-side Codex prompt injection.
- [ ] Keep client-side polling or event wait after prompt injection.
- [ ] Treat this as transport, not workflow ownership.
- [ ] Server should expose generic prompt wait state:

```js
prompt: {
  state: "idle" | "ready_to_inject" | "waiting_for_agent" | "needs_user_input" | "complete" | "failed",
  handoff: null,
  statusText: ""
}
```

- [ ] Client may wait for server prompt state to become `complete`, `needs_user_input`, or `failed`.
- [ ] Client should not special-case workflow step IDs while waiting.
- [ ] Client may still use generic step-machine statuses during transition if server prompt state is not yet available.
- [ ] End state should be: client follows `presentation.prompt.state`, not custom workflow logic.
- [ ] Add focused Playwright coverage that a prompt handoff enters waiting UI, then updates when mocked/refreshed server state reports complete.
- [ ] Add focused Playwright coverage that `needs_user_input` renders the server-provided input screen.

## Free Chat Ownership

- [ ] Preserve the intended mode split:
  - [ ] Inspect mode: user can talk directly in the Codex terminal.
  - [ ] Autopilot mode: user talks through server-provided forms that become prompt action input.
- [ ] Server defines the free-chat form fields.
- [ ] Server defines whether a free-chat response artifact is expected.
- [ ] Server defines whether the user can continue after a free-chat turn.
- [ ] Client does not know whether the chat is `agent_conversation`, `maintenance_conversation`, or review tweak.
- [ ] Client submits the server-provided form input to the server-provided action or intent.
- [ ] Keep the Autopilot free-chat code as ordinary form submission, not a special workflow controller.
- [ ] Keep Inspect terminal chat separate and obvious.
- [ ] Add focused Playwright coverage that Autopilot free chat renders from server-provided fields and submits the expected opaque action/intent payload.
- [ ] Add focused Playwright coverage that Inspect mode still allows terminal-first conversation without the Autopilot free-chat form taking ownership.

## Review Ownership

- [ ] Server decides whether the current screen is review.
- [ ] Server decides whether review is implementation review, final review, or another variant.
- [ ] Server provides review title, message, button labels, and available choices.
- [ ] Server exposes review choices as intents:
  - [ ] accept review
  - [ ] request tweak
  - [ ] reject and replan
  - [ ] open diff if treated as a declared client intent
- [ ] Server decides whether `request tweak` is available.
- [ ] Server decides whether `reject and replan` is available.
- [ ] Server owns final-review tweak behavior.
- [ ] Server owns final-review recheck target.
- [ ] Server owns reject/replan target.
- [ ] Client no longer chooses between `plan_made` and `seed_plan_made`.
- [ ] Client no longer chooses between `review_run` and `project_validated`.
- [ ] Client no longer hard-codes review-specific action IDs.
- [ ] Keep review intent code direct enough to read the whole review flow in one place.
- [ ] Do not split review ownership across server, client, and adapter unless each boundary is obvious.
- [ ] Make final-review versus implementation-review differences explicit in server presentation, not inferred by client code.
- [ ] Add focused Playwright coverage for implementation-review presentation using server-provided screen data and intents.
- [ ] Add focused Playwright coverage for final-review presentation using server-provided screen data and intents.
- [ ] Add focused Playwright coverage that accept, tweak, and reject/replan each dispatch a server-declared intent without client-selected target steps.

## Merge Ownership

- [ ] Server decides whether the current screen is merge.
- [ ] Server provides merge title, message, and choices.
- [ ] Server exposes merge choices as intents:
  - [ ] merge and sync
  - [ ] do not merge
  - [ ] cancel or recover from merge failure if needed
- [ ] Server owns the compound `merge and sync` sequence.
- [ ] Server decides whether `prepare_for_merge` is required.
- [ ] Server decides whether `merge_pr` is required.
- [ ] Server decides whether main checkout sync should run after merge.
- [ ] Server owns the `do not merge` sequence.
- [ ] Client no longer runs `prepare_for_merge` then `merge_pr` manually.
- [ ] Client no longer special-cases `main_checkout_synced`.
- [ ] Client no longer knows the `skip_merge` action ID.
- [ ] Keep merge-and-sync server code readable as a step-by-step sequence.
- [ ] Avoid a reusable sequence engine unless another real sequence proves it is needed.
- [ ] Make every merge step failure message explicit and user-facing.
- [ ] Add focused Playwright coverage that merge screen rendering comes entirely from server presentation.
- [ ] Add focused Playwright coverage that merge-and-sync and do-not-merge dispatch server-declared intents rather than client-side action sequences.

## Optional Check Ownership

- [ ] Server decides whether an optional expensive check is being offered.
- [ ] Server provides the title, message, and choices.
- [ ] Server exposes choices as intents:
  - [ ] run optional check
  - [ ] skip optional check
- [ ] Server decides what running means.
- [ ] Server decides what skipping means.
- [ ] Client no longer knows the `deep_ui_check_run` step ID.
- [ ] Client no longer hard-codes "Check user interface" versus "Skip" for workflow reasons.
- [ ] Keep optional-check server code as a simple decision: run declared operation or skip to next declared state.
- [ ] Add focused Playwright coverage that optional-check run/skip choices render from server presentation and dispatch server-declared intents.

## Command Failure Ownership

- [ ] Keep command terminal output rendering client-side.
- [ ] Keep headless command execution client-side for Autopilot transport.
- [ ] Server owns command failure state through step machines.
- [ ] Server exposes recovery options through presentation actions or intents.
- [ ] Client may offer generic retry only if the server exposes a retry action or intent.
- [ ] Client may offer "ask AI to fix" only if the server exposes that recovery option.
- [ ] The prompt for command failure recovery should be server-provided or server-rendered.
- [ ] Client should not compose workflow-specific recovery prompts from command evidence.
- [ ] Command evidence may be passed as transport data to a server-declared recovery intent.
- [ ] Keep command failure recovery readable: capture evidence, show server-declared choices, dispatch chosen recovery.
- [ ] Do not add hidden fallback recovery prompts.
- [ ] Add focused Playwright coverage that command failure displays output generically.
- [ ] Add focused Playwright coverage that retry and AI-fix options appear only when declared by server presentation/actions/intents.
- [ ] Add focused Playwright coverage that recovery dispatch uses the server-declared action/intent.

## Finished Screen Ownership

- [ ] Server decides whether the session is on a finished/archive screen.
- [ ] Server provides the finished title/message.
- [ ] Server exposes archive as an action or intent.
- [ ] Client does not search for `finish_session` by hard-coded ID.
- [ ] Client renders the server-provided archive action/intent.
- [ ] Add focused Playwright coverage that the finished screen renders from server presentation and archives through the server-provided action/intent.

## Client Component Refactor

- [ ] Replace `useVibe64AutopilotController` workflow branching with a generic presentation controller.
- [ ] Replace `screenState` derivation with direct use of server `presentation.screen`.
- [ ] Replace `readyForIssue`, `readyForMerge`, `readyForReview`, `readyForFinished`, and similar computed values with server presentation fields.
- [ ] Replace hard-coded Autopilot buttons with a generic renderer for server-provided screen actions/intents.
- [ ] Keep specialized components only for generic view kinds:
  - [ ] form
  - [ ] progress
  - [ ] terminal output
  - [ ] document preview
  - [ ] decision buttons
  - [ ] failure notice
- [ ] Ensure specialized components do not import workflow IDs.
- [ ] Ensure screen-specific labels come from server data.
- [ ] Keep the generic presentation controller small.
- [ ] Prefer direct component props over global event buses or implicit registries.
- [ ] Avoid deeply nested render components that make it hard to see what appears on screen.
- [ ] Keep generic screen components named after what they render, not after old workflow steps.
- [ ] Add focused Playwright coverage for each remaining generic component kind: form, progress, terminal output, document preview, decision buttons, and failure notice.

## Server Implementation Locations

- [ ] Add presentation construction near `workflowMachine.buildSessionView` or immediately after `applyStepMachineView`.
- [ ] Keep presentation construction close enough to step-machine output that ownership is obvious.
- [ ] Add intent calculation beside action calculation, not in client code.
- [ ] Add intent execution to runtime, similar to `runAction`, but with workflow-intent validation.
- [ ] Add step-machine hooks if an intent needs dynamic status-specific behavior.
- [ ] Avoid adding hidden client-specific metadata fields that only Autopilot understands.
- [ ] Keep new server files few and purpose-specific.
- [ ] Prefer placing code beside the workflow machine or step machines over creating distant infrastructure.
- [ ] If a new abstraction is added, document the concrete duplication or complexity it removes.
- [ ] For each server presentation or intent builder added, add at least one focused Playwright check that consumes the resulting session shape through the real client renderer.

## Migration Plan

- [ ] Phase 1: add server `presentation` while keeping existing client behavior.
- [ ] Phase 2: add server `intents` and intent endpoint.
- [ ] Phase 3: move review screen decisions to server presentation/intents.
- [ ] Phase 4: move merge screen decisions and compound merge/sync logic to server intents.
- [ ] Phase 5: move optional check decisions to server intents.
- [ ] Phase 6: move command failure recovery choices to server presentation/intents.
- [ ] Phase 7: simplify Autopilot client to render presentation and dispatch generic operations.
- [ ] Phase 8: remove dead client workflow ID constants and branch logic.
- [ ] Phase 9: add drift guard tests/source scans.
- [ ] Each migration phase must include focused Playwright confirmation before the next phase starts.
- [ ] Each migration phase must leave the architecture simpler than it found it.
- [ ] Do not carry transitional abstractions past the phase that needs them.
- [ ] Remove old client branches as soon as the server-owned replacement is verified.
- [ ] Keep commits or PR slices small enough that ownership movement is reviewable.

## Verification Checklist

- [ ] Server unit test: current session view includes presentation for a normal action step.
- [ ] Server unit test: current session view includes presentation for `waiting_for_input`.
- [ ] Server unit test: current session view includes presentation for `confirm_files`.
- [x] Server unit test: review step exposes server-owned review intents.
- [x] Server unit test: final review tweak intent rewinds/reruns according to server logic.
- [ ] Server unit test: reject/replan intent chooses the correct target server-side.
- [x] Server unit test: merge-and-sync intent runs the correct server-owned sequence.
- [x] Server unit test: skip-merge intent runs the correct server-owned sequence.
- [x] Server unit test: optional check exposes run/skip intents.
- [x] Server unit test: stale intent submission is rejected.
- [x] Client unit test: Autopilot renders server-provided screen title/message.
- [x] Client unit test: Autopilot renders server-provided actions/intents.
- [x] Client unit test: Autopilot dispatches a generic intent without step-ID knowledge.
- [ ] Client unit test: prompt action handoff still injects into Codex.
- [x] Client unit test: headless command action still streams output.
- [x] Client unit test: numbered questions collapse into the original logical field.
- [x] Client source scan: no workflow step IDs in Autopilot runtime control code.
- [x] Client source scan: no workflow action IDs in Autopilot runtime control code.
- [x] Code review check: presentation and intent code reads top-to-bottom without hidden control flow.
- [x] Code review check: no new clever generic framework was introduced for this refactor.
- [x] Code review check: names communicate product meaning clearly.
- [x] Code review check: no new stringly-typed mini language was introduced.
- [x] Focused Playwright test: generic presentation screen renders server-provided title/message/actions.
- [x] Focused Playwright test: generic intent click sends `POST /sessions/:sessionId/intents/:intentId`.
- [ ] Focused Playwright test: Autopilot auto-progress follows server `nextOperation`.
- [ ] Focused Playwright test: Review screen uses server-provided intents.
- [ ] Focused Playwright test: Merge screen uses server-provided intents.
- [ ] Focused Playwright test: Optional-check screen uses server-provided intents.
- [ ] Focused Playwright test: Command failure recovery options are server-declared.
- [x] Focused Playwright test: Numbered questions are display sugar and submit only the logical field.

## Drift Guards

- [x] Add a test or script that fails if forbidden workflow IDs appear in Autopilot runtime files.
- [x] Keep allowed references explicit and narrow, such as tests or server workflow definitions.
- [ ] Add a test that `session.actions` remains server-filtered and client does not add actions.
- [ ] Add a test that every rendered client workflow button comes from server `actions` or `intents`.
- [x] Add documentation to the server presentation builder explaining ownership.
- [x] Add documentation to the client presentation renderer explaining that workflow meaning belongs to the server.
- [ ] Add a drift guard requiring a focused Playwright test reference for every new `presentation.screen.kind` or `intent.type`.
- [ ] Add a drift guard or review checklist item for simplicity: new workflow presentation/intent code must be direct, named, and locally understandable.

## Definition Of Done

- [x] Autopilot can run a normal prompt step without knowing the step ID.
- [x] Autopilot can run a command step without knowing the step ID.
- [x] Autopilot can stop for user input without knowing the step ID.
- [x] Autopilot can render review without knowing review step IDs.
- [x] Autopilot can render merge without knowing merge step IDs.
- [x] Autopilot can render optional check decisions without knowing optional-check step IDs.
- [x] Autopilot can archive a session without knowing `finish_session`.
- [ ] Inspect mode still renders current server actions and current-step input.
- [ ] Inspect mode still allows terminal-first conversation.
- [x] Numbered questions remain presentational and do not affect persisted state shape.
- [x] The client is a renderer plus generic dispatcher.
- [x] The server is the only owner of workflow meaning.
- [x] Every ownership slice above has a passing focused Playwright check proving the rendered behavior matches the server-owned contract.
- [x] The final architecture is easy to explain in one paragraph.
- [x] The main server path is easy to trace: build session, build presentation, expose actions/intents, execute chosen action/intent.
- [x] The main client path is easy to trace: render presentation, dispatch action/intent, refresh.
- [x] The code favors clear names, plain data, direct async/await, and explicit branches.
- [x] There is no clever code that future maintainers need to reverse-engineer before changing a workflow screen.
