# Isolated work sessions

Each coding task can use a recoverable source workspace that is isolated from
the canonical project and from other sessions.

## Sources

- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-sessions/src/server/sessionRenewal.js`
- `packages/vibe64-runtime/src/server/runtime.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `packages/vibe64-terminals/src/server/sessionSource.js`
- `src/components/studio/vibe64-session/Vibe64RenewalAssistantSelector.vue`
- `src/components/studio/vibe64-session/Vibe64SessionToolbar.vue`
- `src/components/studio/Vibe64SessionPanel.vue`
- `src/lib/vibe64SessionInfo.js`
- `src/lib/vibe64SessionTooltip.js`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/composables/useArchivedVibe64Sessions.js`
- `src/composables/useVibe64SessionRenewal.js`
- `src/composables/useVibe64SessionRepositoryStatusRegistry.js`

## Public contract

People can create, select, inspect, and archive sessions. A new session receives
its own Git source and stable identity. Its conversation, source location,
agent activity, workspace preparation, and repository status remain available
across UI refreshes. Archiving stops active work, removes its active workspace,
and preserves the read-only history needed to recover its conversation and
understand what happened. Session History reads lightweight archive indexes and
shows the most recently archived session first.

The chat header shares its available width among up to three session tabs,
reserving extra room for the selected tab's Archive action. The new-session
plus is hidden when those visible slots are full and returns when a slot opens.
Save sits directly beside the session actions so the tabs retain that space.
Each tab shows a basic-info tooltip after one second of hover or keyboard focus,
including its full name, status, assistant and model when available, save state, identifier,
branch, and creation time. A touch-visible info button opens the same tooltip
without selecting or archiving the session. This uses the loaded session data
and does not fetch or poll for details.
Selecting a tab dismisses its tooltip and suppresses automatic hover/focus
opening until the pointer leaves and enters that tab again from outside. The
panel shares click suppression across its retained session toolbars; revealing
a toolbar under a stationary pointer does not reset it. Hidden toolbars dismiss
their details and cannot open pending tooltips. A new keyboard-visible focus also
reenables the tooltip, while mouse-induced focus does not; the explicit info
button still works.

Renewal creates a fresh native assistant conversation. Its review step defaults
to the current session's AI but can select another connected engine, provider,
model, or thinking option. Confirmation resolves the live choice before the old
session is stopped, then stores that canonical selection in the durable renewal
record. Successor creation and every retry read that stored value rather than
copying provider-specific metadata from the predecessor. If the predecessor's
model fails while preparing the draft, renewal presents the canonical editable
handover template so the person can still leave that provider. The fresh
provider history is the handover boundary: after it accepts the exact handover
prompt as its first turn, Vibe64 archives the predecessor and exposes the
successor even when authentication, quota, transport, or model execution
prevents an assistant reply. A failure before prompt admission, a reused
conversation, a changed source, or an unusable workspace still leaves the
predecessor available.

Repository status uses realtime changes as its primary signal and a bounded
freshness check as fallback. The fallback does no work while the page is hidden
and refreshes immediately when the person returns. Session-renewal recovery
also slows its checks when maintenance needs operator attention rather than
retrying continuously.
