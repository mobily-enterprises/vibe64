# Unified Client Terminal Element Plan

Status: implemented in isolated public and hosted worktrees; verification is
recorded below.

This document defines the work required to create one canonical client terminal
element for every Vibe64 terminal use case, then migrate existing terminal
contexts to it one at a time.

The public facade will be referred to as `Vibe64Terminal` throughout this plan.
The final exported name may change during the contract slice, but there must be
exactly one public terminal element and one underlying client terminal runtime.

## Implementation Outcome

- [x] Created the public `Vibe64Terminal` facade and its private surface.
- [x] Created one canonical runtime with visible, hidden-listening, and headless
      operation.
- [x] Added WebSocket and HTTP-polling drivers.
- [x] Added declarative output/state matchers and behavior policies.
- [x] Added controlled launcher, inline, dialog, fullscreen, floating,
      minimized, collapsed, hidden, and headless presentation support.
- [x] Added explicit owned-versus-attached teardown and detach behavior.
- [x] Migrated all thirteen audited client contexts.
- [x] Migrated the main Codex session to a domain wrapper around
      `Vibe64Terminal`; it is not a second terminal element.
- [x] Deleted every superseded terminal shell and both former direct xterm
      owners.
- [x] Added a permanent drift test requiring direct xterm construction to stay
      inside `useVibe64Terminal`.
- [x] Built the public app and the composed hosted app from the isolated
      worktrees.
- [x] Passed the complete public client suite (78 files, 544 tests), full
      ESLint, package-boundary verification, and terminal-focused browser tests.
- [x] Confirmed the broad server-suite failures also occur without these client
      changes; no server source was changed by this implementation.
- [x] Preserved the original dirty checkouts, hosted public submodule, and
      deployment-generated source boundaries.

The detailed checklist below is retained as the original audit and design
record. Checked items describe delivered work; unchecked items are explicit
future hardening or API expansion and are not silently claimed as complete.

This plan supersedes the client-side scope and broad-refactor non-goals in
`docs/terminal-taxonomy-unification-plan.md`. The completed server-side terminal
access and route helpers from that earlier plan remain valid and should be
reused.

## Repository Boundaries

- [x] Treat `/home/merc/Development/current/vibe64` as the writable public
      Vibe64 source of truth.
- [x] Treat `/home/merc/Development/current/vibe64-online` as the hosted-only
      source for deployment publishing and other private overlays.
- [x] Never edit the deployment-managed
      `vibe64-online/submodules/public-vibe64-local-editor` mirror.
- [x] Never edit `.vibe64-online-generated/app` manually.
- [x] Implement the generic terminal element, runtime, drivers, contracts, and
      public tests in the public `vibe64` repository.
- [x] Keep hosted deployment-specific state and orchestration in
      `vibe64-online` while making it consume the public terminal element.
- [x] Preserve unrelated dirty-worktree changes in both repositories.

## Product Decision

- [x] Export one canonical public component: `Vibe64Terminal`.
- [x] Back it with one canonical client terminal runtime.
- [x] Make visible, hidden, and headless operation use the same runtime and
      transcript model.
- [x] Express backend differences through terminal drivers.
- [x] Express automatic behavior through declarative rules and policies.
- [x] Express content detection through first-class matchers.
- [x] Express domain-specific UI through slots and external controllers.
- [x] Do not implement terminal families through `terminalKind` conditionals.
- [x] Do not allow any migrated workflow to create xterm directly.
- [x] Do not allow any migrated workflow to maintain a competing terminal
      transcript, socket, polling, resize, or output-reconciliation engine.
- [x] Keep workflow semantics outside the terminal core.

The intended internal shape is:

```text
Workflow controller
        |
        v
<Vibe64Terminal> public facade
        |
        +-- canonical terminal controller/state machine
        +-- canonical transcript and output matcher engine
        +-- behavior policy/rule engine
        +-- canonical xterm display runtime
        +-- shared presentation surfaces
        `-- injected session/transport driver
```

## Audited Terminal Inventory

The initial read-only audit found two direct xterm owners and ten behavior
families across thirteen concrete client contexts.

- [x] Inventory direct xterm construction in `src/` and public client packages.
- [x] Inventory terminal consumers in hosted-only client packages.
- [x] Inventory visible, hidden-listening, and headless terminal paths.
- [x] Inventory terminal behavior encoded in client unit tests and launch E2E
      tests.
- [x] Confirm direct xterm ownership currently exists in exactly:
  - [x] `src/composables/useStudioTerminal.js`
  - [x] `src/composables/useDoctorTerminal.js`
- [x] Re-run the inventory immediately before implementation begins.
- [x] Add a permanent client-side drift test.

Concrete contexts to migrate:

- [x] Session Codex terminal.
- [x] Fix-Codex terminal.
- [x] Workflow command terminal.
- [x] Project-tool terminal.
- [x] Headless Autopilot command runner.
- [x] Launch/preview terminal.
- [x] Target-script terminal.
- [x] Account-authentication terminal.
- [x] Studio Setup Doctor manual terminal.
- [x] Studio Setup Doctor automatic terminal.
- [x] Project Setup Doctor manual terminal.
- [x] Project Setup Doctor automatic terminal.
- [x] Hosted deployment-publish terminal.

## Non-Negotiable State Model

The implementation must not overload one `status`, `visible`, or `open` value
with unrelated meanings.

### Session State

- [ ] Represent `idle`.
- [ ] Represent `starting`.
- [ ] Represent `running`.
- [ ] Represent `closing`.
- [ ] Represent `exited`.
- [ ] Represent `failed` without losing the underlying exit information.
- [ ] Represent `stale` or restart-required sessions.
- [ ] Preserve session id, command preview, exit code, close error, metadata,
      dimensions, output version, truncation state, and activity timestamps when
      supplied by a driver.

### Connection State

- [ ] Represent `detached`.
- [ ] Represent `connecting`.
- [ ] Represent `connected`.
- [ ] Represent `reconnecting`.
- [ ] Represent `disconnected`.
- [ ] Keep connection state independent from session/process state.
- [ ] Permit a running process to have no active client connection.
- [ ] Permit an exited process to retain a mounted transcript display.

### Ownership State

- [ ] Represent no session ownership.
- [ ] Represent a terminal session owned by this element/controller.
- [ ] Represent an attached or shared terminal session owned elsewhere.
- [ ] Default attached/shared sessions to detach-only teardown.
- [ ] Require explicit policy before deleting a session owned elsewhere.
- [ ] Surface ownership mismatch distinctly from ordinary transport failure.

### Presentation State

- [ ] Represent launcher-only presentation.
- [ ] Represent collapsed/docked presentation.
- [ ] Represent inline presentation.
- [ ] Represent dialog presentation.
- [ ] Represent fullscreen presentation.
- [ ] Represent floating presentation.
- [ ] Represent minimized presentation.
- [ ] Represent hidden-but-running presentation.
- [ ] Represent fully headless presentation.
- [ ] Keep presentation changes independent from process and connection changes.

### Attention State

- [ ] Represent no attention request.
- [ ] Represent informational attention.
- [ ] Represent warning attention.
- [ ] Represent error attention.
- [ ] Represent named content/metadata matcher attention.
- [ ] Track whether a given attention event has already been shown or dismissed.
- [ ] Prevent an already-dismissed event from continuously reopening the terminal.

## Public Contract Slice

Complete this slice and approve its tests before migrating a production caller.

### Component Inputs

- [ ] Define a required or explicitly optional terminal driver input.
- [ ] Define start input separately from presentation configuration.
- [ ] Define initial session attachment input.
- [ ] Define owned versus attached session ownership input.
- [ ] Define interactive, read-only, and no-input modes.
- [ ] Define controlled and self-managed presentation modes.
- [ ] Define launcher configuration without restricting callers to a button.
- [ ] Define behavior policy input.
- [ ] Define output/state matcher input.
- [ ] Define transcript retention limits.
- [ ] Define resize strategy and debounce input.
- [ ] Define reconnect policy input.
- [ ] Define teardown policy input.
- [ ] Define geometry persistence key input.
- [ ] Define safe terminal theme/font/options input without exposing callers to
      unrestricted xterm ownership.

### Imperative API

- [ ] Expose `start`.
- [ ] Expose `attach`.
- [ ] Expose `restart`.
- [ ] Expose `show` and `hide`.
- [ ] Expose `expand`, `collapse`, and `minimize`.
- [ ] Expose `focus`.
- [ ] Expose raw `write` for programmatic terminal input.
- [ ] Expose named `sendKey` helpers.
- [ ] Expose `stop` or `interrupt` independently from `close`.
- [ ] Expose `close` independently from `detach`.
- [ ] Expose `copySelection` and `copyTranscript`.
- [ ] Expose `waitForExit`.
- [ ] Make unsupported driver operations fail predictably rather than silently.

### Normalized Events

- [ ] Emit `start-requested`, `starting`, and `started`.
- [ ] Emit `attached` and `detached`.
- [ ] Emit `connected`, `reconnecting`, and `disconnected`.
- [ ] Emit normalized `output` events.
- [ ] Emit named `match` events.
- [ ] Emit `metadata` and `status` changes.
- [ ] Emit user `input` and reported `resize` events.
- [ ] Emit `exit`, `error`, and exactly-once `settled` events.
- [ ] Emit `visibility-change` and `expanded-change` events.
- [ ] Emit `stop`, `close`, and `restart` events.
- [ ] Emit distinct `stale`, `access-denied`, and `ownership-error` events.
- [ ] Include session identity in every asynchronous event.
- [ ] Include event source and output version where applicable.

### Slots and Presentation Hooks

- [ ] Provide a launcher slot.
- [ ] Provide title, subtitle, and heading slots.
- [ ] Provide header-action slots.
- [ ] Provide starting, disabled, and restart-required overlay slots.
- [ ] Provide a content-overlay slot.
- [ ] Provide an error-presentation slot.
- [ ] Provide status and footer slots.
- [ ] Provide completion-action slots.
- [ ] Ensure slot customization does not require replacing the terminal host.

## Driver Contract

### Normalized Driver Capabilities

- [ ] Define a driver capability declaration.
- [ ] Define `start(input)`.
- [ ] Define `read` or `restore` for initial attachment.
- [ ] Define `subscribe(sessionId, handlers)`.
- [ ] Define `write(sessionId, data)`.
- [ ] Define `resize(sessionId, size)`.
- [ ] Define `interrupt(sessionId)`.
- [ ] Define process stop independently from session deletion where the backend
      distinguishes them.
- [ ] Define `close` or `delete`.
- [ ] Define `restart` or specify the standard close-plus-start fallback.
- [ ] Define polling support.
- [ ] Define `waitForExit` support.
- [ ] Define deterministic unsubscribe/dispose behavior.
- [ ] Require normalized session snapshots from every driver.
- [ ] Require driver errors to preserve access/ownership/stale classification.

### Initial Drivers

- [ ] Implement a standard Studio WebSocket driver on the existing terminal
      websocket protocol.
- [ ] Preserve snapshot, output, metadata, status, error, and resize-error
      message handling.
- [ ] Implement the Doctor HTTP-polling driver.
- [ ] Preserve Doctor POST start, GET poll, POST input, and DELETE close behavior.
- [ ] Support polling output that shrinks or is replaced without an
      `outputVersion`.
- [ ] Implement a deterministic fake driver for unit and component tests.
- [ ] Add a shared driver conformance suite.
- [ ] Require every future driver to pass that suite.

### Driver Boundaries

- [ ] Keep endpoint construction inside drivers or workflow adapters.
- [ ] Keep request authorization context inside drivers or workflow adapters.
- [ ] Keep project/session scoping inside drivers or workflow adapters.
- [ ] Keep xterm construction out of drivers.
- [ ] Keep presentation state out of drivers.
- [ ] Keep workflow progression out of drivers.

## Canonical Transcript Runtime

- [ ] Store canonical terminal output independently from xterm.
- [ ] Expose raw terminal bytes/text.
- [ ] Expose an ANSI/control-sequence-stripped text view.
- [ ] Bound transcript retention by an explicit policy.
- [ ] Preserve current parity for large terminal scrollback and transcript tails
      until a deliberate limit change is approved.
- [ ] Replay retained output when xterm mounts or remounts.
- [ ] Preserve output during metadata-only session updates.
- [ ] Reconcile snapshots and appended chunks.
- [ ] Respect monotonic `outputVersion` values.
- [ ] Ignore stale or equal-version replay events.
- [ ] Handle snapshot prefix extension without resetting xterm.
- [ ] Handle non-prefix transcript replacement safely.
- [ ] Handle server-side truncation explicitly.
- [ ] Handle polling output shrink/reset.
- [ ] Record whether each output notification came from append, snapshot, replay,
      or replacement.
- [ ] Keep transcript state when the terminal display is destroyed.
- [ ] Reset transcript only when session identity or explicit policy requires it.
- [ ] Prevent output from an old session entering the next session transcript.

## Output and State Matchers

Matchers are a core requirement, not a workflow-specific convenience.

- [ ] Support literal text matchers.
- [ ] Support regular-expression matchers.
- [ ] Support callback predicates.
- [ ] Support raw transcript matching.
- [ ] Support ANSI-stripped/plain transcript matching.
- [ ] Support status and exit-code predicates.
- [ ] Support error predicates.
- [ ] Support structured metadata predicates.
- [ ] Detect matches split across multiple output chunks.
- [ ] Detect matches present in initial snapshots.
- [ ] Support once-per-session matchers.
- [ ] Support repeating matchers.
- [ ] Deduplicate matches after reconnect, snapshot replay, and display remount.
- [ ] Support named matcher events.
- [ ] Preserve regular-expression capture groups.
- [ ] Include transcript offset, output version, source, session id, status, and
      metadata in match payloads.
- [ ] Allow a matcher to request generic terminal attention without embedding
      workflow behavior.
- [ ] Add tests for chunk-boundary matches.
- [ ] Add tests for replay deduplication.
- [ ] Add tests for transcript replacement and matcher cursor recovery.

Minimum match payload:

```js
{
  matcher: "deployment-url",
  sessionId: "terminal-1",
  text: "https://example.com",
  captures: [],
  transcriptOffset: 1234,
  outputVersion: 14,
  source: "append",
  status: "running",
  metadata: {}
}
```

## Behavior Rule Engine

Use an event/predicate/action model. Common props may compile into these rules,
but must not create a second behavior implementation.

### Rule Triggers

- [ ] Support session-start triggers.
- [ ] Support connection triggers.
- [ ] Support status and exit triggers.
- [ ] Support normalized error triggers.
- [ ] Support named matcher triggers.
- [ ] Support metadata triggers.
- [ ] Support manual presentation triggers.
- [ ] Support elapsed-delay triggers.

### Rule Actions

- [ ] Show.
- [ ] Hide.
- [ ] Expand.
- [ ] Collapse.
- [ ] Minimize.
- [ ] Focus.
- [ ] Emit a named external event.
- [ ] Send programmatic terminal input.
- [ ] Disconnect.
- [ ] Interrupt or stop.
- [ ] Close/delete.
- [ ] Restart.

### Rule Semantics

- [ ] Support show/expand on normalized error.
- [ ] Support show/expand on nonzero exit.
- [ ] Support remaining open after failure.
- [ ] Support automatic hide after successful exit.
- [ ] Support starting collapsed.
- [ ] Support starting as launcher-only.
- [ ] Support delayed actions.
- [ ] Support once-per-session rules.
- [ ] Define deterministic rule ordering.
- [ ] Define precedence between automatic rules and manual user choices.
- [ ] Remember dismissal of already-seen attention events.
- [ ] Cancel timers when session identity or scope changes.
- [ ] Cancel timers during teardown.
- [ ] Prevent a late success-hide timer from hiding a newer failure.
- [ ] Add named presets only after their behavior is expressed by generic rules.

Initial policy presets to consider:

- [ ] Interactive command.
- [ ] Attach and review.
- [ ] Background task with failure attention.
- [ ] Launcher/preview.
- [ ] Headless runner.
- [ ] Authentication.
- [ ] Doctor polling.

## Canonical xterm Display Runtime

- [ ] Lazy-load xterm and FitAddon.
- [ ] Preserve async module recovery reporting.
- [ ] Abort setup when the host changes or disappears during async loading.
- [ ] Mount exactly one xterm instance per active display host.
- [ ] Dispose all xterm subscriptions and listeners deterministically.
- [ ] Preserve the existing large scrollback behavior unless explicitly changed.
- [ ] Support interactive, read-only, and no-input modes.
- [ ] Notify the controller of user-originated bytes.
- [ ] Support programmatic byte input independently from xterm keyboard input.
- [ ] Track focus state.
- [ ] Provide reliable imperative focus.
- [ ] Support autofocus after asynchronous mounting.
- [ ] Track selection.
- [ ] Support explicit copy selection.
- [ ] Support optional selection auto-copy.
- [ ] Follow new output only when the user was already at the bottom.
- [ ] Preserve manual scroll position when new output arrives.
- [ ] Support live resize.
- [ ] Support initial-only resize.
- [ ] Support disabled resize.
- [ ] Use ResizeObserver where available.
- [ ] Support window-resize fallback.
- [ ] Normalize dimensions.
- [ ] Ignore zero-sized and transiently invalid hosts.
- [ ] Preserve the current minimum reportable size of `20x5` unless deliberately
      changed.
- [ ] Respect the server maximum size contract.
- [ ] Debounce resize reports when configured.
- [ ] Suppress duplicate resize reports.

## Shared Presentation Requirements

### Launcher Presentation

- [ ] Support button launchers.
- [ ] Support menu-item launchers.
- [ ] Support status-pill launchers.
- [ ] Support caller-provided launcher markup.
- [ ] Support no launcher in controlled or headless mode.
- [ ] Permit clicking the launcher to start, attach, show, or expand according
      to configuration.
- [ ] Return to launcher-only presentation after configured completion/hide.

### Terminal Surface

- [ ] Standardize title, subtitle, actions, command preview, status, exit state,
      and footer layout.
- [ ] Keep error and attention overlays from moving or resizing the terminal
      host.
- [ ] Support fixed-height and fill-available-space layouts.
- [ ] Support embedded inline layout.
- [ ] Support persistent dialog layout.
- [ ] Support fullscreen dialog layout.
- [ ] Support floating layout.
- [ ] Support collapsed/docked layout.
- [ ] Support minimized layout.
- [ ] Ensure hidden/headless layout mounts no unnecessary xterm display.

### Floating and Minimized Windows

- [ ] Preserve drag behavior.
- [ ] Preserve user resize behavior.
- [ ] Clamp geometry to the current viewport.
- [ ] Persist geometry under a caller-supplied namespaced key.
- [ ] Restore geometry safely across viewport-size changes.
- [ ] Support multiple simultaneous floating terminals.
- [ ] Coordinate multiple minimized terminals without overlap.
- [ ] Confirm whether the currently dormant minimized-dock behavior remains a
      product requirement before deleting or changing it.

### Accessibility

- [ ] Provide accessible launcher and control labels.
- [ ] Announce status and error changes without announcing every terminal byte.
- [ ] Preserve keyboard access to all actions.
- [ ] Define focus restoration after closing dialogs or floating terminals.
- [ ] Support reduced-motion preferences for attention indicators.
- [ ] Keep terminal output out of HTML interpretation.

## Lifecycle and Race-Safety Requirements

- [ ] Deduplicate concurrent start requests.
- [ ] Associate every async operation with a session/scope generation.
- [ ] Ignore start/read responses that arrive after session switch or teardown.
- [ ] Ignore socket messages from superseded sessions.
- [ ] Prevent async xterm setup from mounting into an obsolete host.
- [ ] Emit completion exactly once per session.
- [ ] Handle exit-before-close and close-before-exit ordering.
- [ ] Prevent reconnect snapshots from duplicating transcript output.
- [ ] Dispose socket, poller, timers, ResizeObserver, and DOM listeners.
- [ ] Make reconnect/backoff configurable.
- [ ] Preserve sessions that intentionally continue while hidden.
- [ ] Prevent teardown of attached sessions owned elsewhere.
- [ ] Test rapid session switching.
- [ ] Test unmount during start.
- [ ] Test unmount during driver connection.
- [ ] Test close while output is still arriving.
- [ ] Test retry before the previous close acknowledgement.

## Security and Isolation Requirements

- [ ] Never render terminal output as HTML.
- [ ] Do not log transcripts by default.
- [ ] Do not include transcripts in routine telemetry by default.
- [ ] Preserve read-only and disabled-input enforcement in the runtime, not only
      in button state.
- [ ] Distinguish access-denied, ownership mismatch, stale session, and ordinary
      transport failure.
- [ ] Namespace persisted geometry by terminal context and user/project scope.
- [ ] Prevent transcript and matcher state leaking across session identities.
- [ ] Prevent delayed callbacks from acting on a replacement session.
- [ ] Audit authentication terminal diagnostics for credential or token leakage.

## Domain Extension Boundaries

The following must remain outside the terminal core.

- [ ] Keep Codex account reconnection outside the terminal.
- [ ] Keep Codex thread, turn, source-preparation, and activity semantics outside
      the terminal.
- [ ] Keep attachment upload outside the terminal; inject resulting input through
      the public terminal API.
- [ ] Keep AI-fix prompt and job creation outside the terminal.
- [ ] Keep launch-target discovery and preview state outside the terminal.
- [ ] Keep preview iframe, URL, authentication, and action handling outside the
      terminal.
- [ ] Keep account/provider authentication state and account refresh outside the
      terminal.
- [ ] Keep Doctor check selection, repair forms, and automatic repair ordering
      outside the terminal.
- [ ] Keep deployment state, release state, and public URLs outside the terminal.
- [ ] Keep target-script discovery, starring, and configuration outside the
      terminal.
- [ ] Keep workflow advancement and project/session refresh outside the terminal.
- [ ] Keep project and user authorization policy outside the terminal.

## Proposed Source Organization

Confirm exact names against repository conventions during the contract slice.
The organization must retain one public facade and keep internal concerns small.

- [ ] Add the canonical public component under `src/components/studio/`.
- [ ] Add one canonical controller composable under `src/composables/`.
- [ ] Add small transcript, matcher, policy, and contract modules under
      `src/lib/` or a clearly bounded terminal subdirectory.
- [ ] Add driver modules under a clearly named terminal driver directory.
- [ ] Keep xterm loading centralized in `src/lib/xtermModuleLoader.js` or its
      deliberate successor.
- [ ] Reuse `Vibe64TerminalFrame.vue` and `Vibe64FloatingTerminalWindow.vue`
      initially where doing so avoids presentation regressions.
- [ ] Delete or internalize old shared presentation components only after every
      caller has migrated.
- [ ] Do not create a new package unless package-boundary review proves the app
      source cannot safely own the abstraction.

Likely modules, subject to naming review:

```text
src/components/studio/Vibe64Terminal.vue
src/composables/useVibe64TerminalController.js
src/lib/vibe64TerminalContract.js
src/lib/vibe64TerminalTranscript.js
src/lib/vibe64TerminalMatchers.js
src/lib/vibe64TerminalPolicies.js
src/lib/vibe64TerminalDrivers/
  studioWebSocketTerminalDriver.js
  doctorPollingTerminalDriver.js
  fakeTerminalDriver.js
```

## Foundation Test Slice

- [ ] Add a client inventory/drift test for direct xterm construction.
- [ ] Make the drift failure direct new terminal work toward `Vibe64Terminal`
      and the canonical runtime.
- [ ] Add state-machine transition tests.
- [ ] Add owned-versus-attached teardown tests.
- [ ] Add driver conformance tests.
- [ ] Add snapshot/append/output-version transcript tests.
- [ ] Add polling transcript replacement tests.
- [ ] Add display destroy/remount replay tests.
- [ ] Add hidden/headless parity tests.
- [ ] Add cross-chunk matcher tests.
- [ ] Add matcher replay-deduplication tests.
- [ ] Add automatic-versus-manual presentation precedence tests.
- [ ] Add delayed-action cancellation tests.
- [ ] Add session-switch race tests.
- [ ] Add component launcher and presentation-mode tests.
- [ ] Add accessibility tests for labels, status, and focus restoration.
- [ ] Preserve the behavioral assertions in
      `tests/client/useStudioTerminal.vitest.js`.

## Migration Rule for Every Existing Terminal

Apply this checklist independently to every migration slice.

- [ ] Identify and freeze the existing behavior in focused tests.
- [ ] Record whether the terminal starts, attaches, or supports both.
- [ ] Record whether the session is owned or attached.
- [ ] Record process, connection, display, and transcript teardown separately.
- [ ] Record all launcher and presentation modes.
- [ ] Record all automatic visibility/attention behavior.
- [ ] Record all output, status, error, metadata, and completion events consumed
      by its parent workflow.
- [ ] Record all domain-specific slots/actions required.
- [ ] Configure `Vibe64Terminal` without adding a terminal-family conditional to
      the shared core.
- [ ] Add or update parity tests before removing the old implementation.
- [ ] Verify hidden, failure, retry, close, unmount, and session-switch behavior.
- [ ] Remove obsolete workflow-local transcript/socket/xterm logic.
- [ ] Re-run the client terminal inventory.
- [ ] Confirm no unrelated terminal family changed in the slice.

## Migration 1: Fix-Codex

This is the first migration because it is attach-only and has a strong transcript
retention contract without requiring a new transport.

- [ ] Preserve attachment to the terminal returned by the repair job.
- [ ] Preserve fullscreen dialog presentation.
- [ ] Preserve interactive input.
- [ ] Preserve repair-target title and subtitle.
- [ ] Preserve transcript after successful or failed exit.
- [ ] Preserve explicit success/failure completion presentation.
- [ ] Keep display disposal separate from repair-job stop/close.
- [ ] Preserve the assertion in `tests/client/vibe64FixCodexTerminal.vitest.js`.
- [ ] Remove Fix-Codex-specific terminal runtime wiring after parity passes.

## Migration 2: Target Scripts

- [ ] Preserve script tile/button launchers.
- [ ] Preserve eager persistent fullscreen dialog presentation.
- [ ] Close the current owned terminal before starting another script.
- [ ] Preserve interactive input and live resize.
- [ ] Preserve Ctrl-C.
- [ ] Preserve retry only after nonzero exit.
- [ ] Preserve command, label, status, and error display.
- [ ] Preserve close-on-unmount behavior.
- [ ] Preserve server-session deletion when the user closes this owned terminal.
- [ ] Add focused client parity tests if current coverage is server-only.
- [ ] Remove target-script-local display/runtime wiring after parity passes.

## Migration 3: Hosted Deployment Publish

- [ ] Add dedicated hosted client tests before changing the implementation.
- [ ] Preserve publish start with the visual terminal hidden.
- [ ] Preserve background WebSocket streaming while hidden.
- [ ] Preserve publishing/published/failed status-pill launcher behavior.
- [ ] Preserve floating, draggable, resizable presentation.
- [ ] Preserve persisted floating geometry.
- [ ] Preserve hide/display disposal without cancelling publishing.
- [ ] Preserve Ctrl-C.
- [ ] Preserve success auto-hide behavior.
- [ ] Preserve failure auto-show and page-level error behavior.
- [ ] Preserve attach/rehydration of an ongoing publish after reload or realtime
      state refresh.
- [ ] Decide and test whether successful publish sessions should be deleted,
      detached, or retained.
- [ ] Keep deployment state, operations, and public URL logic outside the public
      terminal core.
- [ ] Consume the public component from `vibe64-online` without editing the
      deployment-managed submodule.

## Migration 4: Workflow Command and Project Tools

### Generic Workflow Command

- [ ] Preserve start request deduplication.
- [ ] Preserve externally supplied request keys.
- [ ] Preserve initial session attachment.
- [ ] Preserve project-scoped endpoint pinning during teardown.
- [ ] Preserve retry as explicit old-session close plus new start.
- [ ] Preserve configurable close-on-unmount.
- [ ] Preserve stale, ownership mismatch, and access-denied events.
- [ ] Preserve readiness metadata events.
- [ ] Preserve delayed exactly-once completion events.
- [ ] Preserve AI-fix request data without putting AI-fix behavior in the core.
- [ ] Preserve Ctrl-C, close, retry, and expand/collapse behavior.
- [ ] Decide whether the currently suppressed workflow-command UI will be
      restored or deleted.

### Project Tools

- [ ] Preserve tool button/menu launchers.
- [ ] Preserve optional parameter collection.
- [ ] Preserve optional confirmation.
- [ ] Preserve fullscreen dialog presentation.
- [ ] Preserve source selection and optional session scoping.
- [ ] Preserve AI-fix integration through external events.
- [ ] Keep prompt-only tools outside the terminal path.
- [ ] Resolve the currently passed but undeclared
      `emit-closed-before-server-ack` prop.
- [ ] Remove old `Vibe64CommandTerminal` controller/runtime code only after all
      consumers have migrated.

## Migration 5: Headless Autopilot Command Runner

- [ ] Use the canonical terminal controller without mounting xterm.
- [ ] Preserve start and attach modes.
- [ ] Preserve promise settlement on exit.
- [ ] Preserve transcript on failure and explicit stop.
- [ ] Preserve owned-versus-attached cleanup distinctions.
- [ ] Never delete an attached session owned elsewhere.
- [ ] Preserve already-finished session handling without opening a socket.
- [ ] Preserve deletion of newly owned sessions after configured completion.
- [ ] Preserve no-input and no-resize behavior.
- [ ] Preserve ANSI/control-stripped textual output.
- [ ] Preserve the bounded one-megabyte display tail unless deliberately changed.
- [ ] Preserve text-view autoscroll.
- [ ] Preserve retry, stop, and AI-fix events.
- [ ] Replace the current weaker snapshot handling with the canonical transcript
      reconciliation.
- [ ] Preserve current successful-output visibility policy.

## Migration 6: Doctor Manual and Automatic Flows

Complete the polling driver before migrating Doctor.

### Shared Doctor Behavior

- [ ] Preserve POST start, GET poll, POST input, and DELETE close semantics.
- [ ] Preserve 750 ms polling behavior initially.
- [ ] Preserve command preview and command details.
- [ ] Preserve close errors and exit codes.
- [ ] Preserve Doctor refresh/settlement callbacks outside the terminal core.
- [ ] Decide and test natural-exit session retention.

### Manual Doctor Terminals

- [ ] Preserve optional confirmation.
- [ ] Preserve repair input fields outside the terminal component.
- [ ] Preserve persistent dialog presentation.
- [ ] Preserve explicit copy selection.
- [ ] Preserve optional automatic selection copy.
- [ ] Preserve first-URL extraction from ANSI-stripped transcript.
- [ ] Preserve copy-URL behavior.
- [ ] Preserve Ctrl-C and close.

### Automatic Doctor Terminals

- [ ] Preserve DOM-free/headless execution.
- [ ] Preserve synchronous `waitForExit` behavior.
- [ ] Preserve sequential automatic repair candidates outside the terminal core.
- [ ] Preserve once-per-repair-key attempts outside the terminal core.
- [ ] Preserve failure classification for start error, nonzero exit, and close
      error.
- [ ] Preserve the last 4,000 output characters for repair failure display.
- [ ] Migrate both Studio Setup and Project Setup automatic flows.
- [ ] Delete direct xterm ownership from `useDoctorTerminal.js` after all Doctor
      callers migrate.
- [ ] Confirm the client drift test now permits only the canonical xterm runtime.

## Migration 7: Account Authentication

- [ ] Preserve per-account View/Hide Terminal launchers.
- [ ] Preserve inline presentation.
- [ ] Preserve login continuation while the terminal display is hidden.
- [ ] Keep Cancel Login separate from terminal hide/dispose.
- [ ] Preserve realtime authentication-session state.
- [ ] Preserve slow recovery polling/backoff outside the terminal transport where
      it represents account-state recovery.
- [ ] Express attention opening through terminal rules.
- [ ] Open at most once per authentication session for the same attention event.
- [ ] Preserve failure and exited-state attention.
- [ ] Preserve terminal-error attention.
- [ ] Preserve device-flow output attention when no usable code exists.
- [ ] Preserve API-key-flow output attention.
- [ ] Move ANSI-stripped device-code detection onto named terminal matchers.
- [ ] Move authentication URL detection onto named terminal matchers.
- [ ] Preserve copy-code and URL behavior.
- [ ] Preserve hiding terminal-level errors after a usable code is detected.
- [ ] Keep account refresh and connection completion outside the terminal core.
- [ ] Audit matcher/event payloads for credential leakage.

## Migration 8: Launch and Preview

Migrate after launcher, policy, geometry, hidden-session, and matcher behavior is
proven by simpler terminals.

- [ ] Preserve Run button/menu launcher modes.
- [ ] Preserve manual and automatic launch.
- [ ] Preserve the 750 ms stable-state wait before auto-start.
- [ ] Preserve the seven-second sessionStorage auto-start cooldown unless product
      requirements deliberately change it.
- [ ] Preserve target `defaultDisplay` initial expansion.
- [ ] Preserve embedded auto-start collapsed behavior.
- [ ] Preserve collapsed toolbar/dock status presentation.
- [ ] Preserve embedded inline presentation.
- [ ] Preserve teleported floating presentation.
- [ ] Preserve drag, resize, clamping, and per-context persisted geometry.
- [ ] Preserve terminal-display disposal while transcript and subscription remain
      active.
- [ ] Preserve `windowDisplayed=false` inert/disposed behavior.
- [ ] Preserve failed-exit expansion.
- [ ] Preserve non-layout-shifting error overlays.
- [ ] Preserve retry, restart, and forced restart.
- [ ] Preserve reconciliation with an already-active launch session.
- [ ] Preserve `launchReady` and other readiness metadata through named matchers
      or metadata rules.
- [ ] Keep preview URL, iframe, authentication, actions, notices, and recovery
      outside the terminal core.
- [ ] Preserve “Show log” behavior from preview notices.
- [ ] Decide whether currently unexposed stop, close, copy-log, and Ctrl-C methods
      should become user-visible or be deleted.
- [ ] Preserve launch-preview E2E layout assertions.

## Migration 9: Session Codex

Migrate last because it exercises the broadest concurrency and extension set.

- [ ] Preserve session and global scopes that remain live.
- [ ] Confirm whether compact and global variants are still product requirements.
- [ ] Preserve start, attach, restart, close, and session switching.
- [ ] Preserve full, compact if retained, and headless modes.
- [ ] Preserve hidden subscription when configured.
- [ ] Preserve read-only mode.
- [ ] Preserve autofocus.
- [ ] Preserve same-session metadata refresh without transcript reset.
- [ ] Preserve transcript reset on true session identity change.
- [ ] Preserve stale, missing, and owner-mismatched session handling.
- [ ] Preserve Codex reconnect-required account attention outside the terminal
      core.
- [ ] Preserve recovery after account realtime reconnect.
- [ ] Preserve raw input/output activity signals required by Codex busy/streaming
      state.
- [ ] Preserve attention-driven AI-terminal pane selection outside the terminal
      core.
- [ ] Preserve source-preparation, disabled, stale, exited, and reconnect overlays
      through slots.
- [ ] Preserve attachment drag/drop and upload outside the terminal core.
- [ ] Inject uploaded attachment paths through the canonical programmatic input
      API.
- [ ] Preserve selection copy, Ctrl-C, Escape, close, and focus behavior.
- [ ] Preserve clean-exit and interrupted-turn non-attention semantics outside the
      terminal core.
- [ ] Remove `useCodexTerminalElement.js` only after all Codex and Fix-Codex
      consumers have migrated.

## Legacy and Ambiguity Resolution

These items were not confirmed as live requirements during the initial audit.
Resolve each explicitly rather than accidentally preserving or deleting it.

- [ ] Determine whether `Vibe64CommandTerminal` `launch` variant is live.
- [ ] Determine whether `Vibe64CommandTerminal` generic `service` variant is live.
- [ ] Determine whether compact Codex presentation is live.
- [ ] Determine whether global Codex terminal scope is live.
- [ ] Determine whether global-Codex project-tool events are live.
- [ ] Determine whether the minimized terminal dock is live.
- [ ] Decide whether suppressed workflow-command output will return.
- [ ] Resolve the undeclared project-tool close acknowledgement prop.
- [ ] Resolve launch controls' currently unexposed terminal operations.
- [ ] Determine whether the explicit Codex `working` output path is live.
- [ ] Decide Doctor natural-exit retention semantics.
- [ ] Decide publish terminal deletion/retention semantics.
- [ ] Decide whether autonomous WebSocket reconnect is required per preset.
- [ ] Delete dead variants only in explicit cleanup slices with test/inventory
      updates.

## Cleanup Slice

Begin only after all live terminal contexts use the canonical element/runtime.

- [ ] Confirm every visible terminal renders `Vibe64Terminal`.
- [ ] Confirm every headless terminal uses the canonical terminal controller.
- [ ] Confirm exactly one client module creates xterm.
- [ ] Confirm exactly one transcript reconciliation implementation remains.
- [ ] Confirm exactly one matcher engine remains.
- [ ] Confirm exactly one behavior-rule engine remains.
- [ ] Confirm no workflow directly owns terminal WebSocket protocol handling.
- [ ] Confirm no workflow directly owns Doctor polling transcript handling.
- [ ] Remove obsolete `useStudioTerminal` compatibility code or turn it into a
      thin temporary alias, then remove the alias.
- [ ] Remove obsolete Doctor xterm/runtime code.
- [ ] Remove obsolete headless command transcript/socket code.
- [ ] Remove obsolete command-terminal controller code.
- [ ] Remove dead terminal-kind branches.
- [ ] Remove presentation components that have no remaining consumers.
- [ ] Update terminal architecture documentation and helper maps if applicable.
- [ ] Update the client terminal inventory to the final allowed ownership points.

## Verification Matrix

### Public Repository

- [ ] Run focused unit tests after every foundation slice.
- [ ] Run the migrated workflow's focused client tests after every migration.
- [ ] Run `npm run test:client` after each completed migration.
- [ ] Run affected server tests when a driver or route contract changes.
- [ ] Run `npm run verify:packages` when exports or package imports change.
- [ ] Run `npx jskit app verify` before completing each migration branch.
- [ ] Run launch/preview E2E tests for presentation, resize, and lifecycle changes.
- [ ] Run the terminal inventory/drift test after every migration.

### Hosted Repository

- [ ] Verify the effective public source points at the sibling writable `vibe64`
      checkout during integration.
- [ ] Add and run hosted deployment-publish client tests.
- [ ] Run hosted deployment server tests.
- [ ] Run `npm run verify` from `vibe64-online` after hosted integration.
- [ ] Confirm no generated app or deployment-managed submodule files were edited
      manually.

### Manual Behavior Checks

- [ ] Start each terminal from its launcher.
- [ ] Attach each terminal to an existing session where supported.
- [ ] Hide and reopen without losing transcript where supported.
- [ ] Confirm hiding does not stop background work unless explicitly configured.
- [ ] Confirm failed terminals expand or show according to policy.
- [ ] Confirm successful terminals hide or remain visible according to policy.
- [ ] Confirm manual dismissal defeats repeated automatic reopening for the same
      event.
- [ ] Confirm Ctrl-C, stop, close, and detach remain distinct.
- [ ] Confirm attached sessions are not deleted accidentally.
- [ ] Confirm transcript matching works across streamed chunk boundaries.
- [ ] Confirm floating geometry does not collide across terminal contexts.
- [ ] Confirm no terminal transcript or authentication secret reaches logs.

## Per-Slice Diff Guard

- [ ] List changed files before completing every slice.
- [ ] Keep each migration limited to the canonical terminal modules, that
      workflow's adapter/component/controller, and its tests.
- [ ] Stop and explain any unrelated file that appears in a migration diff.
- [ ] Never mix unrelated product behavior changes into terminal parity work.
- [ ] Do not delete old implementations until the migrated caller's parity tests
      pass.

## Definition of Done

- [ ] One public `Vibe64Terminal` element covers every live visible terminal.
- [ ] One canonical controller/runtime covers visible, hidden, and headless use.
- [ ] One canonical xterm owner remains.
- [ ] One canonical transcript implementation remains.
- [ ] Standard WebSocket and Doctor polling drivers pass the same conformance
      suite.
- [ ] Owned and attached session teardown is explicit and tested.
- [ ] Launcher-only, inline, dialog, fullscreen, floating, minimized if retained,
      hidden, and headless presentations are supported.
- [ ] Error-driven expansion and success-driven hiding are declarative and tested.
- [ ] Output and metadata matchers emit stable named events.
- [ ] Matches across chunks and replay deduplication are tested.
- [ ] Every migrated terminal preserves its required lifecycle and presentation
      behavior.
- [ ] Domain-specific behavior remains outside the terminal core.
- [ ] Dead terminal variants and old runtime implementations are removed.
- [ ] Public and hosted verification pass.
- [ ] The final client terminal inventory prevents a second implementation from
      being introduced silently.
