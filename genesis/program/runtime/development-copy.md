# Prepare an offline development copy

An explicit host-created disposable copy keeps conversation history and native
identity while dropping execution state belonging to its original machine.

## Sources

- Main: `packages/vibe64-runtime/src/server/prepareDevelopmentCopy.js`
- `packages/vibe64-terminals/src/server/claudeConversationStorage.js`
- `packages/vibe64-terminals/src/server/sessionConversations.js`
- `packages/vibe64-terminals/src/server/assistantRouting.js`
- `packages/vibe64-colleague/src/server/conversationRecord.js`

## Public contract

`prepareVibe64DevelopmentCopy({ store, sessionId, at })` requires an isolated,
stopped destination. The host pauses native provider goals before calling it.
It removes inherited session mutation locks in that destination, prepares main and
secondary canonical conversation state through JSKIT, interrupts active saved
runs, pauses projected goals and marks running background tasks failed. It never
opens a provider, resumes a conversation or stops a parent process. Transcript
messages, native history IDs and paths remain unchanged.

Terminals owns the pure copied-Claude receipt and secondary-conversation transforms.
It also prepares scoped Claude receipt files without following directory aliases,
and stops copied routing requests while retaining uncertain delivery evidence.
Routing reconciliation records a late receipt without making a stopped request
working again. The host supplies Learning stores through their learner/pin owner.
Colleague owns its current and previous conversation transforms, pauses active or
pending watches, marks unfinished assignments as needing the user and discards
queued observations. Pending user requests remain inspectable without replay.
Summary-helper execution handles are cleared while native history IDs are retained.
These operations are explicit copy preparation, not startup repairs or state
upgrades. Unsupported state requires upgrading the parent; an unfinished provider
changeover must finish before copying. The host owns coherent file transfer,
account identity, destination isolation, retries and service startup ordering.
