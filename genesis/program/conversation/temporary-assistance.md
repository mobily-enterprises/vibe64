# Temporary AI assistance

People can open one or more clearly separate, short-lived AI tasks for focused
help without adding those exchanges to the main project conversation or
session history.

The shared HTTP route carries the project, session and saved temporary-chat
identity in one selector. The application server permits route parameters up
to 1024 characters so generated repair chats reach the same authorized route
as restored chats; saved identities and history are unchanged.

Temporary creation and preference updates expose typed Custom/Senior/Junior routing
inputs through their canonical actions; Auto remains Main-only. Colleague's
bounded results report saved chat mode, workflow, review preference and whether
a model override exists, omitting native bindings. A preference update alone
does not send a message or change Main's preferences.

A host-provided conversation appears in the tab strip only while selected.
Its host owns the entry point; ordinary chat headers and temporary-chat tabs
do not keep a permanent shortcut, including the header shown while archiving
and after the last session closes. Returning to Main chat or a temporary chat
hides the host conversation without deleting its saved history.
The workspace exposes its selected visibility to the parent so Main chat's
optional companions cannot keep targeting Main while another chat is selected.
Its selected-view interface reports readiness, Main/temporary/host selection and
manual selection changes to the host. Opening a saved temporary chat checks that
the project, session and requested selection still match after loading its list;
a delayed response cannot override a newer choice or an unmounted workspace.

Saved composer attachments use the same visible queue as new uploads. The composer
combines saved receipts with its pending upload queue, retains completed uploads
when a saved view closes, and still cancels unfinished uploads. Restored files count
against the normal attachment limit; additions and removals keep numbered text
references consistent. A confirmed send clears only its accepted receipts.

When saved AI settings need a state upgrade, restoration reports the administrator's
stop, upgrade and restart steps. It never converts old settings during a read.
Restore failures retain a readable retry action in a tonal error notice.

Before a native conversation ID exists, the same session-agent manager completes
its original access and execution-profile checks, then uses the common runtime's
server-only creation operation. The common application owner prepares the original
input and selected native facilities without opening Main or creating a placeholder.
The Codex and OpenCode drivers call their existing creation owners; Claude's same
owner allocates the UUID, acquires the entry, records the scoped profile and
persistence flag, and completes the original second save before returning. The
parent task or saved Temporary chat still records that actual identity before Start.

JSKIT assistant-core's existing `codexTurn.js` run owner executes scoped/persistent
Codex creation from authorized settings and registers results in the original maps.
It also owns start deduplication, duplicate and active-turn selection, native resume
and dispatch, native observation, paginated history projection, turn-start watchers,
active-turn steering, Send-result settlement, persistent
native Stop, ordinary scoped interruption/deletion and completion waits. The
watcher retains its original deadline before Send; completion and failed-turn
interruption use the exact native identity.
Provider-loss recovery, pending-start draining, renewal activity and explicit
close use that same state. Vibe64 retains profile and account admission,
output-limit validation, task-result parsing, checkpoints and completion
publication. Its result projection remains inside the shared completion promise,
so a rejected result follows the original interruption and retry behavior.
The existing checkpoint facility carries the temporary turn's exact outer identity.
Vibe64 retains namespace admission and Helper ownership receipts. The scoped
Codex driver calls the same run owner for acquisition, cached or persistent reads,
Start, wait, Stop and deletion. Shared native interrupt/delete commands run inside
the original admission boundary, then settle the captured watcher/map after its
release. Scoped deletion requires the original provider owner's verified runtime
exit; Vibe64 supplies its authorized execution configuration and cleanup policy.
Vibe64's scoped preparation retains authorized context, profile and permission settings,
input/output limits and observation-loss admission. Its Helper account capture stays
after native resume and before the shared watcher and Send. The run owner invokes
the existing provider and verified Helper isolation owner from that preparation;
Public supplies no executable create, resume or dispatch callback on this path.
The same run owner also restores Helper ownership before native model discovery
and account description. It preserves original provider reuse, account-acquisition
gating and the per-connection catalog cache; Vibe64 retains authorized scoped
preparation, workload deadlines and returned profile/account policy.

OpenCode uses JSKIT's extracted observer to wait for the event channel before
dispatch, propagate observation loss and await closure. Its extracted steering
operation follows the newly submitted input and restores the prior input when
native dispatch fails. Application authorization, execution-profile policy,
checkpointing, run publication and durable temporary-chat identity remain here.
Its original temporary records, native creation, model/agent selection, Start,
Steer, reads, completion waits, Stop, deletion and target draining now use the
same JSKIT shared runtime, reached directly by the common OpenCode driver.
The binding supplies exact native identity and application preparation to that
same owner. Vibe64 retains
profile and context authority, prompt and result limits, exact receipt projection
and registry publication. The shared owner performs acquisition, compares the
retained profile and opens the original native observer using those prepared
values. The shared owner records native selection before awaiting
that registry write, and attaches the original completion notices before Start
returns admission. A bounded Helper keeps its saved completion when a caller
supplies another wait timeout. Persistent Stop retains its native idle check;
ordinary Main Stop remains acknowledgement-only. Native deletion still precedes
observer retirement and registry publication. Vibe64 retains authorized target
selection, scoped Helper release and the parent's durable cleanup receipt.
An uncertain delivery is inspected by its original message identity rather than
replayed; an unreadable or absent receipt remains uncertain.

## Sources

- `src/lib/vibe64ThinkingPresentation.js`

- `packages/vibe64-terminals/src/server/assistantContracts.js`

- `packages/vibe64-core/src/server/actionContext.js`

- `packages/vibe64-core/src/server/featureRoutes.js`
- `packages/vibe64-terminals/src/server/assistantRouting.js`
- `packages/vibe64-runtime/src/server/assistantRoutingStateUpgrade.js`
- `tests/server/assistantRoutingStateUpgrade.unit.test.js`
- `src/components/studio/vibe64-session/Vibe64ChatModeControls.vue`

- `src/lib/vibe64AssistantHost.js`
- `src/components/studio/Vibe64SessionPanel.vue`

- `packages/vibe64-terminals/src/server/agent/providers/claudeConversationHost.js`

- `packages/vibe64-runtime/src/server/codexAppServerProvider.js`
- `packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js`
- `packages/vibe64-database-tools/src/server/assistant.js`
- `packages/vibe64-database-tools/src/server/databaseDialect.js`
- `packages/vibe64-database-tools/src/server/schemaAccess.js`
- `packages/vibe64-database-tools/src/server/service.js`
- `packages/vibe64-terminals/src/server/codexHelperThreadLedger.js`
- `packages/vibe64-terminals/src/server/codexScopedConversationPreparation.js`
- `packages/vibe64-terminals/src/server/codexHelperPreparation.js`
- Main: `packages/vibe64-terminals/src/server/sessionConversations.js`
