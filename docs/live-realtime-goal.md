# Goal: Make Vibe64 A Fully Live Multi-Tab JSKIT App

Improve Vibe64 realtime so the app behaves as a fully live multi-tab JSKIT app.

## Context

This repository is a JSKIT app, but the product is Vibe64. Vibe64 has no database; canonical state is filesystem/session state. Use JSKIT realtime patterns properly. Do not invent ad hoc socket layers unless JSKIT realtime cannot express a specific ephemeral behavior.

For now, there are no multi-user permission boundaries: broadcast Vibe64 realtime changes to all connected clients on the same server/VPS.

If two browser tabs are connected to the same Vibe64 server, work done in one tab must update the other tab automatically. Focus especially on session state, conversation/chat, background task state, launch/preview state, project state, and the active prompt/composer experience.

## Before Changing Code

1. Read `AGENTS.md` and follow its root-cause checkpoint.
2. Read the local JSKIT realtime guide: `node_modules/@jskit-ai/agent-docs/guide/agent/app-extras/realtime.md`.
3. Inspect existing Vibe64 realtime code:
   - `packages/vibe64-core/src/server/sessionRealtimeEvents.js`
   - `packages/vibe64-core/src/server/accountRealtimeEvents.js`
   - `packages/vibe64-sessions/src/server/Vibe64SessionsProvider.js`
   - `packages/vibe64-terminals/src/server/Vibe64TerminalsProvider.js`
   - `packages/vibe64-artifacts/src/server/Vibe64ArtifactsProvider.js`
   - `packages/vibe64-project/src/server/Vibe64ProjectProvider.js`
   - `src/composables/useVibe64SessionData.js`
   - `src/composables/useVibe64ConversationLog.js`
   - `src/composables/useVibe64LaunchControls.js`
   - `src/composables/useVibe64ProjectManagement.js`
   - `src/composables/useProjectSelectionGate.js`
   - `src/composables/useProjectTypeGate.js`
   - `src/composables/vibe64-session/composer/useVibe64AutopilotComposer.js`
   - `src/components/studio/vibe64-session/Vibe64WorkflowControlForm.vue`
   - `src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue`
4. Identify the real gaps before editing. Do not just patch one visible stale screen.

## First Verification Gate

Before implementing, use `agent-browser` or equivalent browser automation to prove you can authenticate into the real app using the cookie provided by the user.

If the cookie is missing, expired, malformed, or does not authenticate `/api/bootstrap` / the app page, stop and ask. Do not do a fake anonymous test and call it valid.

## Target Architecture

- Use JSKIT service event metadata for normal service mutations.
- Use Vibe64 core realtime event helper modules for expressive domain events.
- Use JSKIT `domainEvents` -> `@jskit-ai/realtime` -> Socket.IO bridge.
- Use `useEndpointResource({ realtime })` for canonical endpoint-backed state.
- Use direct `useRealtimeEvent` only where the state is not a canonical resource or needs custom coalescing.
- Realtime events should generally be invalidation signals, not full state replication.
- Tabs should refetch canonical HTTP resources from filesystem-backed state.
- Keep event names entity-based and small:
  - `vibe64.session.changed`
  - `vibe64.project.changed`
  - `vibe64.accounts.changed`
  - add another only if there is a clearly separate entity.
- Broadcast to all clients for now.
- Do not require a database.
- Avoid local-path hacks, hidden machine assumptions, or one-off socket emitters.

## Implementation Scope

1. Audit every session mutation path. Ensure every mutation that changes visible session state emits `vibe64.session.changed` after commit.
2. Audit every terminal/Codex/background path. Terminal bytes can remain terminal streams/websockets, but visible lifecycle state must update all tabs through session realtime.
3. Add project realtime support if missing:
   - project create/select
   - project type save
   - project config save
   - project archive/unarchive if present
   - project list/access surfaces if present
4. Ensure client resources subscribe declaratively:
   - session list
   - selected session
   - conversation log
   - launch targets/preview status
   - capabilities
   - project selection/list
   - project type/config gates
   - archived sessions if relevant
5. Add reconnect recovery. If a socket reconnects or the page regains connectivity after missing events, invalidate/refetch Vibe64 live resources so a missed event cannot leave a tab stale indefinitely.
6. Make the prompt/composer live in a small, robust way:
   - Sync the active composer draft across tabs for the same project/session/control.
   - Keep this basic and low-code.
   - The tab currently typing has right of way.
   - Other tabs should update when they are not actively typing, or after the active tab stops typing/debounced idle.
   - Do not persist drafts into Vibe64 session truth unless there is already a proper draft store.
   - Ephemeral realtime/local browser coordination is acceptable here.
   - Avoid complex collaborative editing. This is not CRDT work.
7. Keep code expressive and JSKIT-ish. Add helper modules only when they clarify the event contract or remove duplication.

## Tests Required

- Server unit tests for new realtime event helpers and provider event metadata.
- Server tests or focused assertions proving key mutation methods publish realtime after state changes.
- Client tests proving resource query invalidation/refetch happens on matching realtime payloads.
- Client tests for composer draft sync behavior, including "active typer wins".
- Avoid brittle sleeps where possible; use deterministic event hooks/fake realtime listeners in unit tests.

## Real Browser Verification Required

After implementation, actually run the app and test with real browser automation, not just unit tests.

Use the provided auth cookie. First prove it authenticates. Then open at least two tabs connected to the same server.

Test matrix:

1. Same project, same session, two tabs:
   - create/send a message or run a session action in tab A
   - tab B updates conversation/session state without manual refresh
2. Same project, different sessions:
   - change session A in one tab
   - the session list/state updates in the other tab without corrupting the other tab's selected session
3. Project-level change:
   - change project selection/config/type or create/select a project in one tab
   - the other tab updates project management/gates/capabilities correctly
4. Launch/preview state:
   - start/stop/reload a launch target in one tab
   - the other tab sees status changes without manual refresh
5. Composer draft:
   - type in the prompt in tab A
   - tab B reflects the draft when not actively typing
   - type in tab B and verify tab B has right of way until idle
6. Reconnect recovery:
   - simulate disconnect/reconnect or reload one tab while another changes state
   - the reconnected tab catches up.

If any real browser verification cannot be completed, say exactly what could not be verified and why. Do not claim the goal is complete.

## Final Response

- State root cause/gaps found.
- State what changed.
- List test commands run.
- Summarize real multi-tab browser verification results.
- List anything still unverified.
