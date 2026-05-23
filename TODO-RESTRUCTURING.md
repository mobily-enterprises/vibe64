# AI Studio State Machine Restructuring TODO

## Goal

Make AI Studio workflow steps server-owned, explicit, and easy to reason about.

The client must not create or understand artifacts. The UI should only render the current server-provided step view and submit input. Codex should update state through the same server contract as the UI.

## Core Contract

- [x] Define one machine input contract for all step input.
- [x] Replace "form save" thinking with generic current-step input.
- [x] Support input kinds such as `ready`, `need_input`, `user_response`, `confirm_files`, `skip`, and `consider_resolved`.
- [x] Rename or rework `PUT /step-input` into a generic current-step input endpoint.
- [x] Make the endpoint usable by both the web UI and Codex helpers.

## Proposed Structures

### Create Issue

The issue machine starts with discussion. It does not start by asking Codex to infer an issue from repository state.

State flow:

- `need_input`
  - Purpose: discuss and define the issue scope.
  - State details:
    - `doing=discussion`
  - The server exposes the current prompt/message and expected input shape.
  - The user can answer through the UI.
  - Codex can answer by calling the same helper endpoint.
  - When the issue is defined, input kind `ready` supplies:
    - issue title
    - issue body
    - session label
  - On valid `ready`, the server writes temporary issue files and moves to `confirm_files`.

- `confirm_files`
  - Purpose: let the user review and edit the generated issue title/body/session label before any GitHub command runs.
  - The UI and Inspect mode both display the same server-provided form/state.
  - The client does not know artifact names.
  - Saving updates server-owned temporary files.
  - Confirming moves to `attempting_execution`.

- `attempting_execution`
  - Purpose: run the command that creates or records the GitHub issue.
  - The command reads the server-owned temporary files.
  - On success:
    - write permanent outputs such as issue URL, issue number, and issue source.
    - move to `done`.
  - On failure:
    - store the command failure output.
    - move to `need_input`.
    - set `from=attempting_execution`.

- `need_input` with `from=attempting_execution`
  - Purpose: ask the user/Codex what to do about the failed command.
  - A valid response returns to `attempting_execution`.
  - The command is then rerun.

- `done`
  - Purpose: issue is selected or created.
  - Next step can proceed.

Existing issue path:

- Using an existing issue must enter the same machine.
- On success, it writes the same permanent output shape and moves to `done`.
- On failure, it moves to `need_input` with a clear message.

### Create Pull Request

The PR machine starts by asking Codex to infer the PR content from repository state.

State flow:

- `awaiting_agent_result`
  - Purpose: ask Codex to inspect the repository status and produce pull request content.
  - No direct user input is required at the start.
  - Codex receives a prompt describing the required helper contract.
  - Codex must call the helper with either `ready` or `need_input`.
  - If Codex calls `ready`, it supplies:
    - pull request title
    - pull request body
  - On valid `ready`:
    - the server writes temporary PR files.
    - move to `confirm_files`.
  - If Codex calls `need_input`:
    - store the question/message for the user.
    - move to `need_input`.
    - set `from=awaiting_agent_result`.

- `need_input` with `from=awaiting_agent_result`
  - Purpose: answer Codex's question before PR content can be resolved.
  - The user can answer through the UI.
  - The user can answer directly in Inspect mode.
  - Codex can continue and eventually call the helper with `ready` or another `need_input`.
  - Once the input loop completes, return to `awaiting_agent_result`.

- `confirm_files`
  - Purpose: let the user review and edit the PR title/body before any GitHub command runs.
  - The UI displays the server-provided form/state.
  - The client does not know artifact names.
  - Saving updates server-owned temporary files.
  - Confirming moves to `attempting_execution`.

- `attempting_execution`
  - Purpose: run the command that creates or records the GitHub pull request.
  - The command reads the server-owned temporary files.
  - On success:
    - write permanent outputs such as PR URL, PR number, and PR source.
    - move to `done`.
  - On failure:
    - store the command failure output.
    - move to `need_input`.
    - set `from=attempting_execution`.

- `need_input` with `from=attempting_execution`
  - Purpose: ask the user/Codex what to do about the failed PR command.
  - A valid response returns to `attempting_execution`.
  - The command is then rerun.

- `done`
  - Purpose: pull request exists or is recorded.
  - Next step can proceed.

Output convention:

- Temporary draft files are server-owned and disposable.
- Permanent outputs are server-owned and stable.
- The client never creates either kind directly.
- Following steps consume permanent outputs through server-provided state, not hard-coded client artifact names.

## Codex Helper

- [x] Add one helper command/API that Codex can call to submit current-step input.
- [x] Let Codex submit `ready` with structured fields.
- [x] Let Codex submit `need_input` with a user-facing message.
- [x] Let Codex submit user/conversation responses when needed.
- [x] Ensure helper errors explain the expected schema clearly so Codex can retry correctly.

## Generic Need Input State

- [x] Make `need_input` a real generic conversation state.
- [x] Store the latest prompt to the user server-side.
- [x] Store optional input schema server-side.
- [x] Store the state to resume from, such as `awaiting_agent_result` or `attempting_execution`.
- [x] On valid user/Codex response, return to the recorded resume state.
- [x] Keep the UI as a view of this server state only.

## Resolution State

- [x] Implement `awaiting_agent_result`.
- [x] Let a machine start a repo-status prompt when it needs AI to produce files from repository state.
- [x] Require Codex to call the helper with either `ready` or `need_input`.
- [x] On `ready`, write server-owned temporary files and move to `confirm_files`.
- [x] On `need_input`, move to `need_input` with `from=awaiting_agent_result`.

## Create Issue

- [x] Refactor create issue into the intended flow:
  - [x] `need_input` for discussion.
  - [x] `ready` from UI or Codex helper.
  - [x] `confirm_files`.
  - [x] `attempting_execution`.
  - [x] `done` or `need_input(from=attempting_execution)`.
- [x] Keep issue title, body, and session label writes on the server.
- [x] Ensure using an existing issue goes through the same machine state model.

## Create Pull Request

- [x] Refactor PR creation into the intended flow:
  - [x] `awaiting_agent_result`.
  - [x] `confirm_files`.
  - [x] `attempting_execution`.
  - [x] `done` or `need_input(from=attempting_execution)`.
- [x] Have AI produce PR content from repository status.
- [x] Keep PR title/body draft files server-owned.
- [x] Keep PR URL/number/source outputs server-owned.

## Command Failures

- [x] Make command failure enter `need_input`.
- [x] Preserve the failed command output for review.
- [x] Let the user explain what to do next.
- [x] Let Codex work through the failure using the helper contract.
- [x] When resolved, resume `attempting_execution` and rerun the command.

## UI Contract

- [x] Make the UI render only the server-provided step view.
- [x] Keep the UI unaware of artifact names and temporary file paths.
- [x] Display only server-provided fields, messages, buttons, and status.
- [x] Submit all input through the generic current-step input endpoint.
- [x] Make Autopilot and Inspect share the same server contract.

## Inspect Mode

- [x] Keep Inspect terminal-first.
- [x] Instruct Codex to call the same helper when it needs to update Studio state.
- [x] Do not parse live terminal output for state transitions.
- [x] Keep direct terminal chat possible for advanced users.

## Remove Old Assumptions

- [x] Remove code that treats issue form submission as direct artifact ownership by the client.
- [x] Remove code that treats PR form submission as direct artifact ownership by the client.
- [x] Remove any remaining client knowledge of issue/PR artifact paths.
- [x] Remove terminal marker parsing from state progression paths.
- [x] Remove obsolete prompt/file conventions once the helper contract replaces them.

## Tests

- [x] Add focused unit tests for each mini state machine.
- [x] Test initial state.
- [x] Test valid input transitions.
- [x] Test `need_input` transitions.
- [x] Test command success.
- [x] Test command failure.
- [x] Test resume after user response.
- [x] Test rewind cleanup.
- [x] Test that UI input and Codex helper input hit the same server path.

## Convert Remaining Steps

- [x] Convert simple command steps.
- [x] Convert conversation steps.
- [x] Convert file-confirmation steps.
- [x] Convert prompt/AI-resolution steps.
- [x] Convert final/finish steps.
- [x] Delete compatibility glue after each converted area is covered by tests.

## Acceptance Criteria

- [x] The client never writes workflow artifacts directly.
- [x] The client never needs to know artifact names.
- [x] Codex and UI submit through the same machine input contract.
- [x] Each workflow step owns its state transitions in one easy-to-read machine.
- [x] Reloading never causes automatic duplicate prompts or commands.
- [x] Inspect mode can still be used manually without Autopilot taking over.
- [x] Autopilot can resume from persisted machine state without reading terminal output.
