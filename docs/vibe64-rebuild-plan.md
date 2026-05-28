# Vibe64 Implementation Plan

This plan describes the V0 implementation of the general `vibe64` product.

V0 rules:

- No alternate session support.
- No compatibility wrappers.
- No migration commands.
- Runtime session state lives in `.vibe64`.
- No hidden fallbacks to JSKIT-specific behavior.

The new product is a checklist-driven AI coding studio. The core owns workflow state. Target adapters own project-specific reality.

## Non-Negotiable Goals

- Rename the product concept to `vibe64`.
- Move session state management out of JSKIT.
- Create a clear class-based runtime that is easy to read.
- Make JSKIT the first target adapter, not the state machine.
- Make it easy to create adapters for Python, C++, web apps, and other project types.
- Keep the checklist experience.
- Keep prompt-driven Codex workflows.
- Keep deterministic buttons for deterministic work.
- Make every Studio button map to a runtime action.
- Keep buttons visible on their step and disabled until runnable.
- Keep target-specific behavior behind adapter boundaries.

## Command Line Scope

There is no command-line product surface in this rebuild.

This means:

- Do not create an `vibe64` binary.
- Do not create `vibe64 session ...` commands.
- Do not design the workflow around copy/paste CLI usage.
- Do not add CLI-specific tests.
- Do not keep CLI placeholders in slices.
- Do not describe CLI completion as an acceptance requirement.

The runtime still needs a clean programmatic API because Studio must call it. That API is not a CLI. It is the internal contract between Studio UI, adapters, and durable session state. If a command line is added later, it must be designed as separate work. The current implementation must not carry command-line files, placeholders, acceptance criteria, or tests.

## Hard Testing Rule

- Do not write e2e tests.
- Do not run e2e tests.
- Do write tests for core behavior.
- All tests must be fast.
- Tests should focus on state transitions, action availability, adapter contracts, prompt rendering, and session file behavior.
- Prefer unit tests and small integration tests that run without browsers, external services, long-lived servers, or real GitHub/network calls.
- Mock adapters, terminal spec factories, clocks, and providers where needed.
- If a behavior requires a slow external system to verify, split out the pure decision logic and test that fast path instead.

## Product Shape

Vibe64 has three layers:

1. Core runtime
2. Target adapters
3. Studio UI

The core runtime decides:

- What session exists.
- What step is current.
- What steps are completed.
- What actions exist on the current step.
- Whether each action is enabled.
- Why each disabled action is disabled.
- Whether `Next` is available.
- What prompts are rendered.
- What artifacts are expected.
- What durable session files exist.

Target adapters decide:

- What kind of project this is.
- How to inspect the project.
- How dependencies are installed.
- What build/test/check commands exist.
- How to start the app if applicable.
- What files are important.
- What target-specific context goes into prompts.
- How deterministic target commands are described for Studio command terminals.

The UI decides:

- How to render the checklist.
- How to render buttons, editors, terminals, and status.
- How to send runtime actions.
- How to display disabled reasons.

The UI must not own workflow state.

## Important Design Decisions

Canonical Vibe64 design decisions live in
`.jskit/APP_BLUEPRINT.md#important-design-decisions`. This rebuild plan must
follow those decisions rather than redefining them.

## Studio Setup, Adapter Setup, And Project Setup

The setup vocabulary is:

- Studio Setup: Studio-owned machine and managed toolchain readiness.
- Adapter Setup: adapter-owned target readiness.
- Project Setup: target project scaffold, dependency, and project-specific readiness.

The rebuild must keep those boundaries deliberate:

- Studio-owned checks stay in Studio Setup.
- Adapter-owned checks stay in Adapter Setup.
- Target project checks stay in Project Setup.
- Session workflow steps stay inside the session checklist.

Hard rule:

- Do not introduce extra setup names.
- Do not preserve confusing names because they existed before.
- Keep all surviving setup screens aligned with the adapter boundary.

Checklist:

- [x] Use Studio Setup for Studio-owned machine readiness.
- [x] Use Adapter Setup for adapter-owned target readiness.
- [x] Use Project Setup for target project readiness.
- [x] Confirm every setup behavior lives in the right owner.
- [x] Remove obsolete setup behavior rather than preserving it.

## Target Architecture

### Core Runtime Class

Create a new class:

```ts
class Vibe64SessionRuntime {
  constructor({ store, adapter, workflow, promptPack, clock, logger }) {}

  createSession(input) {}
  getSession(sessionId) {}
  listSessions() {}
  runAction(sessionId, actionId, input) {}
  advance(sessionId) {}
  rewind(sessionId, stepId) {}
  abandon(sessionId) {}
  finish(sessionId) {}
}
```

The runtime should be boring, explicit, and readable. Prefer direct methods over clever generic abstractions.

### Target Adapter Interface

Create an adapter contract similar to:

```ts
interface TargetAdapter {
  id: string;
  label: string;

  detect(context): Promise<AdapterDetection>;
  inspect(context): Promise<ProjectFacts>;
  getConfigFields(context): Promise<ConfigField[]>;
  getDefaultConfig(context): Promise<Record<string, string>>;
  getPromptContext(context): Promise<Record<string, string>>;
  renderPrompt(context): Promise<PromptResult>;
  listCommands(context): Promise<AdapterCommand[]>;
  createCommandTerminalSpec(commandId, context): Promise<TerminalSpec>;
  createAppReviewTerminalSpec(context): Promise<TerminalSpec>;
  getEditableArtifacts(context): Promise<EditableArtifact[]>;
  getSetupDoctorPlugins(context): Promise<DoctorPlugin[]>;
}
```

Adapters must be easy to write. A useful adapter should not require understanding the whole runtime.

### Workflow Model

A workflow step should be explicit:

```ts
{
  id: "plan_executed",
  label: "Execute plan",
  description: "Codex executes the accepted plan.",
  actions: [
    {
      id: "execute_plan",
      label: "Execute plan",
      type: "prompt",
      promptId: "execute_plan"
    }
  ],
  next: {
    visible: true,
    enabledWhen: ["action_sent:execute_plan"]
  }
}
```

Action types:

- `prompt`: render a prompt and send or expose it.
- `command`: run deterministic code.
- `editor`: open an editable artifact.
- `terminal`: open a terminal-backed operation.
- `next`: advance the state machine.

## Phase 1: Product Reset

Goal: Establish the product boundary and naming.

Instructions:

- Create the `vibe64` runtime namespace.
- Decide the session root.
- Use `.vibe64/sessions/active/<session_id>/`.
- Treat JSKIT as an adapter name, not the product name.
- Keep JSKIT-specific assumptions out of core files.
- Do not add compatibility paths.
- Session state is read from `.vibe64`.

Checklist:

- [ ] Product name is `vibe64` in runtime code.
- [ ] Sessions are stored under `.vibe64/`.
- [ ] Runtime code uses Vibe64 session APIs.
- [ ] Runtime code uses `.vibe64` session roots.
- [ ] JSKIT appears only as an adapter concept.
- [ ] Documentation states that sessions are clean `vibe64` sessions.

Acceptance:

- A session can be created in `.vibe64/sessions/active/`.
- The session has no dependency on external session state.

## Phase 2: Session Store

Goal: Build a simple durable store for session state.

Instructions:

- Create a session store module.
- Store each session as a directory.
- Store single-value metadata as plain files under `metadata/`.
- Store real user-facing artifacts as real files.
- Use JSON only for structured machine data.
- Do not create fake `.md` sentinel files.
- Reserve `.md` for real artifacts such as issue and PR bodies.

Recommended session layout:

```text
.vibe64/
  sessions/
    active/
      <session_id>/
        session.json
        current_step
        status
        metadata/
        artifacts/
        command-log.jsonl
```

Checklist:

- [ ] Session root creation is centralized.
- [ ] Session ID validation is centralized.
- [ ] Status read/write is centralized.
- [ ] Current step read/write is centralized.
- [ ] Metadata read/write helpers exist.
- [ ] Artifact read/write helpers exist.
- [ ] Command logging helper exists.
- [ ] No fake markdown sentinel files are used.

Acceptance:

- A developer can inspect a session directory and understand its state without reading UI code.

## Phase 3: Workflow State Machine

Goal: Replace scattered state rules with a clear class-based state machine.

Instructions:

- Create a `WorkflowMachine` or equivalent class.
- Give it the workflow definition and current session facts.
- Make it compute the session view.
- Make transitions explicit.
- Keep `Next` as the only way to complete a step unless a step explicitly auto-advances.
- Do not let action success implicitly advance unless the workflow says so.

The machine must compute:

- current step
- completed steps
- visible actions
- enabled actions
- disabled reasons
- next visibility
- next enabled state
- next disabled reason

Checklist:

- [ ] Workflow steps are declared in one place.
- [ ] Step order is declared in one place.
- [ ] Current step resolution is deterministic.
- [ ] `runAction()` records action results but does not advance by default.
- [ ] `advance()` records step completion.
- [ ] Disabled reasons are generated by the runtime.
- [ ] UI does not duplicate transition rules.

Acceptance:

- Reading the state machine file explains how the workflow progresses.
- Studio sees action availability directly from the runtime session view.

## Phase 4: Core Action Model

Goal: Make every button a first-class action.

Instructions:

- Define an action registry per step.
- Every action must have:
  - id
  - label
  - type
  - enabled conditions
  - disabled reason
  - runtime handler
- Keep action handlers small.
- Prompt actions render prompts.
- Command actions run deterministic commands.
- Editor actions expose editable artifacts.

Checklist:

- [ ] `Create worktree` is an action.
- [ ] `Run npm install` or adapter equivalent is an action.
- [ ] `Send prompt` is an action.
- [ ] `Create issue file` is an action.
- [ ] `Create issue on GH` is an action.
- [ ] `Make plan` is an action.
- [ ] `Execute plan` is an action.
- [ ] `Check user interface` is an action.
- [ ] `Run deslop` is an action and owns repeated cleanup until no findings remain.
- [ ] `Run automated checks` is an action.
- [ ] `Update blueprint` is an adapter-provided action when supported.
- [ ] `Commit changes` is an action.
- [ ] `Create PR file` is an action.
- [ ] `Create PR on GH` is an action.
- [ ] `Prepare for merge` is a prompt action.
- [ ] `Merge` is a command action.
- [ ] `Sync main checkout` is a command action.
- [ ] `Finish` is an action.

Acceptance:

- Every Studio button maps directly to a runtime action.
- No button has hidden UI-only workflow behavior.

## Phase 5: Default Checklist Workflow

Goal: Recreate the current checklist as the first clean `vibe64` workflow.

Instructions:

- Keep the checklist shape.
- Remove JSKIT-only wording from core labels.
- Put target-specific wording in adapter prompt context.
- Keep `Next` visible where the user expects it.
- Disable actions rather than hiding them when conditions are unmet.

Default workflow:

- Create session
- Create worktree
- Install dependencies
- Define issue and create file
- Edit and submit issue
- Make plan
- Execute plan
- Check user interface
- Run review/deslop
- Run automated checks
- Accept changes
- Update project knowledge
- Commit changes
- Create PR file
- Edit and create PR
- Merge PR
- Sync main checkout
- Finish session

Checklist:

- [ ] Each step has a stable id.
- [ ] Each step has a user-facing label.
- [ ] Each step has zero or more actions.
- [ ] Each step has a `Next` rule.
- [ ] Each action has enabled conditions.
- [ ] Each disabled action has a useful reason.
- [ ] Prompt steps do not auto-complete after prompt send.
- [ ] Command steps only auto-advance when explicitly configured.

Acceptance:

- The UI checklist can be rendered entirely from workflow/session data.

## Phase 6: Prompt System

Goal: Make prompt actions real while letting each adapter own the full prompt text.

Instructions:

- Create adapter-owned prompt packs.
- Do not keep a core default prompt pack.
- Let adapters decide the full structure and wording of each prompt.
- Let adapters use a shared template helper when it is useful.
- Runtime prompt actions ask the active adapter to render the prompt.
- Keep prompt rendering separate from `Next`.
- Keep prompt files readable.
- Keep prompt injection markers outside user-visible terminal output.

Prompt inputs:

- session id
- target root
- worktree path
- current step
- issue file path
- PR file path
- issue URL
- PR URL
- adapter id
- adapter facts
- available commands
- project constraints

Checklist:

- [ ] Adapter prompt rendering API exists.
- [ ] Adapter-owned prompt pack lookup exists.
- [ ] Prompt template helper exists for adapters that want files.
- [ ] Prompt previews work through the runtime.
- [ ] Prompt actions can be sent by Studio.
- [ ] Terminal output filter still hides injected prompt bodies.

Acceptance:

- The same workflow step can render different prompts for JSKIT, Python, and C++ projects.

## Phase 7: Target Adapter System

Goal: Make adapters easy to write and hard to misuse.

Instructions:

- Create an adapter base contract.
- Create small helper types for commands, facts, artifacts, and capabilities.
- Provide clear examples.
- Keep adapters stateless where possible.
- Put target command execution behind adapter methods.
- Keep workflow decisions out of adapters.

Adapter capabilities:

- dependencies
- build
- test
- lint
- app start
- UI check
- project knowledge file
- package scripts
- issue provider
- PR provider

Checklist:

- [ ] Adapter detection API exists.
- [ ] Adapter inspection API exists.
- [ ] Adapter command listing API exists.
- [ ] Adapter command execution API exists.
- [ ] Adapter prompt context API exists.
- [ ] Adapter artifact API exists.
- [ ] Adapter capability flags exist.
- [ ] Missing capabilities disable relevant actions with clear reasons.

Acceptance:

- A new adapter can be implemented by reading one interface file and one example adapter.

## Phase 8: JSKIT Adapter

Goal: Move current JSKIT behavior into the first adapter.

Instructions:

- Create `JskitTargetAdapter`.
- It should detect JSKIT projects.
- It should inspect `.jskit` project files.
- It should expose package scripts.
- It should provide JSKIT-specific prompt context.
- It should own helper-map behavior.
- It should own blueprint behavior.
- It should own JSKIT-specific readiness checks.
- It should not own workflow transitions.

Checklist:

- [ ] Detect JSKIT app roots.
- [ ] Read app blueprint path.
- [ ] Read helper map path.
- [ ] Discover package manager.
- [ ] Discover package scripts.
- [ ] Install dependencies.
- [ ] Run app checks.
- [ ] Run UI checks where supported.
- [ ] Update blueprint.
- [ ] Provide JSKIT prompt context.
- [ ] Return disabled reasons for unavailable JSKIT capabilities.

Acceptance:

- A JSKIT project can complete the full default workflow through the new adapter.

## Phase 9: C++ Adapter

Goal: Prove the product is not JSKIT-specific.

Instructions:

- Create `CppTargetAdapter`.
- Start with CMake support.
- Detect `CMakeLists.txt`.
- Inspect common build directories.
- Provide configure, build, and test commands.
- Do not assume npm, package.json, browser UI, or JSKIT files.
- Generate C++-specific prompt context.

Initial C++ behavior:

- Configure: `cmake -S . -B build`
- Build: `cmake --build build`
- Test: `ctest --test-dir build`

Checklist:

- [ ] Detect CMake projects.
- [ ] Identify build directory.
- [ ] Expose configure command.
- [ ] Expose build command.
- [ ] Expose test command.
- [ ] Capture compiler output.
- [ ] Include compiler/build context in prompts.
- [ ] Disable UI-only actions when not applicable.
- [ ] Keep issue/plan/PR workflow intact.

Acceptance:

- A C++ CMake project can use Vibe64 to define work, plan, execute, build/test, create PR, and finish.

## Phase 10: Python Adapter

Goal: Add a second non-JSKIT adapter for script/library/server projects.

Instructions:

- Create `PythonTargetAdapter`.
- Detect Python projects.
- Support common tools without assuming all are present.
- Prefer explicit detection over guesses.
- Expose dependency, test, lint, and run commands when available.

Detection examples:

- `pyproject.toml`
- `requirements.txt`
- `uv.lock`
- `poetry.lock`
- `pytest.ini`

Checklist:

- [ ] Detect Python project root.
- [ ] Detect dependency manager.
- [ ] Expose install command.
- [ ] Expose test command.
- [ ] Expose lint command if configured.
- [ ] Expose run command if obvious.
- [ ] Include Python environment context in prompts.
- [ ] Disable unavailable commands with reasons.

Acceptance:

- A Python project can complete the workflow without any npm assumptions.

## Phase 11: Web App Adapter Family

Goal: Support generic Vue and React apps without depending on JSKIT.

Instructions:

- Create a web adapter or adapter family.
- Detect `package.json`.
- Detect framework where practical.
- Expose package scripts.
- Provide app start command.
- Provide build/test/lint commands.
- Keep JSKIT behavior out of this adapter.

Checklist:

- [ ] Detect package manager.
- [ ] Detect Vue where obvious.
- [ ] Detect React where obvious.
- [ ] Expose install command.
- [ ] Expose dev/start command.
- [ ] Expose build command.
- [ ] Expose test command.
- [ ] Expose lint command.
- [ ] Provide browser/UI check capability when app start exists.
- [ ] Include framework context in prompts.

Acceptance:

- A non-JSKIT Vue or React project can use the workflow naturally.

## Phase 12: No Command Line Surface

Goal: Keep the rebuild focused on Studio and the runtime API.

Instructions:

- Do not add a command-line interface.
- Do not add an `vibe64` binary.
- Do not add `vibe64 session ...` commands.
- Do not add command-line renderers for checklist state, actions, prompts, or disabled reasons.
- Do not add command-line tests.
- Keep the runtime API clean enough that Studio can call it directly.
- Keep command execution behind runtime actions and adapters.

Checklist:

- [ ] No CLI files exist for the new runtime.
- [ ] No package binary is added for `vibe64`.
- [ ] No slice depends on command-line usage.
- [ ] Runtime actions are callable from code.
- [ ] Studio can render current step, actions, disabled reasons, and `Next` from runtime data.
- [ ] Prompt-producing actions return Studio handoff data through the runtime.

Acceptance:

- The product can be completed through Studio without any command-line product surface.

## Phase 13: Studio UI Refactor

Goal: Make Studio a thin UI over the new runtime.

Instructions:

- UI should render the session view returned by the runtime.
- UI should not infer workflow rules.
- UI should not decide action availability.
- UI should not know adapter internals.
- Buttons should be rendered from actions.
- Buttons should remain visible on their step and disabled when unavailable.

Checklist:

- [ ] Checklist renders from runtime step data.
- [ ] Current step renders from runtime state.
- [ ] Buttons render from runtime action data.
- [ ] Disabled state comes from runtime.
- [ ] Disabled reason can be displayed.
- [ ] `Next` comes from runtime.
- [ ] Editors open runtime-declared editable artifacts.
- [ ] Terminal actions call runtime action ids.
- [ ] Prompt actions use runtime prompt payloads.

Acceptance:

- Adding a new adapter does not require changing workflow UI logic.

## Phase 14: Artifact Editors

Goal: Make editing issue, PR, blueprint, and future artifacts generic.

Instructions:

- Create an artifact editor model.
- Runtime returns editable artifacts for the current step.
- Adapter can provide extra editable artifacts.
- Core artifacts should include issue and PR files.
- JSKIT adapter can provide blueprint editing.

Checklist:

- [ ] Generic artifact editor component exists.
- [ ] Runtime exposes editable artifacts.
- [ ] Issue editor uses artifact model.
- [ ] PR editor uses artifact model.
- [ ] Blueprint editor uses adapter artifact model.
- [ ] Save writes through runtime/store.
- [ ] Missing artifacts disable editor actions.

Acceptance:

- The UI does not need a custom editor path for every new adapter artifact.

## Phase 15: GitHub Provider

Goal: Keep issue and PR operations deterministic but provider-separated.

Instructions:

- Create a provider boundary for GitHub issue/PR operations.
- Keep `gh` command behavior behind this provider.
- Core workflow can ask for issue/PR operations.
- Provider performs deterministic commands and records URLs.
- `issue_url` and `pr_url` remain durable facts.

Checklist:

- [ ] Create issue operation exists.
- [ ] Create PR operation exists.
- [ ] Merge PR operation exists.
- [ ] Close issue operation exists where needed.
- [ ] Comment operation exists where needed.
- [ ] Provider records URLs in session metadata.
- [ ] Provider reports command failures clearly.

Acceptance:

- Issue/PR actions are not tangled with target adapters or UI code.

## Phase 16: Terminal Integration

Goal: Preserve the working prompt-injection terminal behavior.

Instructions:

- Keep prompt marker filtering.
- Make prompt sending available to every prompt action.
- Keep visible short sentence plus hidden full prompt behavior.
- Block prompt buttons while terminal activity is active.
- Keep deterministic command actions separate from Codex prompt actions.

Checklist:

- [ ] Prompt action can inject into terminal.
- [ ] Full prompt is hidden from terminal display.
- [ ] Short visible sentence remains visible.
- [ ] Terminal replay still honors hidden markers.
- [ ] Prompt buttons disable while Codex is active.
- [ ] Deterministic command buttons disable while commands run.

Acceptance:

- Prompt injection works on fresh sessions and resumed terminal output.

## Phase 17: Configuration Model

Goal: Let projects configure adapter behavior without bloating the core.

Instructions:

- Define an optional `vibe64.config.*` format.
- Keep config small.
- Use config to override adapter choices.
- Do not require config for common projects.
- Do not put workflow state in config.

Possible config:

```json
{
  "adapter": "cpp-cmake",
  "commands": {
    "build": "cmake --build build",
    "test": "ctest --test-dir build"
  }
}
```

Checklist:

- [ ] Config discovery exists.
- [ ] Config validation exists.
- [ ] Adapter override exists.
- [ ] Command override exists.
- [ ] Invalid config gives clear errors.
- [ ] Runtime state is not stored in config.

Acceptance:

- A project with unusual commands can still use Vibe64 without code changes.

## Phase 18: Documentation For Adapter Authors

Goal: Make adapter creation approachable.

Instructions:

- Write an adapter author guide.
- Include a minimal adapter.
- Include a real adapter example.
- Explain each method.
- Explain disabled reasons.
- Explain command logging.
- Explain prompt context.

Checklist:

- [ ] Adapter author guide exists.
- [ ] Minimal adapter example exists.
- [ ] JSKIT adapter is documented.
- [ ] C++ adapter is documented.
- [ ] Python adapter is documented.
- [ ] Prompt context examples exist.
- [ ] Command result examples exist.

Acceptance:

- A competent developer can write a basic adapter in one sitting.

## Phase 19: Quality Bar

Goal: Keep the rewrite understandable and maintainable.

Instructions:

- Prefer boring code.
- Prefer explicit state transitions.
- Avoid clever generalization until two adapters prove the need.
- Keep files small enough to read.
- Keep core and adapter concerns separate.
- Make disabled reasons explainable.
- Keep tests fast enough that developers actually run them.
- Do not add browser-driven or full-stack e2e tests.

Checklist:

- [ ] Core runtime has no target-specific imports.
- [ ] Adapters do not mutate workflow state directly.
- [ ] UI does not duplicate workflow rules.
- [ ] Prompt rendering is centralized.
- [ ] Command execution is logged.
- [ ] Session files are inspectable.
- [ ] State transitions are easy to trace.
- [ ] No hidden compatibility fallbacks exist.
- [ ] Core state-machine tests are fast.
- [ ] Adapter contract tests use fake terminal spec factories.
- [ ] Prompt rendering tests do not start terminals.
- [ ] No new e2e tests are added or required.

Acceptance:

- A new engineer can trace a button click from UI to runtime to session file in under ten minutes.

## Phase 20: First Complete Vertical Slice

Goal: Build one end-to-end path before broadening everything.

Instructions:

- Pick one adapter first.
- JSKIT is the practical first adapter because it preserves known behavior.
- Build only enough core to complete one full session.
- Then add C++ to prove the adapter boundary.

Checklist:

- [ ] Create session.
- [ ] Inspect target.
- [ ] Create worktree or equivalent.
- [ ] Install dependencies or mark unavailable.
- [ ] Define issue.
- [ ] Create issue file.
- [ ] Edit issue.
- [ ] Create GitHub issue.
- [ ] Make plan.
- [ ] Execute plan.
- [ ] Run checks.
- [ ] Commit changes.
- [ ] Create PR file.
- [ ] Edit PR.
- [ ] Create PR.
- [ ] Prepare for merge.
- [ ] Merge.
- [ ] Sync checkout if applicable.
- [ ] Finish session.

Acceptance:

- The first adapter can complete the workflow through Studio.

## Execution Slices

These slices are the delivery plan. Do them in order. Do not start a later slice until the current slice meets its acceptance criteria. Each slice should leave the codebase in a coherent state.

### SLICE 1: Core Skeleton And Session Store

Goal: Create the new `vibe64` runtime shell and durable session store with no JSKIT dependency.

Instructions:

- Create the new runtime package/module namespace.
- Create `.vibe64/sessions/active/<session_id>/`.
- Implement session creation, session lookup, session listing, status storage, current-step storage, metadata storage, artifact storage, and command logging.
- Keep the API small and boring.
- Do not add adapters yet.
- Do not connect Studio UI yet.

Checklist:

- [x] `Vibe64SessionRuntime` class exists.
- [x] Session store class/module exists.
- [x] New sessions write to `.vibe64/sessions/active/`.
- [x] `session.json` or equivalent core manifest exists.
- [x] `current_step` is readable and writable.
- [x] `status` is readable and writable.
- [x] `metadata/` helpers exist.
- [x] `artifacts/` helpers exist.
- [x] Command log helper exists.
- [x] No JSKIT imports exist in the new core.
- [x] Fast tests cover session creation and state file reads/writes.

Acceptance:

- A local script or fast unit test can create a new `vibe64` session and read it back.
- The session directory is understandable by inspection.

### SLICE 2: Workflow Machine And Session View

Goal: Build the class-based state machine and a runtime session view.

Instructions:

- Define the default checklist workflow.
- Implement current-step resolution.
- Implement completed-step recording.
- Implement `Next` visibility and enabled-state computation.
- Implement action visibility and enabled-state computation.
- Include disabled reasons in the session view.
- Keep the workflow definition explicit.

Checklist:

- [x] Workflow definition file exists.
- [x] Workflow step ids are stable.
- [x] Workflow step labels are user-facing.
- [x] `WorkflowMachine` or equivalent class exists.
- [x] `getSession()` returns current step.
- [x] `getSession()` returns completed steps.
- [x] `getSession()` returns visible actions.
- [x] `getSession()` returns disabled reasons.
- [x] `getSession()` returns `Next` state.
- [x] `advance()` records step completion.
- [x] Fast tests cover basic transitions and disabled states.

Acceptance:

- A session can move through several steps using only `advance()`.
- The returned session view contains enough data to render the checklist and buttons.

### SLICE 3: Action Runner And Studio Contract

Goal: Make every workflow button a runtime-addressable Studio action.

Instructions:

- Implement `runAction(sessionId, actionId, input)`.
- Do not add a command-line interface.
- Do not add an `vibe64` binary.
- Do not add `vibe64 session ...` commands.
- Do not wire real target commands yet.
- Use fake/no-op action handlers where needed to prove the contract.
- The runtime session view must show current step, actions, disabled reasons, and `Next`.
- Studio is the only product surface for these actions in this rebuild.

Checklist:

- [x] `runAction()` exists.
- [x] `runAction()` accepts session id, action id, and input.
- [x] `runAction()` records action results.
- [x] `runAction()` does not advance by default.
- [x] Runtime action results include action id, step id, status, and message.
- [x] Runtime rejects actions that are not on the current step.
- [x] Runtime rejects disabled actions with a useful reason.
- [x] Runtime does not hide current-step actions merely because they are disabled.
- [x] Fast tests cover action lookup and unavailable-action errors.

Acceptance:

- The full checklist can be inspected from the runtime session view.
- A fake action can be run through `runAction()` without Studio UI.

### SLICE 4: Prompt Rendering And Terminal Contract

Goal: Make prompt actions real while preserving the hidden full-prompt terminal behavior.

Instructions:

- Implement adapter-owned prompt rendering.
- Implement prompt pack loading as an adapter helper.
- Implement Studio prompt handoff shape in the runtime.
- Preserve the marker-based terminal output filtering.
- Keep prompt sending separate from `Next`.

Checklist:

- [x] Adapter-owned prompt pack directory exists.
- [x] Prompt renderer helper exists for adapters.
- [x] Runtime asks the adapter for full prompt text.
- [x] Prompt context object is explicit.
- [x] Prompt actions render prompt text.
- [x] Studio can receive prompt handoff data.
- [x] Hidden prompt markers are still filtered from terminal output.
- [x] Prompt buttons are disabled while terminal activity is active.
- [x] Fast tests cover prompt rendering and marker filtering.

Acceptance:

- A prompt action can be rendered and handed to Codex without advancing the workflow.

### SLICE 5: Adapter Contract And Fake Adapter

Goal: Prove the adapter boundary before porting JSKIT.

Instructions:

- Define the adapter interface.
- Create a fake adapter used by tests and local development.
- Keep workflow state out of the adapter.
- Make adapter facts appear in prompt context.
- Make adapter capabilities affect action disabled reasons.

Checklist:

- [x] Adapter interface exists.
- [x] Adapter detection result type exists.
- [x] Adapter project facts type exists.
- [x] Adapter command type exists.
- [x] Adapter action result type exists.
- [x] Fake adapter exists.
- [x] Runtime can load one adapter.
- [x] Adapter facts appear in session view.
- [x] Adapter facts appear in rendered prompts.
- [x] Fast tests cover adapter capability gating.

Acceptance:

- The runtime can complete a toy workflow using a fake adapter.

### SLICE 6: JSKIT Adapter, Setup Through Issue

Goal: Implement the first real adapter enough to create an Vibe64 session for a JSKIT project, set up the worktree, define an issue, create issue files, edit them, and create the GitHub issue.

Instructions:

- Create `JskitTargetAdapter`.
- Detect JSKIT projects.
- Implement worktree creation through adapter command capabilities and terminal specs.
- Implement dependency install through adapter command capabilities and terminal specs.
- Implement JSKIT prompt context.
- Implement issue file and GitHub issue flow through the new core.
- Keep issue submission from auto-advancing; user must press `Next`.

Checklist:

- [x] JSKIT adapter detects target root.
- [x] JSKIT adapter exposes setup facts.
- [x] Worktree setup action exists.
- [x] Dependency install action exists.
- [x] Issue prompt action exists.
- [x] Issue file prompt action exists.
- [x] Issue editor action exists.
- [x] GitHub issue creation action exists.
- [x] `issue_url` is stored as durable session metadata.
- [x] `Next` enables only after issue submission.
- [x] Fast tests cover JSKIT capability mapping with fake terminal spec factories.

Acceptance:

- A JSKIT project can reach the step after issue submission through Studio using the new runtime.

### SLICE 7: JSKIT Plan Through Commit

Goal: Complete the middle JSKIT workflow from planning through accepted committed changes.

Instructions:

- Implement make-plan prompt action.
- Implement execute-plan prompt action.
- Implement deep UI check prompt action where supported.
- Implement the deslop prompt action.
- Implement automated checks action.
- Implement accept/review decision behavior.
- Implement blueprint update action through JSKIT adapter.
- Implement commit changes action.

Checklist:

- [x] Make-plan action exists.
- [x] Execute-plan action exists.
- [x] Deep UI check action exists.
- [x] Deslop action exists and owns repeated cleanup until no findings remain.
- [x] Automated checks action exists.
- [x] Accept changes behavior exists.
- [x] Blueprint update action exists only when adapter supports it.
- [x] Commit changes action exists.
- [x] Accepted commit metadata is stored.
- [x] Fast tests cover action availability and deterministic command handling.

Acceptance:

- A JSKIT project can progress from plan creation to committed accepted changes.

### SLICE 8: JSKIT PR, Merge, Sync, Finish

Goal: Complete the JSKIT endgame using the new runtime.

Instructions:

- Implement PR file prompt action.
- Implement PR artifact editor.
- Implement GitHub PR creation.
- Store `pr_url` as the durable PR fact.
- Implement prepare-for-merge prompt action.
- Implement merge as a deterministic command action.
- Implement sync-main-checkout as a deterministic command action.
- Implement finish action.
- Keep buttons visible and disabled until their conditions are met.

Checklist:

- [x] PR file prompt action exists.
- [x] PR editor action exists.
- [x] GitHub PR creation action exists.
- [x] `pr_url` is stored.
- [x] Prepare-for-merge action requires `pr_url`.
- [x] Merge action requires `pr_url`.
- [x] Successful merge writes PR outcome.
- [x] Sync-main-checkout requires `pr_url` and merged outcome.
- [x] Finish delegates target cleanup and marks the session finished.
- [x] Fast tests cover PR state, merge result handling, sync gating, and finish status.

Acceptance:

- A JSKIT project can complete the full workflow through Studio with the new runtime.

### SLICE 9: Studio UI Runtime Wiring

Goal: Make Studio a thin renderer over the new runtime session view.

Runtime wiring rule for slices 9-13:

- Do not build compatibility bridges.
- Do not normalize runtime data into retired workflow shapes.
- Do not preserve unused UI contracts just to keep the workflow usable mid-slice.
- The app must still compile and boot.
- The Studio workflow may be incomplete until Slice 13 is finished.
- Each slice should move the real UI/API boundary toward the runtime directly.

Instructions:

- Replace UI-specific workflow inference with runtime-provided session view fields.
- Render checklist from runtime steps.
- Render buttons from runtime actions.
- Render disabled state and disabled reasons from runtime data.
- Keep editors generic where possible.
- Keep prompt terminal integration working.

Checklist:

- [x] Studio reads new runtime session view.
- [x] Checklist renders from runtime data.
- [x] Current step renders from runtime data.
- [x] Buttons render from runtime actions.
- [x] Disabled buttons remain visible.
- [x] Disabled reasons are available to display.
- [x] `Next` renders from runtime data.
- [x] Prompt injection uses runtime prompt payloads.
- [x] Artifact editors use runtime artifact descriptors.
- [ ] Fast component-level tests cover view-model mapping without browser e2e.

Acceptance:

- The JSKIT full workflow can be driven through Studio using the new runtime.

### SLICE 10: C++ Adapter Vertical Slice

Goal: Prove Vibe64 works for the C++ project case without npm, package.json, JSKIT, browser UI, or blueprint assumptions.

Instructions:

- Create `CppTargetAdapter`.
- Detect CMake projects.
- Expose configure, build, and test commands.
- Add C++ prompt context.
- Disable unsupported web/JSKIT-only actions with clear reasons.
- Keep the issue, plan, execute, check, PR, merge workflow intact.

Checklist:

- [ ] CMake project detection exists.
- [ ] Configure command exists.
- [ ] Build command exists.
- [ ] Test command exists.
- [ ] Compiler/build output is captured.
- [ ] C++ prompt context exists.
- [ ] No npm assumptions are used.
- [ ] No JSKIT assumptions are used.
- [ ] Unsupported actions show disabled reasons.
- [ ] Fast tests cover C++ adapter detection and command mapping.

Acceptance:

- A C++ CMake project can complete a meaningful workflow through Studio.

### SLICE 11: Python Adapter Vertical Slice

Goal: Add Python support without weakening the adapter boundary.

Instructions:

- Create `PythonTargetAdapter`.
- Detect common Python project files.
- Detect dependency manager where possible.
- Expose install, test, lint, and run commands when available.
- Add Python prompt context.
- Keep unavailable commands disabled with reasons.

Checklist:

- [ ] `pyproject.toml` detection exists.
- [ ] `requirements.txt` detection exists.
- [ ] `uv.lock` detection exists.
- [ ] `poetry.lock` detection exists.
- [ ] Install command mapping exists.
- [ ] Test command mapping exists.
- [ ] Lint command mapping exists when configured.
- [ ] Python prompt context exists.
- [ ] Fast tests cover detection and command mapping.

Acceptance:

- A Python project can complete the core workflow without npm assumptions.

### SLICE 12: Generic Web Adapter Vertical Slice

Goal: Support non-JSKIT Vue and React apps.

Instructions:

- Create a generic web adapter or adapter family.
- Detect package manager.
- Detect framework where practical.
- Expose install, dev, build, test, and lint commands from package scripts.
- Add generic web prompt context.
- Keep JSKIT blueprint/helper-map behavior out of this adapter.

Checklist:

- [ ] Package manager detection exists.
- [ ] Vue detection exists where obvious.
- [ ] React detection exists where obvious.
- [ ] Install command mapping exists.
- [ ] Dev/start command mapping exists.
- [ ] Build command mapping exists.
- [ ] Test command mapping exists.
- [ ] Lint command mapping exists.
- [ ] Generic web prompt context exists.
- [ ] Fast tests cover package-script mapping.

Acceptance:

- A non-JSKIT Vue or React project can complete the core workflow naturally.

### SLICE 13: Adapter Author Documentation

Goal: Make adapter creation easy for other developers.

Instructions:

- Write the adapter author guide.
- Include the minimal fake adapter.
- Include JSKIT, C++, Python, and web examples.
- Document disabled reasons.
- Document prompt context.
- Document command result shapes.
- Document fast-test expectations.

Checklist:

- [ ] Adapter author guide exists.
- [ ] Minimal adapter example exists.
- [ ] JSKIT adapter example is documented.
- [ ] C++ adapter example is documented.
- [ ] Python adapter example is documented.
- [ ] Web adapter example is documented.
- [ ] Fast testing guidance is documented.
- [ ] No e2e testing guidance is included.

Acceptance:

- A competent developer can create a basic adapter without reading Studio UI code.

### SLICE 14: Consolidate Studio Session Workflow

Goal: Keep one Studio session workflow after the runtime is wired and proven.

Instructions:

- Remove duplicate retired workflow state code.
- Remove duplicate UI workflow inference.
- Remove duplicate prompt-generation paths.
- Remove deterministic command dispatch paths that duplicate runtime actions.
- Remove non-`.vibe64` Studio workflow assumptions.
- Remove dead endpoints and client API calls replaced by the runtime.
- Do not keep compatibility routes.
- Do not keep fallback behavior that hides runtime errors.
- Do not keep migration helpers.
- Keep only code that is used by the runtime, adapters, terminal, or current Studio UI.

Checklist:

- [x] Duplicate retired state machine code is deleted.
- [x] Duplicate retired button mapping code is deleted.
- [x] Duplicate retired prompt construction code is deleted.
- [x] Duplicate retired command execution code is deleted.
- [x] Non-`.vibe64` Studio workflow reads are absent.
- [x] Replaced API routes are deleted.
- [x] Replaced client API helpers are deleted.
- [x] Dead view-model branches are deleted.
- [x] No compatibility routes remain.
- [x] No fallback executor remains.
- [ ] Fast tests cover the runtime path.

Acceptance:

- Studio uses one workflow system: the Vibe64 runtime.
- Searching the codebase does not reveal an alternate retired workflow path.

### SLICE 15: Final Audit And Simplification

Goal: Make Studio feel like one coherent product, with clear vocabulary and no unnecessary complexity.

Instructions:

- Search for stale JSKIT product naming outside adapter-owned code.
- Search for retired setup concepts.
- Search for session-root assumptions, compatibility language, and fallback behavior.
- Remove dead files, dead tests, and unused exports.
- Simplify names that still describe implementation history instead of product behavior.
- Keep the runtime, adapters, UI, and tests easy to read.
- Run fast tests only.
- Do not add e2e tests.

Checklist:

- [x] No stale JSKIT product naming remains outside JSKIT adapter code.
- [x] No non-`.vibe64` session root behavior remains.
- [x] No compatibility or migration behavior remains.
- [x] No duplicate workflow state remains.
- [x] Studio Setup, Adapter Setup, and Project Setup are the only setup concepts.
- [x] Dead files are deleted.
- [x] Unused exports are deleted.
- [ ] Tests describe current behavior.
- [ ] Fast test suite passes.
- [x] Documentation matches the final architecture.

Acceptance:

- A new engineer can trace Studio from UI button to runtime action to adapter behavior to session file.

## Implementation Order

Use the execution slices above as the primary plan. This shorter order is only a quick dependency reminder:

- [ ] Create session store.
- [ ] Create workflow definition model.
- [ ] Create runtime class.
- [ ] Create action model.
- [ ] Create prompt renderer.
- [ ] Create JSKIT adapter.
- [ ] Wire Studio to runtime session view.
- [ ] Render checklist from runtime.
- [ ] Render buttons from runtime.
- [ ] Wire terminal prompt injection.
- [ ] Wire issue/PR artifact editors.
- [ ] Complete JSKIT vertical slice.
- [ ] Create C++ adapter.
- [ ] Complete C++ vertical slice.
- [ ] Create Python adapter.
- [ ] Create generic web adapter.
- [ ] Write adapter author docs.
- [ ] Consolidate Studio session workflow.
- [ ] Run final audit and simplification pass.

## Decisions To Make Early

- [ ] Runtime language and package boundary.
- [ ] Session directory shape.
- [ ] Workflow definition file format.
- [ ] Prompt pack directory shape.
- [ ] Adapter discovery rules.
- [ ] Whether GitHub provider is core or pluggable from day one.
- [ ] Whether worktrees are core or adapter capability.
- [x] Final setup vocabulary.
- [ ] How to represent unavailable steps.
- [ ] How to show disabled reasons in Studio.

## Decisions To Delay

- [ ] Marketplace-style adapter loading.
- [ ] Multiple workflow templates.
- [ ] Non-GitHub providers.
- [ ] Remote execution.
- [ ] Multi-agent coordination.
- [ ] Complex project graph support.
- [ ] Generated adapter scaffolding.

## Definition Of Done

The rebuild is successful when:

- [ ] The product is named `vibe64`.
- [ ] The state machine lives in Vibe64 core.
- [ ] JSKIT is only an adapter.
- [ ] At least one non-JSKIT adapter works end to end.
- [ ] The checklist remains intact.
- [ ] Every button maps to a runtime action.
- [ ] Buttons remain visible and disabled when unavailable.
- [ ] Prompts adapt to the target environment.
- [ ] No npm assumptions exist outside web/JSKIT adapters.
- [ ] No JSKIT assumptions exist in the core runtime.
- [ ] No duplicate retired workflow remains.
- [ ] A developer can add a simple adapter without reading UI code.
