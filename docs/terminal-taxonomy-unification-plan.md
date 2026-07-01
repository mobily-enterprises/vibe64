# Terminal Taxonomy and Unification Plan

## Version

This is a version 1 planning document.

Version 1 is not a rewrite plan. The current pty/session core is defensible and
should remain the foundation. The goal is to remove product/API/client ambiguity
above that core without building a generic terminal framework.

Version 1 incorporates review findings from focused plan audits. The important
change is that descriptors are now treated as contracts for startup, routing,
controls, metadata, ownership, and verification. Snapshot metadata alone is not
enough, because much client behavior happens before a terminal session exists.

Independent follow-up review agreed the plan is objectively useful, but only if
it starts with a narrow implementation slice. Slice 1 should prove the
descriptor model on workflow command, project tool, session shell, and launch
preview. The shared client-registry work should start with the overloaded
command/project-tool/shell path. Launch preview stays in Slice 1 server
descriptor coverage, but its client work should remain launch-specific because
the active launch UI lives in `useVibe64LaunchControls*`, not in the shared
command-terminal component path. Wider descriptor coverage remains the end
state, not the first deliverable.

## Decision Summary

Vibe64 should stop treating "terminal" as a single product concept.

The implementation already has one low-level terminal primitive:

```text
startTerminalSession(command, args, cwd, env, namespace, metadata, hooks)
```

That primitive should stay generic.

Above it, Vibe64 needs an explicit taxonomy:

```text
interactive_terminal
command_run_terminal
service_terminal
auth_terminal
repair_agent_terminal
```

Each user-facing terminal surface must declare a descriptor with stable identity,
startup requirements, operation routes, action semantics, public metadata,
namespace policy, reuse policy, result policy, and ownership policy.

Client components should consume a small pre-start surface registry and
descriptor-backed snapshots instead of branching on names such as `command`,
`tool`, `launch`, or `shell`.

The recommended implementation is deliberately incremental:

1. Inventory current terminal openers, routes, websockets, and direct pty starts.
2. Add plain descriptors for workflow command, project tool, session shell, and
   launch preview.
3. Attach safe `metadata.terminalDescriptor` for those four surfaces while
   preserving `terminalKind`.
4. Add a small client `terminalSurfaceRegistry` that replaces route, payload,
   websocket, and repair branching in `useVibe64CommandTerminalController` for
   command, project tool, and shell.
5. Defer Codex, Fix Codex, target scripts, setup doctor, auth, route cleanup,
   and command-run helper expansion until Slice 1 is stable.
6. Bring launch client consumption in through its launch-specific controls after
   command/tool/shell are stable.

## Root Cause

The low-level terminal runtime is unified, but the product layer is not.

`packages/studio-terminal-core/src/server/terminalSessions.js` owns the real pty
primitive. It stores sessions by namespace, spawns `node-pty`, streams output,
tracks status, supports reuse, and enforces running limits.

The Vibe64 layer then exposes several different concepts with similar terminal
language:

- workflow command terminal
- project tool terminal
- launch/preview terminal
- shell terminal
- session Codex terminal
- global Codex terminal
- Fix Codex terminal
- setup doctor repair terminal
- account auth terminal
- current-app target script terminal
- native OS launcher terminal

Some of those are truly different. For example, a preview terminal owns ports,
readiness, preview proxy state, open actions, and stale recovery. A shell
terminal is an interactive bash process. A workflow command terminal writes
action results back into session state.

The messiness is that the API and client often model these as variants of one
thing by adding local branching. The clearest example is
`src/composables/useVibe64CommandTerminalController.js`, which switches on
`terminalKind` for command, launch, shell, and project tool behavior. That file
knows routes, payloads, websocket paths, retry behavior, close behavior, launch
readiness, and AI-fix routing.

The result is avoidable coupling:

- terminal naming does not communicate lifecycle or ownership
- new terminal surfaces can add another branch instead of declaring behavior
- "fix" can mean AI repair, setup repair, preview restart, or readiness repair
- command-like terminals repeat similar run/stream/close plumbing
- client code needs to know too much about server route shape

## Goals

- Keep `startTerminalSession` as the single low-level pty primitive.
- Make terminal product concepts explicit and named.
- Separate terminal family, purpose, surface identity, operations, actions, and
  server policies.
- Replace client `terminalKind` conditionals with a descriptor-driven pre-start
  surface registry and descriptor-backed snapshots.
- Reduce duplicated command-run plumbing without collapsing real lifecycle
  differences.
- Make "Fix Codex" distinct from setup doctor repair and preview retry/restart.
- Keep existing behavior stable during migration.
- Add tests and drift guards so future terminal additions declare operations,
  public metadata, ownership, and behavior before they can ship.
- Prove the model first on command, project tool, shell, and launch descriptors,
  but migrate the shared command-terminal client only for command, project tool,
  and shell before touching launch controls.

## Non-Goals

- Do not rewrite `studio-terminal-core`.
- Do not collapse all terminals into one route or controller.
- Do not remove launch/preview-specific readiness/proxy behavior.
- Do not make setup doctor repair an AI repair.
- Do not make Fix Codex a normal chat terminal.
- Do not change account auth behavior unless required by descriptor adoption.
- Do not rename every route in one risky pass.
- Do not change user-owned session, project, or generated runtime files.
- Do not force every surface through one generic UI or server helper.
- Do not expose server-only descriptor policy or local paths in public terminal
  snapshots.
- Do not distribute descriptors across every package in Slice 1.
- Do not tighten multi-user/GitHub-actor access semantics unless product intent
  is confirmed; first make the current policy explicit and tested.

## Existing Terminal Inventory

### Core Primitive

`startTerminalSession` is the process/session primitive. It accepts command,
args, cwd, env, namespace, metadata, hooks, reuse policy, and running limits.

Current direct or injected callers:

- launch target terminal
- shell terminal
- session/global/Fix Codex terminals
- setup doctor git/plugin terminals
- current-app target script terminals
- account auth terminals through injected `startTerminalSessionFn`
- command/project-tool terminals through `startCommandTerminalProcess`

### Vibe64 Terminal Namespaces

Current namespace families live in `packages/vibe64-terminals/src/server/terminalShared.js`:

- `vibe64-codex`
- `vibe64-global-codex`
- `vibe64-command`
- `vibe64-launch-target`
- `vibe64-shell`
- `vibe64-tool`
- `vibe64-fix-codex`

Those namespaces are defensible. The problem is not namespace existence; it is
that capability and product meaning are not centralized.

### Command-Like Terminals

These run commands and stream output:

- workflow command terminal
- project tool terminal
- target script terminal
- setup doctor repair terminal

They differ in result policy:

- workflow command terminal writes action results and can advance workflow
- project tool terminal streams a tool run but does not write session action
  results on close
- target script terminal is a current-app panel run with retry/close
- setup doctor terminal is a repair action, often manual or hidden auto-run

### Interactive Terminals

These accept user input as an ongoing session:

- shell terminal
- session Codex terminal
- global Codex terminal
- account auth terminal when auth needs terminal attention

They differ in ownership and startup:

- shell requires session clone and GitHub-ready tool home
- session Codex requires session clone and Codex app-server/thread preparation
- global Codex uses the main checkout
- auth terminal runs login commands and may auto-open only when attention is
  needed

### Service Terminals

Launch/preview terminal is service-like, not merely command-like:

- reserves a web port
- runs a server
- scans output for open actions
- tracks readiness markers
- writes launch metadata
- manages preview proxy/auth
- supports stop, close, retry, restart, and stale recovery

### Repair Agent Terminals

Fix Codex is a separate repair-agent terminal:

- creates an ephemeral fix job
- starts a Codex terminal in a job namespace
- auto-injects prompt plus callback instructions
- reports completion or blocked state through a helper
- should not be treated as normal user chat

## Target Vocabulary

### Terminal Session

The low-level running pty session.

It should remain implemented by `startTerminalSession`.

Required properties:

- `id`
- `namespace`
- `commandPreview`
- `cwd`
- `metadata`
- `status`
- `exitCode`
- `output`
- `inputVersion`
- `outputVersion`

### Terminal Family

The broad lifecycle class.

Allowed values:

```text
interactive_terminal
command_run_terminal
service_terminal
auth_terminal
repair_agent_terminal
```

### Terminal Purpose

The product-specific reason the terminal exists.

Initial allowed values:

```text
workflow_command
project_tool
target_script
studio_setup_repair
project_setup_repair
launch_preview
session_shell
session_codex
global_codex
fix_codex
account_auth
```

`native_launcher` is not an in-app terminal purpose. It belongs in an
`outside_app_runtime` inventory bucket and must be excluded from descriptor
registry completeness tests.

### Terminal Surface

The pre-start UI/API surface that knows how a user initiates a terminal before a
snapshot exists.

Required properties:

- `surfaceKey`, for example `session.command`, `session.launch`, or
  `accounts.auth`
- required context fields, such as `sessionId`, `projectId`, `toolId`,
  `accountId`, `mode`, or `targetId`
- start payload builder
- operation route adapters for read/write/resize/close/websocket/status
- descriptor lookup key or resolver

This registry is intentionally small. It should remove route and payload
branching from generic client terminal code, not become a runtime plugin system.

### Terminal Descriptor

The server-declared behavior contract for one terminal surface.

Proposed shape:

```js
{
  descriptorId: "vibe64.workflow_command",
  surfaceKey: "session.command",
  family: "command_run_terminal",
  purpose: "workflow_command",
  routeKey: "session.command",
  title: "Command terminal",
  namespacePolicy: {
    base: "vibe64-command",
    scopeParts: ["sessionId", "commandId"],
    reuse: "never",
    maxRunning: 1
  },
  operations: {
    start: { method: "POST", routeKey: "session.command.start" },
    read: { method: "GET", routeKey: "session.command.read" },
    write: { method: "POST", routeKey: "session.command.write" },
    resize: { method: "POST", routeKey: "session.command.resize" },
    close: { method: "DELETE", routeKey: "session.command.close" },
    websocket: { routeKey: "session.command.websocket" }
  },
  actions: {
    interrupt: { effect: "send_input", input: "\u0003" },
    retry: { effect: "start_new_session" },
    aiRepair: { effect: "start_fix_codex_job" },
    close: { effect: "close_server_session" }
  },
  policies: {
    ownership: "session-github-actor",
    resultPolicy: "workflow_action_result",
    resultFilePolicy: "create_mount_read_delete",
    repairPolicy: "session_terminal_failure_fix"
  },
  publicMetadata: {
    expose: ["descriptorId", "family", "purpose", "surfaceKey", "routeKey"]
  }
}
```

### Terminal Capabilities

Capabilities are not UI wishes. They must reflect actual server behavior, but
they should stay broad. Use them for high-level display and filtering.

Initial public capability fields:

- `acceptsInput`
- `canClose`
- `canStop`
- `canInterrupt`
- `canRetry`
- `canRestart`
- `canRequestAiRepair`
- `hasPreview`
- `canOpenPreview`
- `writesWorkflowResult`
- `canAdvanceWorkflow`
- `reportsSetupRepair`
- `requiresSessionClone`
- `requiresTargetRoot`
- `requiresCodexAuth`
- `requiresGithubAuth`
- `autoStarts`
- `autoInjectsPrompt`

Do not use broad booleans alone to render controls. Visible controls must come
from descriptor actions because `interrupt`, `retry`, `stop`, and `close` have
different meanings across command, launch, shell, Codex, Fix Codex, and auth
surfaces.

### Terminal Actions

Actions describe concrete user-facing operations.

Required properties:

- action key, such as `interrupt`, `retry`, `restart`, `stop`, `close`,
  `hide`, `aiRepair`, or `openPreview`
- effect type, such as `send_input`, `close_server_session`, `hide_ui`,
  `stop_service`, `restart_service`, `start_new_session`,
  `start_fix_codex_job`, or `start_setup_repair`
- optional label/icon key
- `visibleWhen` state predicate
- `enabledWhen` state predicate

Action definitions should be declarative. They must not contain arbitrary
business logic. Surface-specific adapters can interpret them.

### Terminal Policies

Policies describe server-side side effects.

Initial policy fields:

- `namespacePolicy`
- `ownerPolicy`
- `reusePolicy`
- `maxRunning`
- `resultPolicy`
- `resultFilePolicy`
- `repairPolicy`
- `closePolicy`
- `environmentPolicy`
- `runtimeConfigPhasesPolicy`
- `metadataSchema`

Policies are server-only unless explicitly projected through public metadata.
They can include local paths, namespace internals, owner identifiers, and setup
state, so they must not be copied wholesale into terminal snapshots.

### Public Descriptor Metadata

Every snapshot should expose a reserved, allowlisted object:

```js
metadata.terminalDescriptor = {
  schemaVersion: 1,
  descriptorId: "vibe64.workflow_command",
  family: "command_run_terminal",
  purpose: "workflow_command",
  surfaceKey: "session.command",
  routeKey: "session.command",
  capabilities: {}
}
```

Rules:

- server-only `policies` are never exposed directly
- local paths, credentials, namespace internals, and owner secrets are excluded
- user or adapter metadata cannot override `metadata.terminalDescriptor`
- reused sessions refresh or validate descriptor metadata before being returned

## Target Capability Matrix

This matrix is a summary, not the control contract. The control contract is the
descriptor `actions` object plus operation manifest.

| Purpose | Family | Retry | Interrupt | Stop | AI Fix | Writes Workflow Result | Preview | Reuse |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `workflow_command` | `command_run_terminal` | yes | yes | no | yes | yes | no | no |
| `project_tool` | `command_run_terminal` | yes | yes | no | yes | no | no | maybe |
| `target_script` | `command_run_terminal` | yes | yes | no | no | no | no | no |
| `studio_setup_repair` | `command_run_terminal` | by repair | maybe | no | no | no | no | no |
| `project_setup_repair` | `command_run_terminal` | by repair | maybe | no | no | no | no | no |
| `launch_preview` | `service_terminal` | yes | maybe | yes | no | no | yes | yes |
| `session_shell` | `interactive_terminal` | no | input only | no | no | no | no | yes |
| `session_codex` | `interactive_terminal` | restart | yes | no | no | no | no | yes |
| `global_codex` | `interactive_terminal` | restart | yes | no | no | no | no | yes |
| `fix_codex` | `repair_agent_terminal` | no | stop job | no | no | no | no | no |
| `account_auth` | `auth_terminal` | restart auth | yes | no | no | no | no | yes except api key |
| `outside_app_runtime.native_launcher` | outside app | no | no | no | no | no | no | no |

## Architecture Plan

## 1. Freeze Behavior With an Inventory Test

### Purpose

Before refactoring, capture the current terminal surface area so future changes
cannot accidentally drop or duplicate a terminal opener.

### Tasks

- Generate an inventory table with:
  - package/module
  - route method and path
  - operation type: start/read/write/resize/close/websocket/control/status/stop/open/report
  - action/service called
  - namespace family
  - descriptor id
  - surface key
  - terminal family
  - terminal purpose
  - public/private metadata projection
- Add a server-side inventory test that asserts known terminal route starts:
  - session command terminal
  - project tool terminal
  - launch terminal
  - shell terminal
  - session Codex terminal
  - global Codex terminal
  - Fix Codex job terminal
  - current-app target script terminal
  - Studio setup doctor terminal
  - project setup doctor terminal
  - account auth terminal
- Track Studio setup doctor and project setup doctor separately.
- Add a source scan test for direct `startTerminalSession` call sites with an
  explicit allowlist for approved wrappers and injected starters.
- Allow account auth's injected `startTerminalSessionFn` explicitly.
- Exclude tests, docs, and generated inventory fixtures from source-scan
  enforcement.
- Document native OS launcher as `outside_app_runtime`.

### Acceptance Criteria

- A new direct pty starter call fails the inventory test unless added to the
  taxonomy.
- A new terminal route or websocket endpoint must declare a descriptor operation
  or the test fails.
- A new terminal surface must declare its public metadata projection.
- Existing tests continue to pass without behavior changes.

## 2. Add Server Terminal Descriptor Model

### Purpose

Create a central contract for terminal families, purposes, capabilities, and
policies.

### Proposed Location

Start in one place for Slice 1:

```text
packages/vibe64-terminals/src/shared/terminalDescriptors.js
```

That first module should cover only:

- workflow command
- project tool
- session shell
- launch preview

After that model is stable, feature packages can export descriptors from their
own boundaries where that reduces coupling:

```text
packages/studio-terminal-core/src/shared/terminalDescriptors.js
packages/vibe64-terminals/src/server/terminalDescriptors.js
packages/current-app/src/server/terminalDescriptors.js
packages/setup-doctor-core/src/server/terminalDescriptors.js
packages/vibe64-accounts/src/server/terminalDescriptors.js
```

Do not start with all five package locations. That risks fragmentation before
the descriptor contract proves itself.

### Tasks

- Define allowed terminal families.
- Define allowed terminal purposes.
- Define stable `descriptorId` and `surfaceKey` rules. `purpose` alone is not
  unique enough for parameterized surfaces.
- Keep Slice 1 descriptors minimal. Required fields:
  - `descriptorId`
  - `surfaceKey`
  - `family`
  - `purpose`
  - legacy `terminalKind`
  - route keys
  - capabilities/actions
  - namespace label or policy summary
  - safe public descriptor metadata shape
- Define shared capability defaults.
- Define a validator for descriptor shape.
- Define route-key documentation and tests for Slice 1 operations. Do not
  duplicate full route schema, body shape, or status-code definitions unless a
  later phase proves that is worth maintaining.
- Defer full operation manifest shape for start/read/write/resize/close,
  websocket, and optional control/status/stop/open/report operations.
- Define namespace policy shape:
  - static base namespace
  - required scope fields
  - namespace builder
  - close/read/write limit-prefix builder
- Add Slice 1 descriptors for:
  - workflow command
  - project tool
  - session shell
  - launch preview
- Add Slice 2 and Slice 3 descriptors for:
  - session Codex
  - global Codex
  - Fix Codex
  - current-app target scripts
  - Studio setup repairs
  - project setup repairs
  - account auth device/browser/API-key modes
- Mark native launcher as `outside_app_runtime` in docs only, not in app
  descriptor registry.
- Add descriptor public-serialization helper that exposes only client-safe
  fields.
- Add descriptor ownership authorizer mapping. Each `ownerPolicy` must resolve
  to an authorizer used by start/read/write/resize/close/subscribe/list.
- For Slice 1, owner policies should document and preserve current
  access behavior. Any stricter GitHub-actor isolation is a separate product
  decision because current tests allow some cross-member access.

### Acceptance Criteria

- Each in-app terminal opener resolves to one descriptor for the current
  context.
- Descriptor tests verify no duplicate `descriptorId`, `surfaceKey`, or route
  operation collisions.
- Descriptor capability values match actual server behavior.
- Descriptor public serialization excludes server-only policy, credentials,
  local paths, namespace internals, and owner secrets.
- Authorization tests prove the declared owner policy matches current behavior.
  Stricter negative tests for wrong GitHub actor should only be added after the
  intended access model is confirmed.

## 3. Attach Descriptor Metadata to Terminal Sessions

### Purpose

Make every terminal snapshot self-describing.

### Tasks

- For Slice 1, attach descriptor metadata only to workflow command,
  project tool, session shell, and launch preview.
- Add descriptor-derived public metadata under
  `metadata.terminalDescriptor`:
  - `schemaVersion`
  - `descriptorId`
  - `terminalFamily`
  - `terminalPurpose`
  - `surfaceKey`
  - `terminalRouteKey`
  - `terminalCapabilities`
  - `terminalActions` where safe to expose
- Preserve existing metadata fields such as `terminalKind` during migration.
- Do not remove, redact, or reshape existing metadata in Slice 1. Only
  add the safe `metadata.terminalDescriptor` object.
- Add a normalization helper so each controller does not hand-build the same
  metadata fields.
- Reject or overwrite caller-provided metadata that tries to set reserved
  `metadata.terminalDescriptor` keys.
- Keep descriptor policies server-side unless explicitly projected by the
  public serialization helper.
- Validate descriptor metadata when reusing an existing session. If the stored
  descriptor is stale, refresh safe public fields before returning the snapshot.

### Acceptance Criteria

- Existing UI still works with old metadata.
- New snapshots include family/purpose/capability metadata.
- Old snapshots without `metadata.terminalDescriptor` receive safe defaults in
  tolerant readers during migration.
- Slice 1 tests prove the new `metadata.terminalDescriptor` object does not
  expose local paths, credentials, namespace internals, owner secrets, or
  server-only policies. They do not assert cleanup of pre-existing metadata.
- Slice 1 tests cover workflow command, project tool, session shell, and
  launch preview snapshots.
- Slice 2 and Slice 3 tests cover Codex, Fix Codex, target script, setup repair,
  and account auth snapshots before those surfaces claim descriptor adoption.

## 4. Split Client Terminal Transport From Product Controls

### Purpose

Keep websocket/xterm mechanics generic, but move product-specific controls into
descriptor/capability consumers.

### Current Problem

`useVibe64CommandTerminalController` currently owns command, project-tool, and
shell behavior, and still contains launch-oriented branches from earlier
iterations:

- path selection
- payload construction
- terminal kind branching
- retry behavior
- AI fix routing
- launch readiness emission
- close behavior
- shell/tool/command/launch differences

### Target Shape

Generic transport composable:

```text
useTerminalSessionTransport
```

Responsibilities:

- apply snapshot
- connect websocket
- send input
- resize
- close socket
- reset display state
- expose output/status/error

Product control descriptors:

```text
useTerminalSurfaceController(descriptor, context)
```

Responsibilities:

- start request
- close request
- stop request
- retry request
- repair request
- action-derived controls

Pre-start surface registry:

```text
terminalSurfaceRegistry
```

Responsibilities:

- resolve `surfaceKey` plus context to a descriptor id or descriptor variant
- build start payloads
- select read/write/resize/close/websocket/status/stop/open/report routes
- declare required context fields before a terminal exists

### Tasks

- Add `terminalSurfaceRegistry` before refactoring component behavior. This
  registry is the replacement for pre-start `terminalKind` route/payload
  branching in the shared command/project-tool/shell controller.
- Extract route/payload selection from `useVibe64CommandTerminalController`.
- Create terminal route descriptor objects for:
  - command
  - project tool
  - shell
- Keep launch preview descriptor-backed on the server, but do not force launch
  through `useVibe64CommandTerminalController`. Launch client behavior should
  stay in `useVibe64LaunchControls*` and consume descriptor metadata/actions
  through a launch-specific adapter after command/tool/shell are stable.
- Defer route/surface entries for Codex, Fix Codex, target script, setup repair,
  and account auth until Slice 1 proves stable. These should keep their
  specific UI components unless a later change shows a real simplification.
- Keep `Vibe64CommandTerminal.vue` temporarily, but feed it descriptor-backed
  control state.
- Rename later only after behavior is stable. Candidate name:
  `Vibe64TerminalSurface.vue`.
- Move AI fix routing into descriptor repair policy:
  - `session_terminal_failure_fix`
  - `project_tool_failure_fix`
  - `none`
- Move launch readiness behavior into a launch-specific adapter instead of the
  shared command terminal controller.
- Define launch adapter behavior explicitly:
  - readiness source
  - once-per-terminal ready event
  - realtime/status refresh behavior
  - preview proxy pending state
  - stale terminal recovery
  - retry versus restart versus stop semantics
- Define shell migration behavior explicitly:
  - tab restore from API and local storage
  - generated tab ids
  - `closeOnUnmount=false`
  - `reuseRunning=false`
  - focus/close/start exposed methods
  - keyboard shortcuts
- Keep Codex, Fix Codex, shell controls, setup doctor, target script, and auth
  UIs surface-specific where that keeps behavior clearer. They can consume
  descriptor metadata and actions without being forced into one generic
  component.
- Add `closePolicy` values for `close_server_session`, `hide_ui`, and
  `dispose_panel_only`. Account auth must preserve terminal-attention behavior.

### Acceptance Criteria

- `useVibe64CommandTerminalController` no longer switches on raw
  `terminalKind` for command/project-tool/shell route and payload behavior.
- No pre-start caller uses raw `terminalKind` to choose start/read/write/close
  routes in the migrated shared controller path.
- Project tool fix and session terminal fix still start the correct Fix Codex
  jobs.
- Launch terminal ready event, preview proxy pending state, stale recovery, stop,
  retry, and restart behavior remain in launch-specific code and are covered
  before launch consumes descriptor-backed client controls.
- Shell terminal tabs still restore and reconnect.
- Shell active/inactive close, session-switch cleanup, exposed component methods,
  and shortcuts still work.
- Account auth is not part of the first client-controller slice. When migrated
  later, device, browser, and API-key modes must preserve redaction, reuse, and
  terminal attention behavior.
- Existing visible command terminal behavior is unchanged.

## 5. Consolidate Command-Run Terminal Server Plumbing

### Purpose

Reduce repeated "run command in a terminal" implementation while preserving
different result policies.

This is not part of Slice 1. Slice 1 should descriptor-enable
existing command/tool/launch/shell behavior without introducing a new generic
command-run helper. Only consolidate server plumbing after descriptor metadata
and the client surface registry have proven useful.

### Command-Run Surfaces

- workflow command
- project tool
- target script
- setup repair

### Target Server Helper

Potential later helper around `startTerminalSession` for command-run terminals:

```js
startCommandRunTerminal({
  descriptor,
  commandSpec,
  context,
  ownerPolicy,
  environmentPolicy,
  runtimeConfigPhasesPolicy,
  resultFilePolicy,
  resultPolicy,
  namespace,
  onClose
})
```

This helper should not know workflow semantics. It should handle only shared
mechanics:

- workdir validation
- command preview
- metadata
- common Docker/toolchain args where applicable
- output streaming
- result file lifecycle when requested
- namespace/max-running/reuse policy
- descriptor metadata normalization
- owner metadata attachment

Workflow-specific result writing remains in workflow command code.

### Tasks

- First add descriptor metadata to existing command/project-tool paths without
  changing command-run lifecycle behavior.
- Keep `startCommandTerminalProcess` as the only shared command-run target until
  Slice 1 is stable.
- Consider a descriptor parameter and metadata normalization before adding a new
  helper.
- Move project tool command-run start onto the same explicit descriptor only if
  tests prove workflow and tool side effects remain distinct.
- Split result-file lifecycle from workflow result writing:
  - create file
  - mount or expose env var
  - read facts/results only when the result policy asks for it
  - delete file on success, failure, and close-hook errors
- Preserve lifecycle recording around workflow commands:
  - duplicate active command blocking
  - stale step revision checks
  - `recordCommandActionStarted`
  - `recordCommandActionFinished`
  - start-failure recording
  - post-commit scheduling
- Preserve Git actor ownership policy per surface. Do not collapse
  `session_git_command_actor_required`, `request_github_actor`,
  `no_github_actor`, and adapter-supplied ownership into one boolean.
- Preserve runtime config phase behavior through explicit
  `environmentPolicy` and `runtimeConfigPhasesPolicy`.
- Defer target scripts. Do not force them into Docker command helper if project
  scripts intentionally run host bash.
- Defer setup doctor repairs. Their toolkit is compact and should remain simple
  unless descriptor metadata clearly improves it.

### Acceptance Criteria

- Workflow command and project tool share only the descriptor plumbing that is
  proven to clarify behavior.
- Workflow action-result writing remains explicit in command terminal code.
- Project tool remains free of workflow action-result side effects.
- Result-file behavior is tested independently from workflow result behavior.
- Workflow command tests cover duplicate active lifecycle, stale revision, start
  failure, normal close finalization, finalization failure, and post-commit
  scheduling.
- Target script and setup repair behavior are either migrated or explicitly
  documented as intentionally separate command-run implementations.

## 6. Clarify Fix Semantics

### Purpose

Make "fix" impossible to confuse across AI repair, setup repair, and preview
restart.

### Vocabulary

Use these names in code and UI-adjacent contracts:

- `aiRepair` or `fixCodexRepair`: ephemeral Codex repair job
- `setupRepair`: setup doctor declared repair action
- `previewRestart`: launch terminal restart
- `previewReadinessRepair`: server-only metadata repair after successful probe

### Tasks

- Rename client command functions where practical:
  - `requestAiFix` -> `requestFixCodexRepair`
  - `terminalFailureFix` -> `fixCodexTerminalFailureRepair`
- Keep button text if product wants "Get AI to fix it".
- Add descriptor repair policy:
  - `none`
  - `session_terminal_failure_fix`
  - `project_tool_failure_fix`
- Add comments at Fix Codex entry points explaining it is not a chat terminal.
- Add comments at setup doctor repair entry points explaining it is not AI.
- Avoid calling launch readiness probe a "fix" in public code paths unless the
  name includes `Readiness`.
- Model launch preview as service operations:
  - `start`
  - `retry`
  - `restart`
  - `stop`
  - `close`
  - `status`
  - `open`
  - server-only `readinessProbeRepair`
- Do not expose `readinessProbeRepair` as a user-triggered button.

### Acceptance Criteria

- Searching for `fix` clearly separates Fix Codex, setup repair, and preview
  readiness/restart.
- AI repair routes still create Fix Codex jobs.
- Setup repairs still run doctor terminal actions without invoking Codex.
- Launch restart/retry still does not expose AI repair.
- Launch readiness repair remains automatic, idempotent, and documented as a
  metadata reconciliation path.

## 7. Rationalize Routes Without Breaking Behavior

### Purpose

Routes do not need to be unified immediately, but route meaning should be
documented and descriptor-backed.

### Current Route Families

- Vibe64 terminal routes:
  - `/codex-terminal`
  - `/sessions/:sessionId/codex-terminal`
  - `/sessions/:sessionId/command-terminal`
  - `/sessions/:sessionId/launch-terminal`
  - `/sessions/:sessionId/shell-terminal`
  - `/tools/:toolId/run`
  - `/tools/:toolId/fix`
  - `/fix-codex-jobs/:jobId/...`
- Current app:
  - `/target-script-terminal`
- Doctor:
  - `/terminal`
- Accounts:
  - `/auth`

### Tasks

- Add route keys to descriptors:
  - `vibe64.global_codex`
  - `vibe64.session_codex`
  - `vibe64.workflow_command`
  - `vibe64.launch_preview`
  - `vibe64.session_shell`
  - `vibe64.project_tool`
  - `vibe64.fix_codex`
  - `current_app.target_script`
  - `doctor.studio_setup_repair`
  - `doctor.project_setup_repair`
  - `accounts.auth`
- Add operation manifests to descriptors. Operation manifests must cover every
  operation the surface supports:
  - `start`
  - `read`
  - `write`
  - `resize`
  - `close`
  - `websocket`
  - `control`
  - `stop`
  - `status`
  - `open`
  - `report`
- Include method, path params, body shape, status codes, and action id where
  relevant.
- Return route key and descriptor id in public terminal metadata.
- Add docs for route-to-purpose mapping.
- Defer route renames until descriptor adoption is complete.
- Add compatibility tests for every existing HTTP, websocket, control, and
  service route before any route cleanup begins.

### Acceptance Criteria

- Client code can choose behavior from surface registry, route key, purpose,
  actions, and capabilities instead of hard-coded endpoint interpretation.
- Existing endpoints remain available during migration.
- Any new terminal endpoint or websocket endpoint must declare an operation
  route key.
- Existing response shapes stay compatible during descriptor adoption.

## 8. Improve Naming in Components

### Purpose

Reduce misleading component names after behavior is descriptor-backed.

### Candidate Renames

Do this only after the descriptor migration is stable:

- `Vibe64CommandTerminal.vue` -> `Vibe64TerminalSurface.vue`
- `useVibe64CommandTerminalController.js` -> `useVibe64TerminalSurfaceController.js`
- `Vibe64HeadlessCommandOutput.vue` can remain command-specific because it is
  genuinely command output.
- `Vibe64FixCodexTerminal.vue` remains specific.
- `CodexSessionTerminal.vue` remains specific.
- `Vibe64ShellControls.vue` remains specific.

### Migration Rule

Introduce `Vibe64TerminalSurface.vue` as a compatibility wrapper first. Keep the
old export available while props, events, exposed methods, and CSS class names
are migrated deliberately.

### Acceptance Criteria

- Component names reflect behavior.
- No component named "CommandTerminal" owns launch or shell logic.
- Imports are updated mechanically only after behavior tests are in place.
- Existing props such as `terminal-kind`, exposed methods such as
  `start`/`close`/`focus`, and shell/project-tool callers remain compatible
  until their call sites are migrated.

## 9. Add Drift Guards

### Purpose

Prevent future slop from reappearing.

### Guards

Apply these guards first to the four-surface slice. Expand them as descriptor
coverage expands.

- Source scan: no new `startTerminalSession(` call outside approved modules.
- Source scan: no approved wrapper can start a migrated terminal surface without
  descriptor metadata.
- Source scan: no new raw `terminalKind === "..."` branching in generic client
  terminal controllers.
- Descriptor test: every migrated start/read/write/resize/close/websocket/control
  route has a descriptor operation or route key.
- Descriptor test: every descriptor has operations, actions, capabilities,
  namespace policy, owner policy, and public metadata policy.
- Metadata test: migrated terminal snapshots include reserved
  `metadata.terminalDescriptor`.
- Metadata redaction test: public descriptor metadata excludes policies, local
  paths, credentials, namespace internals, and owner secrets.
- Authorization test: declared owner policy matches current behavior at
  start/read/write/resize/close and websocket subscribe/list boundaries.
- Compatibility test: old snapshots, stale running terminals, old client/new
  server, new client/old server, and rollback keep tolerable behavior.
- Vocabulary test: setup repair does not call Fix Codex; Fix Codex route does
  not use setup repair labels.

### Acceptance Criteria

- CI fails when a new terminal opener bypasses descriptor registration.
- CI fails when generic client terminal code branches on terminal purpose
  instead of using the surface registry and descriptor actions.
- CI fails when public descriptor metadata exposes server-only policy or local
  machine details.
- CI fails when owner policy metadata exists but the matching boundary does not
  implement the declared behavior.

## 10. Migration Slices

### Slice 0: Inventory Baseline

Scope:

- Land this plan.
- Add generated terminal inventory table.
- Add non-invasive tests for current terminal route/call-site inventory.
- Add route compatibility snapshots before changing route helpers.

Out of scope:

- no descriptor behavior changes
- no client refactor
- no route renames

Done when:

- inventory lists current start/read/write/resize/close/websocket/control/status
  routes and direct pty starts
- known unmigrated surfaces are documented instead of failing the build
- compatibility snapshots pin existing paths before refactor

### Slice 1: Command, Tool, Shell, Launch Descriptor Baseline

Scope:

- Add descriptor primitives and validators.
- Register descriptors for only:
  - workflow command
  - project tool
  - session shell
  - launch preview
- Add Slice 1 route-key documentation, namespace policies, owner policies,
  actions, and public metadata projection.
- Treat route keys and operation manifests as documentation/test metadata at
  first. Do not make them an executable routing schema, and do not duplicate
  full route schemas until duplication is proven worthwhile.
- Attach reserved descriptor metadata to Slice 1 snapshots.
- Keep old `terminalKind` metadata.
- Add tolerant readers for legacy snapshots.
- Create pre-start `terminalSurfaceRegistry`.
- Refactor `useVibe64CommandTerminalController` to consume descriptors for
  command, project tool, and shell.
- Bring launch client consumption in last through `useVibe64LaunchControls*`.

Implementation order:

1. command and project tool
2. shell
3. launch preview metadata and launch-specific descriptor consumption

Out of scope:

- no Codex, Fix Codex, auth, setup repair, or target script client migration
- no component rename
- no route rename
- no command-run helper rewrite
- no stricter authorization policy

Done when:

- Slice 1 descriptors exist and validate
- command/tool/shell use `terminalSurfaceRegistry` for route, payload,
  websocket, and repair branching
- launch exposes descriptor metadata and keeps launch-specific controls
- focused command, project tool, shell, and launch tests pass

### Slice 2: Codex and Fix Codex Descriptor Coverage

Scope:

- Add descriptors and public descriptor metadata for:
  - session Codex
  - global Codex
  - Fix Codex
- Keep Codex and Fix Codex components specific.
- Document operations for restart, interrupt, close, stop job, job report, and
  websocket subscriptions.
- Keep session Git actor behavior unchanged.
- Keep Fix Codex clearly separate from normal chat and setup repair.

Out of scope:

- no generic Codex terminal UI
- no change to Codex prompt injection or callback flow
- no stricter Git actor ownership
- no command-run helper changes

Done when:

- session/global/Fix Codex snapshots include safe descriptor metadata
- Codex restart/interrupt behavior is unchanged
- Fix Codex stop/report behavior is unchanged
- tests prove no AI-repair button is introduced for Codex surfaces
- legacy snapshots and running Codex terminals still reconnect

### Slice 3: Setup Repair, Account Auth, and Target Script Coverage

Scope:

- Add descriptors and public descriptor metadata for:
  - current-app target scripts
  - Studio setup repairs
  - project setup repairs
  - account auth device/browser/API-key modes
- Preserve each surface-specific controller and route shape.
- Model setup repair as setup repair, not AI repair.
- Model account auth as attention-only where appropriate, with mode-specific
  reuse and redaction behavior.
- Model target script retry/close/onClose behavior without forcing Docker
  command-run assumptions.

Out of scope:

- no setup doctor transport rewrite
- no auth behavior change
- no target script command helper migration
- no public exposure of raw auth output or API keys

Done when:

- target script, setup repair, and auth snapshots include safe descriptor
  metadata
- setup manual repair and hidden auto-repair behavior are unchanged
- auth device/browser/API-key tests prove redaction, reuse, and attention
  behavior
- target script retry/close/onClose tests pass

### Slice 4: Optional Command-Run Server Consolidation

Scope:

- Descriptor-enable `startCommandTerminalProcess` only after prior slices are
  stable.
- Add result-file and workflow lifecycle tests before moving shared plumbing.
- Consider a narrow command-run decorator around `startTerminalSession` for
  descriptor metadata and common command-run mechanics.
- Evaluate target scripts and setup repairs for shared helper adoption only
  after adapter-owned side effects are covered.

Out of scope:

- no launch migration into command-run helper
- no workflow result finalization inside a generic helper
- no setup repair or target script migration unless tests prove it simplifies
  behavior

Done when:

- workflow result writing remains explicit
- project tools still do not write workflow action results
- result-file lifecycle is tested independently from workflow finalization
- any shared helper reduces duplication without taking over surface-specific
  lifecycle ownership

### Slice 5: Vocabulary and Naming Cleanup

Scope:

- Rename internal AI-fix functions where low-risk.
- Add comments and tests distinguishing:
  - Fix Codex repair
  - setup repair
  - preview restart/readiness repair
- Introduce `Vibe64TerminalSurface.vue` as a compatibility wrapper if the
  shared command/tool/shell surface is descriptor-led.
- Keep specific components for Codex, Fix Codex, shell controls, target scripts,
  setup doctor, auth, and launch controls.

Out of scope:

- no user-facing label changes unless product wants them
- no route cleanup
- no removal of compatibility exports until callers are migrated

Done when:

- searches for `fix` clearly separate AI repair, setup repair, and preview
  restart/readiness repair
- generic command-terminal naming no longer owns shell or project-tool behavior
- compatibility exports keep existing callers working

### Slice 6: Optional Route Cleanup

Scope:

- Consider route aliases or route renames only after clients consume route keys
  and descriptors.
- Remove aliases only when public compatibility allows it.
- Keep route compatibility tests for old paths while aliases exist.

Out of scope:

- no route cleanup before descriptor adoption
- no route generation unless explicitly justified by prior slices

Done when:

- old paths remain compatible or have documented aliases
- descriptor route keys remain stable
- clients no longer infer product behavior from raw endpoint names

## Required Test Coverage

### Slice 0-1 Server Tests

- Inventory tests cover current terminal start routes, websocket routes, and
  direct `startTerminalSession` call sites.
- Descriptor registry validates workflow command, project tool, launch preview,
  and session shell.
- First-slice routes have descriptor route keys and route-key tests.
- Descriptor tests inspect actual start arguments with fake starters:
  descriptor id, namespace, limit prefix, reuse policy, owner metadata, public
  metadata, and supported operations.
- Public serialization tests prove server-only policies, credentials, local
  paths, namespace internals, and owner secrets are not exposed through the new
  Slice 1 `metadata.terminalDescriptor` object.
- Owner policy tests prove declared behavior matches current behavior.
- Command terminal snapshot includes workflow command descriptor metadata.
- Project tool terminal snapshot includes project tool descriptor metadata.
- Launch terminal snapshot includes service/preview capabilities.
- Shell terminal snapshot includes interactive shell capabilities.
- Launch service tests cover delayed readiness, proxy-pending preview, retry,
  restart, stop, status refresh, and stale recovery.

### Slice 2-4 Server Tests

- Descriptor registry validates all known terminal purposes.
- Every Vibe64 terminal operation route maps to a descriptor operation.
- Owner policy tests cover start/read/write/resize/close and websocket
  subscribe/list boundaries. Stricter actor rejection tests must match confirmed
  product policy.
- Fix Codex terminal snapshot includes repair-agent capabilities.
- Account auth terminal snapshot includes auth capabilities.
- Studio setup doctor terminal snapshot includes Studio setup repair
  capabilities.
- Project setup doctor terminal snapshot includes project setup repair
  capabilities.
- Current-app target script terminal snapshot includes command-run capabilities.
- Workflow command lifecycle tests cover duplicate active command, existing
  completed lifecycle, stale step revision, start failure, normal close,
  finalization failure, and post-commit scheduling.
- Result-file lifecycle tests cover create/env/mount/read/delete and cleanup on
  success, failure, and close-hook errors.
- Launch service tests cover start, retry, restart, stop, status, open, delayed
  readiness, reused ready terminal, proxy-pending preview, and stale recovery.
- Account auth tests cover device, browser, and API-key modes with redaction and
  user isolation.

### Slice 1 Client Unit Tests

- Pre-start surface registry builds start payload and operation routes from
  `surfaceKey` plus context.
- Generic terminal controller shows retry only when descriptor action and state
  allow.
- Generic terminal controller shows interrupt only when descriptor action and
  state allow.
- Generic terminal controller shows AI repair only when descriptor action and
  repair policy allow and state is failed.
- Generic terminal controller distinguishes `close_server_session`, `hide_ui`,
  `stop_service`, `restart_service`, and `send_input` action effects.
- Project tool AI repair calls project tool repair route.
- Workflow command AI repair calls session terminal repair route.
- Shell terminal does not expose AI repair.
- Shell tab tests cover API restore, local storage restore, active/inactive tab
  close, session switch, access denied cleanup, exposed methods, and shortcuts.
- Launch-specific client tests stay with `useVibe64LaunchControls*` and cover no
  AI repair, readiness, retry, restart, stop, proxy pending, and stale recovery
  before launch consumes descriptor-backed controls.

### Slice 2-3 Client Unit Tests

- Codex surface tests cover session/global restart/interrupt and Fix Codex stop
  job without showing AI repair.
- Account auth tests preserve attention-only display, mode-specific reuse, and
  redaction.
- Setup repair and target script tests preserve their existing specific UI and
  route behavior.

### E2E Tests

Keep most coverage deterministic in unit, route, and service tests. E2E tests
should be smaller live smoke tests around user-visible flows.

- Start a workflow command terminal, fail it, request Fix Codex.
- Start a project tool terminal, fail it, request Fix Codex.
- Start launch preview, restart it, verify no AI repair button appears.
- Open shell tab, reconnect restored tab.
- Run target script, retry after failure.
- Run setup repair terminal manually.
- Let project setup auto-repair run hidden and wait for exit.
- Start Codex auth, verify terminal opens only when attention is needed.

## Risks

### Risk: Over-Abstracting

The descriptor system can become a mini framework.

Mitigation:

- Keep descriptors plain objects.
- Keep operation manifests as contract/test metadata unless there is a proven
  need to generate routes from them.
- Keep lifecycle-specific code explicit.
- Use descriptors for identity, operations, actions, metadata, and policy
  declaration, not for executing arbitrary behavior.
- Keep surface-specific adapters for launch, Codex, Fix Codex, auth, shell,
  setup repair, and target scripts when that is clearer.
- Ship Slice 1 before adding descriptors across every package.

### Risk: Hiding Launch Complexity

Launch terminal behavior is service orchestration, not just command running.

Mitigation:

- Keep launch controller separate.
- Use descriptor only for metadata, operations, actions, and client controls.
- Migrate launch client consumption last in Slice 1, after command/tool
  and shell are stable.
- Test preview proxy pending state, stale recovery, delayed readiness, retry,
  restart, stop, and status refresh explicitly.

### Risk: Breaking Workflow Result Writing

Workflow command close handling writes action results, applies facts, advances
workflow, and schedules post-commit effects.

Mitigation:

- Do not move workflow result policy into a generic helper.
- Keep workflow result writing in command terminal code.
- Test action-result success and failure paths before and after migration.
- Keep result-file lifecycle separate from workflow action-result finalization.

### Risk: Confusing Repair Terms

Users and maintainers can confuse setup repair, preview retry, and Fix Codex.

Mitigation:

- Rename internal code around repair policies.
- Keep user-facing labels intentional.
- Add source scan tests for ambiguous new names in shared modules.

### Risk: Descriptor Theater

Descriptors can exist while real route, ownership, or metadata behavior remains
route-local and inconsistent.

Mitigation:

- Add fake-starter contract tests that inspect actual `startTerminalSession`
  arguments.
- Require every operation route and websocket endpoint to declare a descriptor
  operation.
- Test that declared owner policies match current behavior at every
  read/write/resize/close/subscribe/list boundary.
- Add public descriptor metadata redaction tests.

### Risk: Accidental Authorization Change

Making owner policy explicit can accidentally tighten or loosen current access.
Current behavior may intentionally allow some cross-member terminal access.

Mitigation:

- First document and test current behavior.
- Treat stricter GitHub-actor isolation as a product decision.
- Separate taxonomy adoption from authorization policy changes.

### Risk: Mixed-Version Breakage

Descriptor adoption can break stale running terminals, old snapshots, or
clients and servers deployed out of sync.

Mitigation:

- Keep `terminalKind` and legacy snapshot fields during migration.
- Add tolerant readers for snapshots without `metadata.terminalDescriptor`.
- Test old client/new server, new client/old server, stale terminal reuse, and
  rollback behavior.

## Completion Criteria

### Slice 0 Completion

Slice 0 is complete when:

- inventory/contract tests cover terminal start routes, websocket routes, and
  direct pty starts
- known unmigrated surfaces are documented
- route compatibility snapshots exist before refactor work starts

### Slice 1 Completion

Slice 1 is complete when:

- workflow command, project tool, session shell, and launch preview have plain
  descriptors
- those four surfaces expose safe `metadata.terminalDescriptor` while preserving
  legacy `terminalKind`
- `useVibe64CommandTerminalController` uses `terminalSurfaceRegistry` for
  command/project-tool/shell route, payload, websocket, and repair branching
- command and project tool focused tests pass before shell is migrated
- shell focused tests pass before launch client descriptor consumption begins
- launch preview descriptor metadata and launch-specific readiness/proxy/retry
  tests pass without forcing launch through `useVibe64CommandTerminalController`
- no Codex, auth, setup doctor, target script, route cleanup, or generic
  command-run helper expansion is required for this milestone

### Slice 2 Completion

Slice 2 is complete when:

- session Codex, global Codex, and Fix Codex have descriptors
- those surfaces expose safe `metadata.terminalDescriptor`
- Codex restart/interrupt/close behavior is unchanged
- Fix Codex stop job and report behavior is unchanged
- Fix Codex remains separate from normal chat and setup repair
- no stricter Git actor ownership or prompt/callback behavior change ships in
  this slice

### Slice 3 Completion

Slice 3 is complete when:

- target scripts, Studio setup repair, project setup repair, and account auth
  modes have descriptors
- those surfaces expose safe `metadata.terminalDescriptor`
- setup manual repair and hidden auto-repair behavior are unchanged
- account auth device/browser/API-key modes preserve redaction, reuse, and
  attention-only display behavior
- target script retry/close/onClose behavior is unchanged
- no setup doctor transport rewrite or auth behavior change ships in this slice

### Slice 4 Completion

Slice 4 is complete when:

- any command-run helper change is covered by workflow lifecycle and result-file
  lifecycle tests
- workflow result writing remains explicit and project tools remain free of
  workflow action-result side effects
- target scripts and setup repairs are migrated only if the change simplifies
  behavior without hiding adapter-owned side effects

### Slice 5 Completion

Slice 5 is complete when:

- Fix Codex repair, setup repair, and preview restart/readiness repair are
  clearly separated in code names and tests
- generic command-terminal naming no longer owns shell or project-tool behavior
- compatibility exports keep existing callers working

### Slice 6 Completion

Slice 6 is complete when:

- any route aliases or renames preserve old paths until compatibility is no
  longer required
- descriptor route keys remain stable
- clients no longer infer terminal behavior from raw endpoint names

### Full Migration Completion

The migration is complete when:

- every in-app terminal opener resolves to a descriptor for its current context
- every terminal operation route and websocket endpoint maps to a descriptor
  operation
- every terminal snapshot includes public descriptor metadata with family,
  purpose, capabilities, route key, and descriptor id
- public descriptor metadata excludes policies, credentials, local paths,
  namespace internals, and owner secrets
- generic client terminal code no longer branches on raw terminal kind strings
  for route, payload, or control behavior
- launch, shell, command, project tool, Codex, Fix Codex, target script, setup
  repair, and auth flows pass focused tests
- mixed-version and stale-terminal compatibility tests pass
- command-like plumbing is shared where it clarifies behavior
- lifecycle-specific controllers remain explicit where sharing would obscure
  behavior
- "Fix Codex" is clearly separate from setup repair and preview restart

## Guiding Rule

Unify mechanics, not meaning.

The terminal runtime should be boring and generic. Product terminal surfaces
should be explicit about why they exist, what they can do, and what side effects
they own.
