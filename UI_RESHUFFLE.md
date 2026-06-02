# UI Reshuffle TODO

This document tracks the full vertical slice for reorganizing command execution
and the related session UI surfaces.

The central rule: command scope is explicit data. UI placement must not decide
where a command runs, which terminal owns it, whether Codex can repair it, or
where audit output is recorded.

## Goals

- [ ] Reuse the current hidden-by-default terminal runner pattern used by
      session init.
- [ ] Make every command explicitly scoped as `project`, `session`, or `system`.
- [ ] Keep command status compact by default, with terminal output available
      when needed.
- [ ] Show starred scripts by default, while keeping all scripts reachable.
- [ ] Add `Diff` as a real tab after `Preview`, `Dashboard`, `Shell`, and
      `AI Terminal`.
- [ ] Move artifacts into chat, with takeover only when focused review or
      interaction is required.
- [ ] Keep raw workflow action lists out of the user UI.
- [ ] Replace old Inspect diagnostics with concise chat/status messages.
- [ ] Ensure "Fix with Codex" uses the Codex agent matching the command scope.

## Non-Goals

- [ ] Do not rebuild old Inspect as a panel.
- [ ] Do not add local path fallbacks or hard-coded machine-specific paths.
- [ ] Do not create a second diff/review implementation.
- [ ] Do not route project failures into session Codex.
- [ ] Do not expose raw internal workflow actions as a user-facing list.

## Slice 1: Scoped Command Contract

### Problem

Command behavior currently risks being inferred from UI placement. That is
fragile because the same visual runner pattern is needed for project scripts,
session scripts, workflow commands, generic git commands, and session init.

### Target Shape

Define or formalize one command invocation contract with explicit execution and
presentation metadata.

```ts
type CommandScope = 'project' | 'session' | 'system'

type CommandSource =
  | 'script'
  | 'workflow'
  | 'git'
  | 'init'
  | 'manual'
  | 'repair'

type CommandRepairPolicy =
  | 'none'
  | 'session-codex'
  | 'project-codex'

type CommandAuditTarget =
  | 'chat'
  | 'runtime-log'
  | 'both'

type CommandInvocation = {
  id: string
  scope: CommandScope
  source: CommandSource
  label: string
  cwd: string
  command: string | string[]
  terminalMode: 'hidden-by-default'
  repairPolicy: CommandRepairPolicy
  auditTarget: CommandAuditTarget
  sessionId?: string
}
```

### Tasks

- [ ] Find all current command entry points used by session init, scripts,
      workflow actions, and generic git/project commands.
- [ ] Identify the existing session-init terminal runner and its state model.
- [ ] Add or adapt a shared command invocation type.
- [ ] Ensure `cwd` is resolved by the command layer, not guessed by UI
      components.
- [ ] Ensure `session` commands run inside the active Vibe64 session runtime
      workspace.
- [ ] Ensure `project` commands run in the main project root.
- [ ] Ensure `system` commands are reserved for Vibe64 orchestration.
- [ ] Ensure command events include enough data for compact UI status, terminal
      reveal, logs, and repair actions.
- [ ] Keep command execution repo-portable and reproducible in a clean checkout.

### Acceptance Criteria

- [ ] A command cannot run unless its scope is known.
- [ ] UI components do not infer execution scope from tab, route, or component
      nesting.
- [ ] Project commands and session commands can use the same runner UI.
- [ ] Terminal logs are captured even when hidden.
- [ ] The command model can decide whether repair is available without checking
      UI component names.

## Slice 2: Hidden-By-Default Terminal Runner

### Problem

Command output should not dominate the UI, but it must remain available for
debugging, failure review, input prompts, and repair.

### Target Shape

Reuse the session-init style command runner everywhere:

- compact progress/status by default
- terminal hidden by default
- terminal visible on demand
- terminal made prominent when input, failure, or repair context requires it

### Tasks

- [ ] Extract or reuse the existing session-init terminal runner presentation.
- [ ] Support compact states: queued, running, succeeded, failed, cancelled,
      waiting for input.
- [ ] Add a clear "show terminal" or equivalent details affordance.
- [ ] Auto-surface terminal access on failure without permanently expanding all
      output.
- [ ] Preserve command output in runtime logs.
- [ ] Ensure command status can be rendered in chat, tabs, or command panels.
- [ ] Avoid duplicate terminal UI implementations for scripts, init, and
      workflow commands.

### Acceptance Criteria

- [ ] Session init still uses the same UI behavior as before.
- [ ] Project scripts use the same hidden-by-default terminal behavior.
- [ ] Session scripts use the same hidden-by-default terminal behavior.
- [ ] Failed commands expose captured output without forcing terminal output to
      always be visible.
- [ ] Commands that need input expose that state clearly.

## Slice 3: Command Scope Rules

### Problem

The app needs generic project commands and session commands, but the repair and
chat behavior must follow the command scope.

### Target Shape

Scopes:

- `project`: main repository commands, generic git commands, main Run screen
  scripts.
- `session`: active session worktree commands, session tab scripts, session
  workflow commands.
- `system`: orchestration commands owned by Vibe64 itself.

### Tasks

- [ ] Add explicit scope at every command creation site.
- [ ] Route generic git commands from the main repo as `project`.
- [ ] Route scripts launched from the main Run screen as `project`.
- [ ] Route scripts launched from the session tab as `session`.
- [ ] Route session init and workflow operations as `session` or `system`
      according to their actual ownership.
- [ ] Make unsupported scope/repair combinations impossible or visibly disabled.
- [ ] Add logging that includes scope, source, label, and session id when
      relevant.

### Acceptance Criteria

- [ ] Main repo git commands never run inside a session worktree by accident.
- [ ] Session scripts never run in the main repo by accident.
- [ ] System orchestration commands do not present a session Codex repair path.
- [ ] Logs make the command scope auditable.

## Slice 4: "Fix With Codex" Repair Flow

### Problem

"Fix with Codex" must preserve context. A failed session command should use the
existing session Codex. A failed project command must not be sent to a session
Codex.

### Target Shape

Repair policy follows command scope:

- `session` command with `session-codex`: use the existing session Codex.
- `project` command with `project-codex`: use a future project-level Codex if
  it exists.
- `project` command without project Codex: show repair unavailable.
- `system` command: usually no Codex repair.

For session repair, the prompt is injected into chat before being sent to Codex
so the audit log is complete.

### Tasks

- [ ] Locate the existing session Codex identity and send-prompt path.
- [ ] Add a command failure action that checks `repairPolicy`.
- [ ] For `session-codex`, create a chat-visible repair prompt first.
- [ ] Send the same prompt to the existing session Codex terminal/thread.
- [ ] Include command label, command text, scope, cwd summary, exit code, and
      relevant error output in the repair prompt.
- [ ] If session Codex is booting or blocked, show the existing readiness flow.
- [ ] Disable or hide repair for unsupported `project` and `system` commands.
- [ ] Avoid creating a new Codex process for session repair.

### Acceptance Criteria

- [ ] Failed session commands can be repaired by the existing session Codex.
- [ ] The repair request is visible in chat before Codex acts.
- [ ] Failed project commands do not use session Codex.
- [ ] Failed system commands do not offer misleading repair.
- [ ] The terminal and chat remain synchronized around repair activity.

## Slice 5: Scripts Surface

### Problem

The old Inspect mode exposed script management. The new Run surface is cleaner,
but must not lose the ability to reach all scripts or manage starred scripts.

### Target Shape

Use one script browser component with explicit execution scope:

- main Run screen: `project` scope, main repository cwd
- session tab: `session` scope, active session workspace cwd

Both show starred scripts by default and allow showing all scripts.

### Tasks

- [ ] Identify the current script panel/component and all modes.
- [ ] Add explicit script execution scope to the component API.
- [ ] Default the visible list to starred scripts.
- [ ] Add a "show all" affordance that reveals unstarred scripts.
- [ ] Preserve star, unstar, and reset starred-script management.
- [ ] Ensure script ordering is stable and deterministic.
- [ ] Ensure running a script creates a scoped `CommandInvocation`.
- [ ] Keep script metadata aligned with actual runnable behavior.

### Acceptance Criteria

- [ ] Project Run screen runs scripts in the main repo.
- [ ] Session Run tab runs scripts in the session workspace.
- [ ] Starred scripts are shown by default.
- [ ] All scripts remain reachable.
- [ ] Star management remains available.
- [ ] Script execution uses the shared hidden-by-default terminal runner.

## Slice 6: Diff Tab

### Problem

Diff/review should be first-class in the new layout, not buried behind an old
modal or button-only flow.

### Target Shape

Add a `Diff` tab after:

1. `Preview`
2. `Dashboard`
3. `Shell`
4. `AI Terminal`
5. `Diff`

The tab reuses the existing review/diff state and actions.

### Tasks

- [ ] Locate the existing diff/review state and open-dialog action.
- [ ] Extract the reusable diff body if it currently only exists inside a
      dialog.
- [ ] Add the `Diff` tab to the session tab model in the required order.
- [ ] Render existing diff content inside the tab.
- [ ] Preserve accept/reject/review actions where they already exist.
- [ ] Add concise empty and unavailable states.
- [ ] Avoid introducing a second diff backend or duplicate review state.

### Acceptance Criteria

- [ ] `Diff` appears as a right-side tab after `AI Terminal`.
- [ ] Existing review behavior still works.
- [ ] No-change state is clear.
- [ ] Unavailable state explains the reason briefly.
- [ ] Accept/reject actions are available only when valid.

## Slice 7: Artifacts In Chat

### Problem

Old Inspect report and artifact blocks should not return as permanent side
panels. Artifacts belong in the chat timeline, with takeover only when focused
review or interaction is needed.

### Target Shape

Artifacts are chat-native:

- artifact creation appears as a chat event
- focused review/edit can take over the chat pane
- completion returns to normal chat
- results are recorded back into chat history

### Tasks

- [ ] Identify current report preview, human input response preview, and
      artifact display paths.
- [ ] Define a chat artifact event shape.
- [ ] Add or reuse a chat takeover state for focused artifact interaction.
- [ ] Route report previews into chat takeover when review is needed.
- [ ] Route human-input response previews into chat takeover when needed.
- [ ] Ensure closing, accepting, rejecting, or completing an artifact records a
      chat-visible result.
- [ ] Keep artifacts out of permanent Inspect-style panels.

### Acceptance Criteria

- [ ] Artifact review happens in the chat area.
- [ ] Focused artifact interaction can take over the chat pane.
- [ ] Normal chat returns after artifact handling.
- [ ] The chat log shows what artifact action happened.
- [ ] No duplicate artifact panel is required for normal use.

## Slice 8: Workflow Controls Without Raw Action Lists

### Problem

The old full action list exposed implementation details. The new UI should show
only the correct controls for the current state.

### Target Shape

Render valid user controls only:

- continue
- next
- approve
- reject
- retry
- open diff
- run script
- fix with Codex
- answer prompt

Raw workflow actions remain internal data.

### Tasks

- [ ] Locate current workflow control model and action rendering.
- [ ] Ensure the presentation model filters to user-valid controls.
- [ ] Remove or avoid any UI that shows every raw action.
- [ ] Keep disabled or unavailable internal actions out of the main UI.
- [ ] Preserve enough metadata for concise diagnostics when no user action is
      currently possible.
- [ ] Ensure control availability is derived from workflow state, not manually
      duplicated in components.

### Acceptance Criteria

- [ ] Users see only valid controls.
- [ ] Raw action lists are not exposed in the main session UI.
- [ ] Missing controls have a clear status message when user action is expected.
- [ ] Internal workflow metadata remains available to code and tests.

## Slice 9: Concise Diagnostics

### Problem

Old Inspect diagnostics were useful but too panel-heavy. The new UI needs the
information without restoring the old inspector.

### Target Shape

Diagnostics appear as short chat/status messages.

Examples:

- `Waiting for user input.`
- `Diff is unavailable until the worktree exists.`
- `Command failed. Terminal output is available.`
- `Session Codex is not ready yet.`
- `No valid action is available for the current step.`

### Tasks

- [ ] Identify current disabled-action reasons and action result notices.
- [ ] Map each useful diagnostic to a short status/chat message.
- [ ] Route command failure diagnostics through the command runner.
- [ ] Route workflow blocked diagnostics through the workflow presentation
      model.
- [ ] Avoid large diagnostic panels.
- [ ] Avoid silent fallback behavior.

### Acceptance Criteria

- [ ] Blocked states explain what matters in one concise message.
- [ ] Failed commands point to terminal output.
- [ ] Unavailable diff, repair, or workflow controls explain why briefly.
- [ ] Diagnostics do not expose raw internal action lists.

## Slice 10: Navigation And Tab Placement

### Problem

The new layout must expose capabilities in stable, predictable places.

### Target Shape

Session tabs include:

1. `Preview`
2. `Dashboard`
3. `Shell`
4. `AI Terminal`
5. `Diff`

Session command/script surfaces use the same runner UI and explicit session
scope.

### Tasks

- [ ] Confirm current tab registry and ordering.
- [ ] Add `Diff` without disturbing existing tab behavior.
- [ ] Keep session info/facts in `Dashboard`.
- [ ] Keep Shell and AI Terminal surfaces as existing tabs.
- [ ] Place session scripts where they are reachable without reopening old
      Inspect.
- [ ] Ensure responsive layout does not overlap tab labels or controls.

### Acceptance Criteria

- [ ] Tab order matches the target order.
- [ ] Dashboard remains the session information surface.
- [ ] Shell and AI Terminal still work.
- [ ] Diff is reachable without modal-only navigation.

## Slice 11: Tests And Verification

### Problem

This reshuffle changes runtime behavior and UI placement. It needs verification
for scope correctness, command visibility, and no regression of existing session
init behavior.

### Tasks

- [ ] Add unit tests for command scope resolution.
- [ ] Add tests that project commands use the project root.
- [ ] Add tests that session commands use the session workspace.
- [ ] Add tests that unsupported repair policies are not shown.
- [ ] Add tests that session repair uses existing session Codex plumbing.
- [ ] Add tests for starred-by-default script filtering and show-all behavior.
- [ ] Add tests for deterministic script ordering.
- [ ] Add tests for Diff tab availability and empty/unavailable states.
- [ ] Add tests for chat artifact takeover state transitions.
- [ ] Add tests that raw action lists are not rendered.
- [ ] Add tests for concise blocked/failed diagnostics.
- [ ] Run repository verification through `npx jskit ...` commands, not a
      global `jskit` binary.

### Manual Verification Checklist

- [ ] Start a session and confirm session init still uses hidden-by-default
      terminal output.
- [ ] Run a project script from the main Run screen and confirm it runs in the
      main repo.
- [ ] Run a session script from the session tab and confirm it runs in the
      session workspace.
- [ ] Toggle from starred scripts to all scripts.
- [ ] Star, unstar, and reset scripts where management is supported.
- [ ] Open `Diff` and confirm changes render there.
- [ ] Confirm no-change and unavailable diff states are understandable.
- [ ] Trigger a failed session command and confirm "Fix with Codex" sends the
      prompt to the existing session Codex.
- [ ] Confirm the repair prompt is visible in chat.
- [ ] Trigger or inspect a failed project command and confirm it does not use
      session Codex.
- [ ] Review an artifact and confirm it takes over chat only while active.
- [ ] Confirm raw workflow actions are not visible.
- [ ] Confirm blocked workflow states show short diagnostics.

## Implementation Order

- [ ] Slice 1: Scoped command contract.
- [ ] Slice 2: Hidden-by-default terminal runner.
- [ ] Slice 3: Command scope rules.
- [ ] Slice 4: "Fix with Codex" repair flow.
- [ ] Slice 5: Scripts surface.
- [ ] Slice 6: Diff tab.
- [ ] Slice 7: Artifacts in chat.
- [ ] Slice 8: Workflow controls without raw action lists.
- [ ] Slice 9: Concise diagnostics.
- [ ] Slice 10: Navigation and tab placement.
- [ ] Slice 11: Tests and verification.

## Drift Guards

- [ ] No component may infer command scope from visual placement.
- [ ] No command may run without scope and cwd resolved by the command layer.
- [ ] No project command may be repaired by session Codex.
- [ ] No session command may create a new Codex session for repair when an
      existing session Codex is available.
- [ ] No diff tab may introduce separate review state from the existing diff
      model.
- [ ] No artifact surface may bypass chat audit history.
- [ ] No raw action list may be restored as a normal user-facing panel.
- [ ] No verification command may assume a global `jskit` binary.

