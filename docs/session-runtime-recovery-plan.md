# Session Runtime Recovery and Restart Orchestration Plan

## Problem

Vibe64 can render a selected session shell from summary/list state before the
selected session detail and runtime-derived controls are available. During a
deploy or other broad restart, runtime recovery can be slow enough that the UI
falls into the disabled passive composer and shows `Waiting for session
controls`, even though the persisted workflow state already knows the current
step, fields, and actions.

The concrete symptom seen on `dave/nbi-tools` was that the PR step was persisted
and recoverable, but the UI could temporarily hide the PR title/body fields and
actions while Codex app-server, preview, terminal, and git/control recovery were
still warming.

## Target Contract

- Persisted Vibe64 workflow/session state is authoritative for current-step UI.
- `GET /sessions/:id` must return the current step, presentation input, actions,
  intents, PR fields, metadata, and background task state quickly from persisted
  session state.
- Codex, terminal, preview, and git/control reconciliation are runtime readiness
  overlays. They may update the session after they settle, but they must not
  block workflow controls from rendering.
- The client must distinguish detail loading/restoring from a real no-controls
  condition.
- Deploy and restart-all flows must not restart every daemon/runtime process at
  once.
- Failure logs must include enough output and purpose to diagnose command
  failures.

## Non-Goals

- Do not move workflow truth into Codex, preview, terminal, or deployment state.
- Do not solve this by a client-only spinner that leaves the server read path
  coupled to runtime recovery.
- Do not add compatibility shims for old storage layouts.
- Do not implement restart orchestration as a deploy-version-only mechanism.
  Restarts can be caused by deploys, manual operations, config changes, host
  maintenance, crash recovery, or policy.

## 1. Fast Server Session Read Path

### Current Risk

The selected session read path calls full runtime session inspection and then
enriches the session with Codex/terminal/runtime details. If any enrichment path
is slow during restart recovery, the detail response can be delayed or can
temporarily omit the usable control state the UI needs.

### Target Shape

Split session inspection into two layers:

1. Persisted base session view.
2. Optional runtime enrichment view.

The base view must read only persisted Vibe64-owned session/workflow state:

- session record and status
- current step
- step state
- workflow definition
- workflow machine projection
- presentation input
- actions and intents
- action results
- metadata
- background tasks
- persisted report/artifact references

The base view must not wait for:

- Codex app-server socket readiness
- Codex thread reconciliation
- terminal reconnect
- preview launch/open/restart
- git/control command reconciliation

### Implementation Tasks

- Add a runtime method such as `getPersistedSessionView(sessionId)` or a
  service helper that builds the current workflow view without runtime
  enrichment.
- Make `GET /sessions/:id` use the persisted base view by default.
- Move `enrichSessionWithCodexTerminal(...)` behind an optional enrichment step.
- Add a response section for readiness, for example:

```json
{
  "runtimeReadiness": {
    "codexAppServer": { "state": "restoring" },
    "terminalReconnect": { "state": "restoring" },
    "previewLaunch": { "state": "ready" },
    "gitControlReconcile": { "state": "running" }
  }
}
```

- If enrichment is stale/missing, schedule background recovery and emit a
  realtime session update when it changes.

### Required Tests

- `GET /sessions/:id` returns PR title/body fields while Codex app-server is
  unavailable.
- `GET /sessions/:id` returns current-step actions while preview launch is slow.
- Runtime enrichment failure is represented in readiness state, not by missing
  workflow controls.
- Session response duration remains bounded when terminal reconnect is delayed.

## 2. Runtime Readiness Overlays

### Target Runtime Categories

Runtime readiness should be reported independently from workflow controls:

- `codexAppServer`: `idle`, `restoring`, `ready`, `failed`
- `terminalReconnect`: `idle`, `restoring`, `ready`, `failed`
- `previewLaunch`: `idle`, `restoring`, `ready`, `stale`, `failed`
- `gitControlReconcile`: `pending`, `running`, `ready`, `failed`

These are Vibe64-owned runtime state. They are not source config and not
workflow truth.

### Behavior

- Current-step fields and actions render from persisted workflow state.
- Runtime readiness updates appear as badges, notices, background tasks, or
  disabled reasons on actions that truly require that subsystem.
- Save-draft-style actions that only update Vibe64 session state must not be
  blocked by Codex or preview readiness.
- Actions that require Codex/terminal/preview may be disabled with exact
  reasons, for example `Codex app-server is still restoring`.

### Implementation Tasks

- Normalize runtime readiness records for Codex app-server, terminal reconnect,
  preview launch, and git/control reconciliation.
- Store readiness under the project/session runtime bucket, not under source
  `.vibe64`.
- Make readiness updates emit `vibe64.session.changed` or a specific runtime
  readiness event.
- Ensure background recovery is idempotent and guarded by per-session locks.
- Avoid launching duplicate preview/Codex recovery jobs when multiple UI
  requests arrive.

### Required Tests

- Background readiness changes update the UI without changing workflow control
  shape.
- Failed Codex app-server recovery leaves PR fields visible.
- Preview readiness failure shows a preview/runtime warning, not a missing step.
- Repeated requests during restore do not start duplicate restore jobs.

## 3. Client Selected-Session Loading and Restoring State

### Current Risk

The client can combine selected session summary state with missing/incomplete
detail state. When no controls are available yet, the composer model can fall
through to a passive disabled state and show `Waiting for session controls`.

### Target Client States

Track selected-session detail explicitly:

- `summaryOnly`
- `detailLoading`
- `detailRestoring`
- `detailReady`
- `detailError`

### Client Behavior

- If selected detail is loading and no detail controls are available, render a
  restoring state or current-step skeleton. Do not render the bottom passive
  composer fallback.
- If stale previous detail exists, keep showing it and add a `Refreshing...` or
  `Restoring runtime...` readiness notice.
- Show `Waiting for session controls` only when detail has loaded and the
  persisted workflow view truly has no renderable controls.
- Preserve the current composer state-machine ownership:
  - chat/steer controls are composer-owned
  - current-step/document forms are timeline-owned
  - runtime readiness is overlay state

### Implementation Tasks

- Extend `useVibe64SessionData` with explicit selected-detail state.
- Expose selected-detail state to `useVibe64AutopilotView`.
- Update composer-control projection so loading/restoring detail suppresses the
  passive fallback.
- Add specific UI copy for restoration, for example `Restoring session...` or
  `Refreshing session controls...`.
- Keep previous detail visible when safe, rather than blanking the controls.

### Required Tests

- Summary-only selected session does not show `Waiting for session controls`.
- Detail loading shows restore/loading state.
- Stale detail remains visible while refresh is in flight.
- Loaded detail with real current-step controls renders timeline fields/actions.
- Loaded detail with genuinely missing controls still reports the invariant
  problem clearly.

## 4. Restart-Herd Prevention

### Problem

Deploy currently causes many daemon-owned runtime processes to restart/warm at
roughly the same time. This can create host process and service contention and
extend runtime recovery from seconds to tens of seconds or more.

This is not only a versioning problem. It is a general restart orchestration
problem.

### Target Model

Introduce tenant runtime generations:

- `desiredGeneration`
- `runningGeneration`
- `restartPending`
- `restartReason`
- `restartNotBefore`
- `restartDeadline`
- `restartPriority`
- `lastTrafficAt`

Restart reasons include:

- `deploy`
- `manual`
- `config_change`
- `secret_rotation`
- `host_maintenance`
- `crash_recovery`
- `policy`

### Request-Driven Restart

When a request arrives for a tenant whose process generation is older than
`desiredGeneration`, the restart must remain a host/supervisor concern, not app
business logic.

The V1 implementation uses tenant self-exit rather than placing another proxy
between Caddy and tenant services:

1. The tenant process reads the online-owned restart intent record.
2. If `desiredGeneration` differs from the process `VIBE64_RELEASE_GENERATION`,
   it returns a clear `503` restore response with `Retry-After`.
3. It schedules exactly one clean process exit.
4. `systemd` restarts only that tenant because the tenant unit has
   `Restart=always`.
5. `ExecStartPost` marks the running generation through the host restart
   controller, clearing matching pending restart intent.

The host restart controller still owns explicit/manual restarts and background
rollout locks. Request handlers do not run ad hoc `systemctl restart`.

### Jittered Background Rollout

When a restart is requested for many tenants:

1. Mark tenants `restartPending`.
2. Read recent activity from active session `conversation-log` directories.
3. Assign earlier `restartNotBefore` times and higher priority to recently
   active tenants, with optional jitter as the rollout window.
4. Use bounded concurrency, for example one or two tenant restarts at a time.
5. Do not eagerly warm every Codex app-server or preview runtime.
6. Warm active/recent sessions only, and keep workflow controls independent from
   that warm-up.

### Emergency Mode

Support a force mode for urgent restarts. Even then, default to bounded
concurrency unless the operator explicitly overrides it.

### Implementation Tasks

- Locate the current online deploy/restart path in `vibe64-online`.
- Add tenant restart generation state in an online-owned runtime/control bucket,
  not source `.vibe64`.
- Add a restart controller with per-tenant locks.
- Change deploy to mark restart intent instead of restarting every tenant
  immediately.
- Add lazy request-triggered restart handling through stale tenant self-exit.
- Add activity-aware, jittered, bounded background rollout.
- Add operator commands for status, force restart, and retry failed restart.
- Keep old tenant processes running until their tenant is restarted.

### Required Tests

- Deploy marks tenants pending without restarting all immediately.
- First request to stale tenant returns a clear restore response and restarts
  only that tenant through systemd.
- Ten simultaneous requests to one stale tenant schedule one process exit.
- Background rollout respects jitter and concurrency.
- Failed tenant restart records state and can be retried.
- Runtime container warm-up is not triggered for every idle tenant/session.

## 5. Git/Control Command Logging

### Current Risk

Failure logs can show `exitCode: 1` with an empty `outputTail`, which is not
diagnosable.

### Target Log Fields

Failed git/control command logs should include:

- `purpose`
- `commandKind`
- `argv` or safe command summary
- `cwd`
- `sessionId`
- `sourceRoot`
- `durationMs`
- `exitCode`
- `signal`
- `timedOut`
- `stdoutTail`
- `stderrTail`
- `outputTail`
- `errorCode`

Examples of `purpose`:

- `codex-thread-reconcile.git-status`
- `codex-thread-reconcile.identity-check`
- `preview-recovery.git-state`
- `session-action.git-sync`

### Implementation Tasks

- Find the shared command execution wrapper used by Codex git/control commands.
- Capture stdout and stderr separately.
- Preserve safe tails on success and failure.
- Include purpose at the call site.
- Avoid logging secrets or full env values.
- If there is truly no output, log the purpose and safe command summary so the
  failure is still traceable.

### Required Tests

- Failing command with stderr logs `stderrTail`.
- Failing command with stdout logs `stdoutTail`.
- Failing command with no output logs purpose, cwd, and exit code.
- Secret-like env values are not logged.
- Existing successful command logs remain compact.

## Recommended Implementation Sequence

1. Add failing tests for fast session detail:
   - PR fields/actions are returned while Codex/preview enrichment is slow or
     failing.
2. Refactor server inspection into persisted base response plus optional
   enrichment.
3. Add runtime readiness overlays and background recovery updates.
4. Update client selected-detail loading/restoring state.
5. Add git/control command logging improvements.
6. Implement restart generation state and the restart controller.
7. Change deploy to request restarts rather than stampeding all tenants.
8. Add request-triggered restart and activity-aware bounded background rollout.
9. Run targeted tests, then a local online-style smoke test:
   - create or open a project
   - reload during runtime restoration
   - verify session controls render before Codex/preview readiness
   - verify restart controller avoids all-daemon/runtime stampede

## Acceptance Criteria

- Reloading an existing PR/current-step session after deploy shows the persisted
  fields/actions quickly.
- Runtime recovery appears as readiness status, not missing controls.
- `Waiting for session controls` does not appear during normal detail loading or
  runtime restoration.
- A deploy does not restart all tenants at once.
- First request after restart intent restarts only that tenant through
  process self-exit and systemd.
- Background rollout uses activity priority, optional jitter, and bounded
  concurrency.
- Failed git/control commands are diagnosable from logs.
- No source-owned `.vibe64` files are used for runtime readiness, restart state,
  logs, or tenant orchestration.
