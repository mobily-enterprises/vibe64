# OpenClaude Agent Provider Integration Plan

Status: reviewed implementation plan.
Date checked: 2026-07-02.

This plan is based on the current Vibe64 worktree. Do not apply it from memory:
recheck the named files before implementation. OpenClaude external facts were checked
against the current upstream docs and npm package metadata: `@gitlawb/openclaude`
is currently `0.21.0`, requires Node `>=22.0.0`, and exposes an `openclaude`
binary. The current Vibe64 package already requires Node `22.x`.

## Goal

Add OpenClaude as a first-class AI backend alongside Codex without weakening the
agent abstraction.

Required product behavior:

1. Users can configure Codex or OpenClaude. The new OpenClaude path is API-key
   only.
2. Configuring either AI backend is enough for session chat readiness.
3. The AI provider is selected before the session agent runtime is booted and is
   fixed for the rest of that session. If exactly one AI backend is configured,
   Vibe64 may auto-select it; if multiple are configured, the user must choose.
4. Provider menus, model choices, and thinking or reasoning choices come from the
   selected provider's capability metadata.
5. The agent layer is the contract. No UI, session, setup, or terminal special
   case should branch directly on a concrete backend when the layer can express
   the behavior.
6. The managed base toolchain image includes OpenClaude and the Studio doctor
   verifies it.

## Current Code Evidence

- Provider normalization is very thin in
  `packages/vibe64-runtime/src/server/agentProviders.js`: it only exposes
  `codex_app_server` and normalizes thread and turn IDs.
- Agent settings are static in
  `packages/vibe64-runtime/src/shared/agentSettings.js`: only provider `codex`
  exists, with `gpt-5.5` and low/medium/high/xhigh thinking choices.
- The settings UI in
  `src/components/studio/vibe64-session/Vibe64WorkflowControlForm.vue` reads
  `VIBE64_AGENT_PROVIDERS` directly from the shared static module.
- Client actions already pass `agentSettings` through
  `src/lib/vibe64SessionRequestConfig.js` and
  `src/composables/useVibe64SessionActions.js`.
- Session creation currently has no provider-selection payload path:
  `packages/vibe64-sessions/src/server/inputSchemas.js` does not accept
  `agentSettings`, and `src/composables/useVibe64SessionData.js` sends only the
  workflow selection.
- Session action and intent handlers normalize `agentSettings` in
  `packages/vibe64-sessions/src/server/service.js` and pass them to
  `terminalService.injectCodexPrompt`.
- Runtime handoff storage is still Codex-shaped: runtime creates
  `codexPromptHandoff`, the session store persists that shape, and the session
  service injects it through Codex terminal APIs.
- `createSession` in `packages/vibe64-sessions/src/server/service.js` currently
  calls `prepareCodexThreadForSession` before any user chat. That matches the
  current session-start runtime lifecycle, but it hard-codes Codex instead of a
  selected provider.
- `listSessions` in `packages/vibe64-sessions/src/server/service.js` currently
  triggers `reconcileCodexThreadsWhenOpenSessionsChange`, and terminal
  post-command paths can call Codex thread ensure logic. Those paths can start
  or reconcile Codex without a session-start provider decision.
- Codex app-server launch, thread, turn, auth preflight, and metadata are in
  `packages/vibe64-runtime/src/server/codexAppServerProvider.js`,
  `packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js`, and
  `packages/vibe64-terminals/src/server/codexTerminal.js`.
- Terminal routes such as `/codex-thread`, `/codex-terminal`,
  `/codex-turn/interrupt`, and `/codex-turn/steer` dispatch directly to Codex
  today and can bypass provider identity unless converted to generic routes with
  Codex aliases.
- The Codex bridge already writes generic-looking `agent_identity_*` metadata.
  A new provider layer should extend or migrate those fields instead of adding
  parallel names that can drift.
- Runtime conversation writes and workflow finalization still use
  `source: "codex"` as the assistant-agent source.
- Account readiness is hard-coded to `codex` and `github` in
  `packages/vibe64-accounts/src/server/service.js` and
  `packages/vibe64-accounts/src/client/composables/useAccountsSetup.js`.
- Connection readiness currently treats required account rows as an all-of list
  in `packages/vibe64-accounts/src/server/Vibe64AccountsProvider.js`.
- The local fallback connection service reports `codex` and `github` as ready
  in `packages/vibe64-runtime/src/server/connectionReadiness.js`.
- Current-app capability and readiness responses still name Codex as the
  selected AI provider in `packages/current-app/src/server/service.js`.
- Managed toolchain identity is centralized in
  `packages/studio-terminal-core/src/server/studioRuntimeIdentity.js`.
- The base toolchain Dockerfile installs `@openai/codex` but not OpenClaude in
  `tooling/studio-setup/Dockerfile`.
- Studio Setup doctor checks `codex`, but not OpenClaude, in
  `packages/studio-setup-doctor/src/server/service.js`.
- Managed image versioning and command identity also appear in
  `.github/workflows/publish-toolchain-images.yml`, adapter Dockerfile base image
  args, and `STUDIO_MANAGED_CODEX_COMMAND`.
- Source-editor detached agent chats use agent helpers and store thread/turn
  data without an explicit provider identity, so follow-up/delete/interrupt
  paths need provider routing too.
- Client realtime overlays and reload filters consume Codex-shaped
  `codexAgentRun` and `codexAgentTurn` payloads.
- Package descriptors for accounts and terminals advertise capabilities and can
  drift if runtime/provider behavior changes without descriptor updates.

## Root Causes To Fix

1. The provider layer has no capability model. UI menus, defaults, runtime
   launch, auth requirements, and status messages are spread across Codex-named
   modules.
2. Session creation eagerly prepares a Codex app-server thread, so provider
   selection must happen before the session agent runtime is booted. Other
   open-session reconciliation and terminal post-command paths can also prepare
   Codex without checking the selected provider.
3. Account readiness treats Codex as the required AI account instead of treating
   AI readiness as "at least one configured AI provider".
4. Provider state paths are Codex-specific, so OpenClaude needs either a parallel
   ad hoc path or a generalized provider-home contract. The latter is the only
   non-drifting option.
5. Toolchain metadata and setup diagnostics currently know only about Codex, so
   adding the binary without updating checks would produce contract drift.
6. Terminal turn state, result finalization, realtime payloads, and detached
   source-editor chats are Codex-shaped, so OpenClaude cannot be correct until
   those flows dispatch through provider-neutral contracts.
7. The create-session API and UI do not yet carry provider selection, so the new
   session-start rule needs explicit request, schema, and server validation
   work before any runtime boot happens.

## Agent Review Findings Applied

Three independent review passes expanded the plan in these areas:

- Runtime/session lifecycle: Codex can currently start through session creation,
  open-session reconciliation, terminal post-command ensure paths, and Codex
  terminal action handlers. The plan now gates all automatic Codex ensure paths
  and adds provider-neutral dispatch before OpenClaude work begins.
- Auth/readiness/setup: OpenClaude cannot reuse Codex account plumbing safely
  because modes, labels, API-key commands, real-home credential contexts,
  readiness groups, and current-app capability responses are Codex-shaped. The
  plan now requires an auth registry and AI readiness group semantics.
- Operations/toolchain/compatibility: the OpenClaude CLI contract must be proven
  first, managed image versioning has multiple source files, generic
  `agent_identity_*` metadata already exists, detached source-editor chats need
  provider identity, and package descriptors must stay aligned.

A second three-agent review after changing provider selection from first-message
binding to session-start binding added concrete create-session UI/API plumbing,
current-app `selectionRequired` state, `agentPromptHandoff`, Codex route alias
guards, canonical `agent_identity_status`, provider-neutral close cleanup,
provider-neutral conversation write source, client realtime migration files, and
transport/product provider ID separation.

## Target Architecture

Introduce an explicit agent-provider layer with these contracts:

- `AgentProviderId`: product provider ID such as `codex` or `openclaude`.
- `AgentTransportId`: runtime transport ID such as `codex_app_server` or an
  OpenClaude PTY/process adapter. Introduce `AGENT_TRANSPORT_IDS` and keep
  product IDs separate from transport IDs in persisted metadata.
- `AgentProviderDefinition`: serializable provider metadata for the UI and
  setup pages.
- `AgentProviderCapabilities`: model menu, reasoning or thinking menu,
  attachment support, interactive terminal support, thread resume strategy, auth
  modes, and toolchain commands.
- `AgentProviderRuntime`: server adapter with methods equivalent to
  `ensureAvailable`, `startThread`, `resumeThread`, `readThread`, `sendTurn`,
  `steerTurn`, `interruptTurn`, `deleteThread`, `subscribe`, `stopRuntime`, and
  optional native terminal resume command.
- `AgentProviderAuth`: account status, API-key login, logout, marker/status
  path, redaction, reconnect-required handling, and runtime invalidation.
- `SessionAgentBinding`: persisted session metadata, preferably by extending the
  existing `agent_identity_*` fields, that records the chosen product provider
  ID, transport ID, model, reasoning choice, provider thread ID, workdir,
  binding status, binding timestamp, and resume strategy. This binding is
  created during session creation before the selected provider runtime is
  started.
- `AgentPromptHandoff`: provider-neutral persisted handoff contract. Keep
  `codexPromptHandoff` only as a Codex compatibility alias during migration.
- `AgentTurnLifecycle`: provider-neutral result extraction, stale-turn handling,
  final assistant text, live progress, conversation writes, and background task
  finalization.

Codex and OpenClaude both implement the same layer. Existing Codex code can be
wrapped first, then renamed gradually. Do not duplicate Codex UI or session
flow for OpenClaude.

## Slice 0: OpenClaude CLI Contract Spike

Do this before the runtime adapter. The product cannot depend on undocumented
behavior guessed from interactive examples.

Files likely involved:

- `docs/openclaude-agent-provider-integration-plan.md`
- optional checked-in spike notes under `docs/` if the commands/results are
  useful implementation evidence

Implementation steps:

1. In a clean managed-toolchain-like environment, install the pinned
   `@gitlawb/openclaude` version and record the exact version, Node engine, and
   exposed binary.
2. Verify `OPENCLAUDE_CONFIG_DIR` behavior with an empty temp directory and a
   provider-home-like directory.
3. Prove the exact commands needed for:
   - starting a conversation
   - sending one prompt non-interactively, or through a controlled PTY if no
     stable non-interactive command exists
   - resuming a conversation
   - continuing the last conversation
   - interrupting or cancelling, if supported
   - reading transcript/history data
4. Capture transcript format, stable conversation IDs, stable turn IDs if any,
   exit codes, stderr patterns, and failure modes for missing or invalid API
   keys.
5. Decide whether the adapter can use a stable CLI contract directly or must
   wrap OpenClaude in a Vibe64-owned PTY/process protocol.

Acceptance checks:

- Spike artifact names the supported command contract and the rejected commands.
- Spike artifact proves OpenClaude can be isolated from machine-global config.
- Runtime adapter implementation does not begin until the transcript/resume
  contract is known.

## Slice 1: Provider Registry And Capability API

Files likely involved:

- `packages/vibe64-runtime/src/server/agentProviders.js`
- `packages/vibe64-runtime/src/shared/agentSettings.js`
- `packages/vibe64-runtime/src/shared/index.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-sessions/src/server/inputSchemas.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/current-app/src/server/service.js`
- `src/composables/useVibe64AgentSettings.js`
- `src/composables/useVibe64SessionData.js`
- `src/composables/useVibe64SessionPanel.js`
- `src/components/studio/vibe64-session/Vibe64CreateSessionButton.vue`
- `src/components/studio/vibe64-session/Vibe64SessionToolbar.vue`
- `src/components/studio/vibe64-session/Vibe64WorkflowControlForm.vue`

Implementation steps:

1. Replace static `VIBE64_AGENT_PROVIDERS` as the source of truth with a shared
   normalizer that accepts a provider catalog. Keep a static fallback only for
   initial render and tests.
2. Add a server-side `agentProviderCatalog()` that returns Codex and OpenClaude
   provider definitions from one registry.
3. Add a project-scoped endpoint such as `GET /vibe64/agent-providers` that
   returns the provider catalog, ready/configured status, default provider
   recommendation, current selection state, and a signature for caching.
4. Update `useVibe64AgentSettings` to load provider catalog data and normalize
   settings against the selected provider's parameters.
5. Update `Vibe64WorkflowControlForm.vue` to render provider and parameter
   controls from the loaded catalog, not imported static constants.
6. Add an explicit provider selector before session start when more than one AI
   backend is configured. The selected provider must be included in the
   create-session request when selection is required.
7. Update create-session UI and composables so
   `Vibe64CreateSessionButton.vue`, `Vibe64SessionToolbar.vue`,
   `useVibe64SessionPanel.js`, and `useVibe64SessionData.js` can pass the
   selected provider/settings to the server.
8. Update current-app capability/readiness responses so the selected AI provider
   and connection rows come from the provider catalog and account status. Include
   fields such as `providers`, `connectedProviderIds`, `configuredProviderIds`,
   `selectedProviderId`, `autoSelectedProviderId`, and `selectionRequired`.
9. Unknown or unavailable provider IDs must produce a clear error; they must not
   silently fall back from OpenClaude to Codex.
10. Preserve existing local-storage behavior, but key stored settings by provider
   catalog signature so removed or renamed provider options normalize cleanly.

Acceptance checks:

- Unit test: unknown provider normalizes to the catalog default.
- Unit test: selecting OpenClaude changes model and thinking menu options to the
  OpenClaude definition.
- Client test: provider menu has Codex and OpenClaude when both are in the
  catalog.
- Client test: create-session request includes selected provider/settings when
  multiple AI providers are configured.
- No UI file branches on `providerId === "openclaude"` for menu contents.
- Current-app capability test does not hard-code Codex as the only selected AI
  provider.
- Current-app capability test reports `selectionRequired: true` when both AI
  providers are configured and no session-start provider has been selected.

## Slice 2: API-Key AI Account Readiness

Files likely involved:

- `packages/vibe64-accounts/src/server/service.js`
- `packages/vibe64-accounts/src/server/inputSchemas.js`
- `packages/vibe64-accounts/src/server/Vibe64AccountsProvider.js`
- `packages/vibe64-accounts/src/client/composables/useAccountsSetup.js`
- `packages/vibe64-accounts/src/client/composables/useAccountAuthSessions.js`
- `packages/vibe64-accounts/src/client/composables/useProviderAccountsSetup.js`
- `packages/vibe64-accounts/src/client/composables/useVibe64Accounts.js`
- `packages/vibe64-accounts/src/client/studio/AIAccountsSetup.vue`
- `packages/vibe64-accounts/src/client/studio/ProviderAccountsSetup.vue`
- `src/components/studio/Vibe64AuthSettingsButton.vue`
- `packages/studio-terminal-core/src/server/credentialHomes.js`
- `packages/vibe64-runtime/src/server/connectionReadiness.js`
- tests under `tests/server/*Accounts*`, `tests/e2e/connection-*`, and setup
  tests that assert Codex-only readiness text.

Implementation steps:

1. Add an account/auth registry keyed by provider ID. It owns auth modes, login
   command behavior, labels, status files, redaction, reconnect-required
   invalidation, logout, and any runtime cache invalidation hooks.
2. Resolve app-scope AI credentials from the daemon owner’s real home through
   the credential-home contract. Do not create Vibe64-owned credential homes.
3. Add either `openclaudeCredentialContext` helpers or a generic app-provider
   credential context plus generic auth-state helpers. Do not introduce
   compatibility paths for deleted provider homes.
4. Add `openclaude` to account definitions with:
   - label `OpenClaude`
   - scope `app`
   - auth modes: `api_key` only
   - no OAuth, browser, or device mode
   - status marker under the daemon owner’s real-home OpenClaude config
   - private provider files under the daemon owner’s real home
5. Generalize Codex API-key login metadata enough that OpenClaude can reuse the
   API-key form with provider-specific labels, validation message, redaction, and
   command implementation.
6. OpenClaude `browser` and `device` auth requests must return an explicit
   `unsupported_auth_mode` error. They must not normalize to browser auth.
7. Add OpenClaude API-key status implementation. The first pass should use the
   daemon owner’s real-home OpenClaude profile/config location. The stored
   secret must be mode `0600` and must not be echoed in command previews.
8. Change account readiness from "Codex and GitHub are both required" to:
   - individual AI provider rows are diagnostic
   - required `ai` group is ready if at least one configured AI provider is
     connected
   - if multiple AI providers are configured, readiness can be ready while
     session creation still reports provider `selectionRequired`
   - GitHub remains required where project workflows require it
   - connection rows still expose individual provider rows for UI and debugging
9. Update `blockedReason` to report a group-level AI message only when no AI
   provider is configured.
10. Update the local fallback connection service to use provider catalog/group
   semantics instead of hard-coded Codex availability.
11. Update the account dialog to show Codex and OpenClaude as AI provider tabs or
   rows. The UI should be driven by account/provider definitions, not a static
   two-row fallback.
12. Update `AIAccountsSetup.vue`, `useAccountsSetup`,
    `useProviderAccountsSetup.js`, `useAccountAuthSessions.js`,
    `useVibe64Accounts.js`, `ProviderAccountsSetup.vue`,
    `Vibe64AuthSettingsButton.vue`, and account dialog reconnect/attention text
    so non-GitHub providers do not fall into Codex/OpenAI labels such as "Login
    with ChatGPT".

Acceptance checks:

- Server unit test: Codex connected and OpenClaude missing means session
  readiness is ready.
- Server unit test: OpenClaude connected and Codex missing means session
  readiness is ready.
- Server unit test: neither AI backend connected blocks chat/session readiness.
- Server unit test: OpenClaude rejects browser/device auth and accepts only
  API-key auth.
- Client test: OpenClaude API-key form labels and buttons do not mention OpenAI
  unless the selected OpenClaude profile specifically is an OpenAI-compatible
  profile.
- Secret redaction test covers OpenClaude API keys and profile contents.

## Slice 3: Provider-Neutral Runtime Dispatch Around Existing Codex

Files likely involved:

- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-sessions/src/server/actions.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-runtime/src/server/runtime.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-terminals/src/server/registerRoutes.js`
- `packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js`
- terminal/session route files that expose `/codex-turn/interrupt`,
  `/codex-turn/steer`, and terminal state payloads
- `tests/server/vibe64SessionsService.unit.test.js`
- `tests/server/vibe64TerminalsService.unit.test.js`

Implementation steps:

1. Add provider-neutral service methods before adding OpenClaude:
   `injectAgentPrompt`, `agentTerminalState`, `steerAgentTurn`,
   `interruptAgentTurn`, `ensureAgentThread`, and `deleteAgentThread`.
2. Add canonical `agentPromptHandoff` in runtime/session-store contracts.
   Preserve `codexPromptHandoff` only as a compatibility alias for Codex sessions
   during migration.
3. Implement those methods by delegating to the existing Codex implementation
   for Codex-bound sessions. Keep Codex-named methods and routes as aliases
   while callers migrate.
4. Change session action and intent handlers to read the persisted binding,
   reject conflicting provider changes, normalize parameters from the bound
   provider, and call generic methods rather than `injectCodexPrompt` or Codex
   controller maps directly.
5. Add generic agent-thread and agent-turn routes for bound-provider dispatch.
   Existing Codex routes must load the session binding and reject or disable for
   non-Codex sessions instead of starting Codex as an escape hatch.
6. Expose capability flags such as `canInterrupt`, `canSteer`,
   `canNativeResume`, and `canInteractiveTerminal` through the provider catalog.
7. Keep legacy Codex realtime fields and route aliases for Codex sessions, but
   also publish generic `agentRun`/`agentTurn` state for all providers.

Acceptance checks:

- Unit test: Codex behavior is unchanged when invoked through
  `injectAgentPrompt`.
- Unit test: session action and intent handlers do not require
  `terminalService.injectCodexPrompt`.
- Unit test: persisted `agentPromptHandoff` is accepted by runtime/session store
  and `codexPromptHandoff` remains a Codex-only compatibility alias.
- Unit test: interrupt and steer dispatch through the bound provider capability
  and fail clearly when unsupported.
- Route test: Codex route aliases reject or disable for OpenClaude-bound
  sessions and generic routes dispatch through the bound provider.
- Realtime payload test includes generic agent state and retains legacy Codex
  aliases for Codex sessions.

## Slice 4: Session-Start Provider Binding

Files likely involved:

- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-sessions/src/server/actions.js`
- `packages/vibe64-sessions/src/server/inputSchemas.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-terminals/src/server/registerRoutes.js`
- `src/composables/useVibe64SessionData.js`
- `src/composables/useVibe64SessionPanel.js`
- `src/components/studio/vibe64-session/Vibe64CreateSessionButton.vue`
- `src/components/studio/vibe64-session/Vibe64SessionToolbar.vue`
- `tests/server/vibe64SessionsService.unit.test.js`
- `tests/server/vibe64TerminalsService.unit.test.js`

Implementation steps:

1. Stop preparing a hard-coded Codex thread in `createSession`. Replace
   `prepareCodexThreadForSession` with a provider-neutral
   `prepareAgentThreadForSession` that starts the provider selected for this
   session.
2. Gate every other automatic Codex ensure/reconcile path so it runs only for a
   session already bound to Codex. Name and update the current paths explicitly:
   `codexThreadReconcileReadySessions`,
   `codexThreadReconcileSessionSignature`,
   `reconcileCodexThreadsWhenOpenSessionsChange`, terminal post-command ensure
   paths, and `reconcileCodexAppServerThreadForSession`.
3. Add `sessionAgentBindingFromSession(session)` and
   `bindSessionAgentProviderAtStart(runtime, input, requestedSettings)` helpers.
4. Extend create-session input schema, routes, and client call sites so provider
   settings can be supplied at session start.
5. Before creating or booting the session agent runtime:
   - resolve the requested provider from the session-start input and
     `agentSettings.providerId`
   - if no provider is requested and exactly one AI provider is configured, use
     that provider
   - if no provider is requested and multiple AI providers are configured,
     return a clear selection-required error before creating or booting the
     session
   - validate and persist the binding before `runtime.createSession` performs
     provider boot
   - claim/write `pending` under the session lock, release the lock for provider
     boot, then commit `ready` or `failed` under the lock with an attempt ID or
     lease
6. On later handoffs:
   - ignore or reject provider changes that conflict with the persisted binding
   - normalize model/thinking using the bound provider's catalog, not the latest
     UI selection
   - preserve steering, interrupt, and resume behavior through the bound provider
7. Extend the existing `agent_identity_*` metadata with any missing fields
   instead of inventing parallel names. If a field rename is unavoidable, add a
   migration plan and one canonical reader.
8. Persist both generic metadata and backward-compatible Codex metadata during
   transition:
   - generic: `agent_identity_provider`, `agent_identity_transport`,
     `agent_identity_model`, `agent_identity_reasoning`,
     `agent_identity_conversation_id`, `agent_identity_turn_id`,
     `agent_identity_status`
   - existing Codex fields remain populated when provider is Codex until all
     readers move to generic names
9. Update realtime payloads and background task records to include generic
   provider identity while preserving existing Codex fields for compatibility.
10. Add provider-neutral session-close cleanup such as
    `closeAgentRuntimeForSession` so abandon, finish, and close stop the bound
    provider runtime. Keep existing Codex cleanup as the Codex implementation.

Acceptance checks:

- Server unit test: creating an OpenClaude-selected session starts/prepares
  OpenClaude and does not start or prepare Codex.
- Server unit test: creating a Codex-selected session preserves existing Codex
  startup behavior through the generic provider path.
- Server unit test: with both AI backends configured, creating a session without
  a provider selection returns a selection-required error before session
  creation or provider boot.
- Server unit test: listing open sessions does not start or reconcile Codex for
  unbound or OpenClaude-bound sessions.
- Server unit test: session creation with OpenClaude binds
  `agent_identity_provider` to `openclaude`.
- Server unit test: a second chat with Codex settings in an OpenClaude-bound
  session is rejected or normalized to OpenClaude, with an explicit test for the
  chosen policy.
- Server unit test: steering and interrupt call the bound provider, not a hard
  coded Codex controller.
- Server unit test: concurrent session-start attempts cannot create two provider
  bindings or strand the session permanently in `pending`.
- Server unit test: concurrent callers observe a pending binding and cannot boot
  a second provider.
- Server unit test: closing a session invokes the bound provider cleanup and does
  not call Codex cleanup for OpenClaude-bound sessions.
- Regression test: existing Codex sessions still resume through Codex metadata.

## Slice 5: Provider-Neutral Turn Lifecycle, Realtime, And Results

Files likely involved:

- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js`
- `packages/vibe64-runtime/src/server/runtime.js`
- `packages/vibe64-sessions/src/server/service.js`
- `src/lib/vibe64CodexTurnRealtimeOverlay.js`
- `src/composables/useVibe64SessionData.js`
- conversation log client files that render agent turn/reasoning state
- runtime/background task modules that classify notification and agent-run
  patches
- tests under `tests/server/*Terminal*`, `tests/server/*Sessions*`, and provider
  adapter tests

Implementation steps:

1. Extract Codex-specific final assistant text parsing, result envelope
   extraction, transcript recovery, stale-turn handling, and notification
   classification into `AgentTurnLifecycle`.
2. Keep the existing `VIBE64_AGENT_RESULT_BEGIN` /
   `VIBE64_AGENT_RESULT_END` contract as the canonical result envelope unless
   the OpenClaude spike proves a better provider-neutral envelope is required.
3. Route workflow advancement, conversation writes, live progress, reasoning
   text, background task patches, and finalization source through the agent
   layer rather than hard-coded `"codex"`. Prefer canonical `source: "agent"`
   plus provider metadata; keep `source: "codex"` only as a Codex compatibility
   alias during migration.
4. Add generic realtime state names for current runs/turns. Preserve
   `codexAgentTurn*` aliases for Codex clients until the UI migration is
   complete.
5. Surface unsupported capabilities explicitly. For example, an OpenClaude
   adapter without steering should report `canSteer: false`, and the UI/service
   should disable or reject steering through the same generic path.

Acceptance checks:

- Unit test: Codex finalization still produces the same assistant response and
  workflow advancement.
- Unit test: a fake OpenClaude transcript can produce a normalized final result
  without writing Codex-specific source names.
- Unit test: runtime conversation writes accept the provider-neutral agent
  source and provider metadata.
- Unit test: stale turns and partial transcripts finalize through provider ID.
- Realtime client/server test: generic current-turn state is present for both
  providers, client reload filters consume generic events, and Codex aliases
  remain available for Codex sessions.

## Slice 6: Detached Agent Conversations

Files likely involved:

- `packages/vibe64-source-editor/src/server/service.js`
- source-editor agent helper modules and routes
- conversation/thread persistence modules used by source explanations
- `packages/vibe64-runtime/src/server/agentProviders.js`
- `packages/vibe64-terminals/src/server/service.js`
- tests covering source-editor explanation follow-up/delete/interrupt flows

Implementation steps:

1. Inventory detached agent flows, especially source-editor explanations, that
   create agent conversations outside the primary Vibe64 session chat path.
2. Persist product provider ID, transport ID, provider conversation ID, and turn
   ID with each detached conversation record. For existing records with only
   `agentThreadId` / `agentTurnId`, default to Codex through a documented
   compatibility reader.
3. Route follow-up, delete, interrupt, transcript read, and resume operations
   through the same provider runtime registry used by session chat.
4. Define whether detached conversations inherit the parent session binding or
   choose their own provider. If both are valid, make the policy explicit in the
   provider catalog and UI.

Acceptance checks:

- Unit test: detached source-editor follow-up dispatches to the stored provider.
- Unit test: deleting an OpenClaude detached conversation does not call a Codex
  delete path.
- Regression test: existing Codex source-editor explanations still work.

## Slice 7: Provider Runtime Adapter For OpenClaude

Files likely involved:

- new `packages/vibe64-runtime/src/server/openClaudeProvider.js`
- `packages/vibe64-runtime/src/server/agentProviders.js`
- `packages/vibe64-runtime/src/server/codexAppServerProvider.js`
- `packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js` or a new generic
  `agentTerminal.js`
- tests under `tests/server/*Provider*.unit.test.js`

Implementation steps:

1. Wrap existing Codex app-server as `codex` implementation of the generic
   `AgentProviderRuntime`.
2. Add an OpenClaude runtime implementation behind the same interface.
3. Use the Slice 0 spike artifact as the adapter contract. Do not rely on
   commands or transcript fields that were not proven in that spike.
4. Prefer a provider-home-local OpenClaude config directory using
   `OPENCLAUDE_CONFIG_DIR` so Vibe64 does not depend on `~/.openclaude`.
5. If OpenClaude does not expose an app-server or machine-readable RPC contract,
   add a Vibe64 provider wrapper that runs OpenClaude in a controlled PTY or
   background process and adapts transcript events into `AgentProviderRuntime`.
   This wrapper belongs in the layer, not in UI/session code.
6. Normalize OpenClaude turn results into the existing
   `VIBE64_AGENT_RESULT_BEGIN` / `VIBE64_AGENT_RESULT_END` contract, or enhance
   the result extraction layer if OpenClaude transcripts differ.
7. Add provider-specific command builders for:
   - start thread
   - resume thread
   - send turn
   - stream/read result
   - interrupt if supported
   - delete/cleanup if supported
8. Expose unsupported provider operations through the generic capability
   contract. The UI should see "interrupt unsupported" because the layer says so,
   not because it checks for OpenClaude.

Acceptance checks:

- Unit test: OpenClaude provider runs with `OPENCLAUDE_CONFIG_DIR` under the
  daemon owner’s real home and never reads unrelated machine-global config.
- Unit test: OpenClaude command env includes only the configured API key/profile
  data and redacts it from logs.
- Unit test: generic provider wrapper returns normalized thread and turn IDs.
- Integration-style test with a fake OpenClaude process verifies successful
  assistant result extraction and provider failure handling.
- Existing Codex provider tests still pass after being wrapped.

## Slice 8: Provider-Specific Menus And Defaults

Files likely involved:

- `packages/vibe64-runtime/src/shared/agentSettings.js`
- `packages/vibe64-runtime/src/server/agentProviders.js`
- `src/composables/useVibe64AgentSettings.js`
- `src/components/studio/vibe64-session/Vibe64WorkflowControlForm.vue`
- `tests/client/*AgentSettings*`

Implementation steps:

1. Model settings as provider parameters:
   - `model`: list/select/freeform policy
   - `reasoning`: low/medium/high/xhigh or provider-specific values
   - any OpenClaude profile/provider choice needed to route to a concrete
     backend
2. Codex provider definition supplies existing Codex model and reasoning options.
3. OpenClaude provider definition supplies OpenClaude-backed options. Start with
   a curated, provider-owned list that matches the selected OpenClaude profile
   capabilities. Add a discovery method later only if OpenClaude exposes stable
   machine-readable output.
4. Make "Automatic" a provider-defined option, not a global assumption.
5. Add normalization that drops invalid parameter values when switching
   providers.
6. Add provider catalog signature to client cache invalidation and realtime
   refresh if provider status changes.

Acceptance checks:

- Client unit test: switching provider resets unsupported parameter values.
- Client unit test: OpenClaude can expose a different reasoning menu than Codex.
- Server unit test: session-start and handoff normalization use the bound
  provider's parameters.

## Slice 9: Managed Toolchain Image

Files likely involved:

- `tooling/studio-setup/Dockerfile`
- `.github/workflows/publish-toolchain-images.yml`
- `packages/studio-terminal-core/src/server/studioRuntimeIdentity.js`
- `packages/studio-setup-doctor/src/server/service.js`
- `bin/pull-toolchain-images.js`
- adapter Dockerfiles under `tooling/adapters/*/Dockerfile` if the base image
  version changes.

Implementation steps:

1. Add an `OPENCLAUDE_VERSION` build arg and install
   `@gitlawb/openclaude@${OPENCLAUDE_VERSION}` in the base toolchain image.
   Pin the default version instead of using `latest`.
2. Verify `openclaude --version` during image build.
3. Bump `VIBE64_TOOLCHAIN_IMAGE_VERSION` in
   `studioRuntimeIdentity.js`.
4. Add `STUDIO_MANAGED_OPENCLAUDE_COMMAND` next to
   `STUDIO_MANAGED_CODEX_COMMAND` and use that constant in setup doctor and
   runtime command construction.
5. Update `.github/workflows/publish-toolchain-images.yml` and adapter
   Dockerfile base image defaults if they pin or duplicate the old base image
   version.
6. Add Studio Setup doctor check:
   - id `openclaude`
   - command `openclaude --version`
   - expected text that OpenClaude is available inside the managed base
     toolchain
7. Update tests and e2e fixtures that enumerate setup doctor toolchain checks.

Acceptance checks:

- Unit test: managed setup doctor reports OpenClaude check.
- Docker build check: base image build reaches `openclaude --version`.
- `node ./bin/pull-toolchain-images.js --dry-run` reports the bumped managed
  image names.

## Slice 10: Naming And Compatibility Boundary

This pass should not rename every user-facing "Codex" string. It should rename
only code paths where a hard-coded Codex name blocks OpenClaude correctness.

Required renames or aliases:

- Generic runtime/service names for provider-agnostic APIs:
  `injectAgentPrompt`, `ensureAgentThread`, `interruptAgentTurn`,
  `steerAgentTurn`, `agentTerminalState`.
- Rename or alias `AGENT_PROVIDER_IDS.CODEX_APP_SERVER` to
  `AGENT_TRANSPORT_IDS.CODEX_APP_SERVER`; keep product provider ID `codex`
  distinct from transport ID `codex_app_server`.
- Keep Codex route aliases such as `/codex-terminal` until clients and tests can
  migrate safely.
- Add generic metadata fields while continuing to write Codex metadata for
  Codex-bound sessions.
- Add generic realtime reasons only when existing Codex reason names become
  misleading for OpenClaude. During transition, include both generic and legacy
  payload fields where needed.
- Update package descriptors, especially accounts and terminals, so advertised
  capabilities match the new provider/auth/runtime APIs.

Acceptance checks:

- No OpenClaude implementation writes fake `codex_thread_id` metadata unless it
  is explicitly a backward-compatibility alias guarded by provider identity.
- Existing clients using Codex routes still work for Codex sessions.
- Product provider `codex` is never conflated with transport
  `codex_app_server` in binding readers or tests.
- OpenClaude sessions do not show a Codex resume command.
- Package descriptor verification reflects the new account/provider APIs.

## Slice 11: Verification Matrix

Run these checks as the implementation lands:

1. Static and unit:
   - `npm test`
   - `npm run test:client`
   - targeted server tests for accounts, setup readiness, sessions, terminals,
     and provider adapters
2. JSKIT verification:
   - `npx jskit app verify`
   - `npm run verify:packages`
3. Toolchain:
   - build base toolchain image locally
   - run `openclaude --version`, `codex --version`, `rg --version`, `gh --version`
     inside the image
4. Manual runtime paths:
   - only Codex API key configured: create session, Codex is auto-selected and
     booted
   - only OpenClaude API key configured: create session, OpenClaude is
     auto-selected and booted
   - both configured: session creation requires explicit provider selection
   - both configured: create-session API without selected provider fails before
     session creation or provider boot
   - both configured: choose Codex before session start, then confirm later
     OpenClaude selection cannot switch the session
   - both configured: choose OpenClaude before session start, then confirm later
     Codex selection cannot switch the session
   - neither configured: session chat readiness blocks with group-level AI
     message
5. Regression:
   - existing Codex session resume
   - Codex interrupt and steer
   - setup doctor
   - account reconnect required
   - GitHub readiness and project setup

## Ordering

Recommended implementation order:

1. OpenClaude CLI contract spike.
2. Provider catalog and settings normalization.
3. Account readiness group model and OpenClaude API-key account status.
4. Provider-neutral runtime dispatch around existing Codex.
5. Session-start provider binding and Codex auto-start gates.
6. Provider-neutral turn lifecycle, realtime state, and results.
7. Detached agent conversations.
8. Generic provider runtime wrapper around existing Codex.
9. OpenClaude runtime adapter.
10. Provider-specific menus and defaults.
11. Toolchain image and setup doctor.
12. Compatibility aliases and package descriptors.
13. Full verification matrix.

This order reduces risk because the existing Codex backend first proves the
generic layer before OpenClaude is added behind it.

## Open Questions To Resolve During Implementation

1. Which OpenClaude backend/profile should Vibe64 configure first: an
   OpenAI-compatible profile, OpenRouter, Gemini, or Gitlawb Opengateway?
   The provider layer can support all later, but the first UI needs one
   concrete API-key shape.
2. Does the current OpenClaude CLI expose a stable machine-readable transcript
   or RPC/app-server mode? If yes, use it. If no, build a Vibe64 wrapper in the
   provider layer.
3. Should Codex OAuth/device login remain visible as a legacy auth mode, or
   should the AI setup flow hide it to satisfy an API-key-only product policy?
   OpenClaude itself must remain API-key only.
4. Should session creation block entirely when multiple AI providers are
   configured and no provider is selected, or should the UI prevent the create
   action before the request is sent? The server must still enforce explicit
   selection.
