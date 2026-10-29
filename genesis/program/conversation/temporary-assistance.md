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

Each temporary chat stores its number once, at creation: one more than the
highest number among the session's open chats. Its saved title is an optional
plain name (whitespace collapsed, at most 80 characters); the browser shows it,
or "Temporary N" when it is empty. A title-only update, like a draft-only update,
saves without the assistant's write lock and publishes a session-change notice
so other open views reread the list. Chats saved before numbers were stored keep
the browser's old "Temporary N" title, which restarted at 1 on every page load;
listing treats that title as unnamed and numbers those chats by creation order
without rewriting them.

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

The header's Temporary AI control opens the session's temporary chats and starts
one only when their saved list reads as empty. With no chats loaded, it reads the
list first, so a click while the list is still loading opens the saved chats
instead of adding one. A failed read shows its error and creates nothing, and a
newer selection made during the read wins. The plus control, Fix it with AI and
Colleague's create action still start chats as before.

Listing and opening temporary chats read the assistant natively only for a chat
whose turn is starting or in progress or whose last reported goal is unfinished.
Every native read saves the goal it reports on the chat's record. A settled chat
(completed, interrupted or failed, with no open goal) answers from its saved
transcript, goal and access through the shared stored projection, so restoring
the tab strip after a reconnect, session switch or account change never starts
that chat's assistant process. The idle check after each turn still reads the
native conversation once to save its settled outcome and goal.

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
release. Scoped deletion stops only what this server runs for the scope and
requires verified exit for it. A helper thread from before a restart lived only
in that process, so its cleanup sends no native delete, starts no Codex
app-server and needs no account, tool home or workdir. Vibe64 supplies its
cleanup policy.
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
replayed; an unreadable or absent receipt remains uncertain. Only the native
owner's proof of non-admission (`not-admitted`, from Claude) makes the routed
attempt unsent: routing clears its attempt and reports `not-sent`, and a
changeover holding the same attempt settles it through its own owner. Retry
then sends it normally. Cancel is decided by the server: JSKIT's delivery cancel
aborts a running check and an unsent request, keeps the message as
Cancelling… and calls `POST …/deliveries/:messageId/cancel`, which reaches
`cancelTemporaryConversationMessage` without opening the native conversation.
The shared routing `cancelMessage` records a durable tombstone, stops that
chat's route (`stopped` and `cancelled`) and classifier, and interrupts the
chat's persistent turn when the message may own it, all without the
agent-write lock, then answers success. Discarding the retained changeover
attempt waits for the lock in the background, or for the next admission.
Snapshots, inspection (`cancelled`) and admission all honour the tombstone, so
the message never returns. A message shown only from its route joins the
delivery first, and a cancelled route never returns its text to the draft.
When the server cannot be reached the message stays with Cancel again and is
retried after reconnecting; accepted history remains. A failed delivery entry
not shown from a route was definitely never sent, even when the chat itself
never started, so `useVibe64TemporaryAi` retires it through JSKIT's delivery
`edit()` instead of a server cancel.
Accepted Claude steering retains the original input identity on partial output.
The shared scoped reader resolves native input identities against authored
messages and uses the existing transcript turn IDs when saving replies. A
follow-up cannot take ownership of the interrupted request's partial reply,
including after a cold native-history read; existing saved rows are not repaired
or rewritten by this read path.
The shared owner reports an expired health-probe deadline without stopping
Main or temporary conversations. Vibe64 records shared-process stop reasons and
session counts through its operational logger, including recovery failures,
without requiring session debug logging. Provider identity and credentials are
not included in that event.

Temporary and Main reuse `Vibe64ComposerDelivery` for Send/Steer and Stop,
extracted from Main's existing controls. Preparation, attachment ownership,
permissions and model routing remain with the existing application owners.
Temporary opts into the shared binding's serial prepared-send queue; queued
messages retain their authored payload and identity, and uncertain delivery is
inspected rather than replayed. Both transcripts use the same recorded-selection
attribution; message-level selection remains available for live scoped replies.
Changing the composer selection never rewrites historical attribution.

## Sources

- `src/components/studio/vibe64-session/Vibe64ComposerDelivery.vue`
- `src/lib/vibe64ConversationAttribution.js`

- `src/lib/vibe64ThinkingPresentation.js`

- `packages/vibe64-terminals/src/server/assistantContracts.js`

- `packages/vibe64-core/src/server/actionContext.js`

- `packages/vibe64-core/src/server/featureRoutes.js`
- `packages/vibe64-terminals/src/server/assistantRouting.js`
- `packages/vibe64-runtime/src/server/assistantRoutingStateUpgrade.js`
- `tests/server/assistantRoutingStateUpgrade.unit.test.js`
- `src/components/studio/vibe64-session/Vibe64ChatModeControls.vue`

- `src/lib/vibe64AssistantHost.js`
- `src/lib/vibe64AssistantConversation.js`
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
- `packages/vibe64-terminals/src/server/sessionAttachments.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `packages/vibe64-sessions/src/server/sessionPresence.js`
- `src/composables/useVibe64SessionTypingPresence.js`
- `packages/vibe64-terminals/src/server/opencodeServerProcess.js`
- `packages/vibe64-terminals/src/server/openCodeScopedPreparation.js`
- `packages/vibe64-terminals/src/server/agent/sessionAgentManager.js`
- `packages/vibe64-terminals/src/server/agent/providers/codexSessionAgentProvider.js`
- `packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js`
- `src/composables/useVibe64TemporaryAi.js`
- `src/composables/useVibe64MountedSessionData.js`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64TemporaryAiRepairs.js`
- `src/components/studio/Vibe64TemporaryAiFixAction.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue`
- `src/components/studio/vibe64-session/Vibe64ConversationAttachments.vue`
- `src/components/studio/vibe64-session/Vibe64EphemeralConversationMessages.vue`
- `src/components/studio/vibe64-session/Vibe64RenewalAssistantSelector.vue`
- `src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue`
- `src/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue`
- `src/composables/useVibe64AssistantCatalog.js`

## Public contract

Temporary chats share Main's delivery-state presentation. An ordinary send stays
pending. Lost confirmation shows Retry against the original message ID,
without Edit/Cancel or another native submission. Saved history and accepted
routing state clear stale delivery errors, including a late HTTP failure after
an exact receipt. Pending entries are reconciled only against actual history;
synthetic routing rows never acknowledge delivery.
Direct temporary messages can be saved before native admission. Their read-only
projection carries `receipt: false` until the exact requested native message is
confirmed; routed rows written after admission retain the normal receipt contract.
The shared delivery owner keeps that provisional row visible once, with its
pending or uncertain status. Native read failures leave Retry available.
Its explicit check retains the captured request and cannot start it again while
admission is unknown. Historical checks use the row's recorded selection and
retained native binding, without consulting another conversation for acceptance.
The qualifier never enters saved history, routing metadata, prompt history or
message fingerprints. The original logical record remains authoritative. Its
canonical server facade and Temporary browser use the common read, subscription
and delivery operations. Each task acquires the supplied retained binding with
its existing logical ID; it has no second delivery record or private reader.

Session and temporary-conversation actions resolve their project and acting user
through the shared action boundary. The acting user is trusted context, never
an action argument. HTTP URL selection and explicit action selection must agree;
automation enters the same project context as HTTP. Hosts recheck authentication
and project access before each execution. Ordinary product handlers must invoke
their owning action; custom transports may retain their transport adapter.


Temporary Codex, Claude Code and OpenCode conversations load the same Genesis
project hooks or plugin as main chat and standalone CLI use. The host bridge
binds each native ID to temporary-conversation context before its first turn or
resume. This does not enable Auto or review in temporary chats.

Ordinary persistent temporary chats offer Custom, Senior and Junior through
the same compact role icon as main chat. Auto, plan approval and automatic
review are unavailable in temporary chats, including through direct API calls
and pending handoff retries. Owners can open the shared Models overlay directly
from its menu. The role selector comes first; Custom opens the shared model dialog. Each keeps its own selection, routing
preferences, pending request and retained native conversations. Creating an ordinary
draft copies Main's current role and custom model override; a team member's
starts on Fix it with AI. Auto maps to Senior, with review off. A Main chat without routing preferences passes its
exact AI as a Senior override. New chats resolve access for the submitting actor
through the ordinary purpose resolver; inherited choices do not grant new access.
Existing temporary chats keep their own role and model choices after Main changes
or the view reloads. The compact role selector can change each chat independently.
There is no workspace default or reset-to-default action. App-generated
implementation drafts select Junior with review off; Update merge repairs always
select Senior. Background helpers keep their assigned roles. Direct roles use
the conversation and user request; unrelated requests leave saved plans unchanged
and do not trigger an automatic reviewer. Merge repairs retain their instructions
and Senior role, but offer Choose model through the same picker. An explicit
selection saves a Senior override with its selected orchestrator. Reply labels show the role
first, followed by the orchestrator and model, as in main chat.
The authenticated actor supplied by the HTTP turn action is captured with the
routing request, so retries and reconciliation retain the submitting user's
access even when an owner reads the conversation.
The shared routing coordinator uses the temporary conversation's existing write
lock and transcript; it does not write main-chat history or alter its selection.
Native conversation IDs are scoped to that temporary chat. A fresh repair can
start even when the main chat retains Codex history in an older provider home;
neither chat's existing history is moved or converted. A chat with its own
unsupported history reports the required action as a conflict, not a server error.
Settings-only updates use their existing settings lock; payloads combining
settings with attachments or repair fields retain the source-write coordinator.
The saved-record mutation computes its patch from current state and releases the
storage lease before publishing, so subscriber initialization cannot block an
independent plain draft save.

Creation and reading release that lock before looking up mode availability.
Slow provider catalogue reads therefore do not block sibling Router updates or
draft saves; native admission and transcript reconciliation remain serialized.
Connected Codex history reads reuse their existing native observer. They do not
rebuild the execution environment; Send and reconnection still prepare it.
The existing filesystem lock admits local waiters in arrival order, so repeated
reads cannot overtake a pending routing update or cancellation. Wait timeouts
still apply, and filesystem ownership continues to protect separate processes.
Realtime routing updates use the supplied reader's existing in-flight request
and one queued latest read. A replaced turn is observed after the older read
settles; closed views and changed actors still discard the obsolete response.
Native idle events and read-time reconciliation finish the admitted turn without
starting another model. Closing or stopping a chat cancels pending delivery and
cleans up retained helpers. Service shutdown drains pending delivery before
closing native providers. Errors remain attached to the request; temporary chats
have no plan approval or review controls.
When routing stops before delivery, the local prompt returns to the composer;
its next explicit Send uses a new message ID. Newer draft text and attachments
are retained, and a clean cancellation does not appear as a failed message.
The composer owns only unsent user text. Generated repair requests go directly
to the existing delivery record, which retains the full prompt separately from
its displayed bubble. Failure leaves that request available through Retry/Edit;
it does not copy the prompt back into the composer. Retry resends the saved
payload and identity without reading or clearing the draft, including after
reload. Edit explicitly places the visible request text into the composer,
before the draft unless the draft already starts with it, by the same rule as
Main chat and JSKIT's delivery edit; a cancelled routed request returns the same
way.
Dedicated merge repairs keep their own instructions. Their mode menu exposes
Senior and Choose model; Junior and Auto cannot be selected. Stop an active or
pending repair before changing its model. Existing idle repair records receive
Senior policy for new requests without rewriting saved preferences on read.
Old non-Senior pending requests cannot resume; cancel and resend them. An older
running non-Senior turn must be stopped before another request. Native history,
repair context and verification remain owned by the existing conversation.

Each ordinary temporary chat reads availability from the same central resolver as
Send, using its own mode and custom override. Its menu labels the user's
effective destination and thinking choice, rather than using the main chat's last
model or an account-wide preview. Mode changes return refreshed decisions without
inference. Selecting another role clears a custom override. Explicit model/thinking edits update that mode's
saved override; their availability is validated against the current catalogue. Senior and Junior
overrides must both run in the main AI's tool, never as a split-orchestrator pair. Configuration and connection changes refresh existing chats' decisions
without replacing unsent drafts or switching away from Main chat or the selected
temporary chat. Initial restoration loads saved chats without selecting them;
reload keeps Main chat visible until a person explicitly opens Temporary AI.
Only account and connection events reload the
collection; unrelated progress events do not. Refreshes during a pending read
share that wait, then the latest refresh reads one fresh snapshot. Actor changes
clear the old view and reload it;
late responses from that view cannot alter the newly loaded chat with the same ID.
Opening this workspace and restoring its history do not require access to the
main chat's last model. An active turn reports its separate native steering
permission; a collaborator may be unable to steer that turn while still having a
shared route for the next request.

A turn whose selection runs in another orchestrator uses the same changeover
preparation and Send owner as Main chat, scoped to this chat's metadata and visible transcript. The
previous native conversation is stopped and retained before selection changes;
a failed stop leaves that selection unchanged. Returning resumes the recorded
native conversation and sends missed or corrected visible messages with the
ordinary authored request. No separate handover inference is added. Each retained
binding stores its native ID, exact selection, settings and last message/run IDs.
Codex routing accepts only its current shared native binding. A request to use
Codex rejects unsupported retained bindings before stopping the current assistant,
changing its selection or rewriting its home, including after an intervening
foreign-engine turn. The error asks the user to start a new temporary chat and
keeps the existing history intact; no binding conversion or adoption is attempted.
The manager keys temporary bindings separately from Main chat while providers
continue to receive the real project session and exact native conversation ID.
Close verifies stop and deletion for every visited binding, saving each successful
removal. During routing it waits for a late native start and helper cleanup before
removing the chat. Failed helper cleanup retains the parent record for another
Close; Renew and Archive also retain sessions that still own helper cleanup.
A failed later deletion remains retryable without repeating earlier
successful deletions. Scoped receipt checks recover uncertain native admission,
including while the accepted turn is still active.

Each temporary task has its own model settings, attachments and message stream.
DeepSeek and GLM under Codex or Claude preview their latest short commentary as
thinking. Expanding progress shows those short updates only; raw reasoning is
omitted and final answers remain separate replies. This uses recorded selections
and the same presentation mapping as Main chat without rewriting saved history.
User-facing temporary chats have the same capabilities, tools and project access
as main chat in Codex, Claude Code, and OpenCode. They use normal execution settings and
the same session write coordination and skill preparation. There is no temporary
permission mode or R/O–R/W toggle. Preview screenshots and console/network
diagnostics attach to the selected conversation through the normal upload path.
After the original coordinator has saved a native conversation ID, its admitted
Send, read, wait, Stop and delete operations acquire the same JSKIT scoped native
handle used by the existing provider. That handle keeps the real parent session,
temporary routing context and native identity; it does not create a Helper scope
or a second state record. Explicit Close still owns native deletion, while runtime
shutdown preserves durable native history. JSKIT's existing scoped owner now
performs the original persistent read/reconciliation, duplicate and active-steering
decisions, demand creation, Start and exact native receipt inspection. These
operations run inside the existing application write lease and use its actual
transcript, stream and admitted session-agent operations. They create no copied
state, additional queue or delivery journal. Direct provisional rows remain
unconfirmed until exact native admission; routing policy still writes its receipt
after admission. A failed native read cannot prove acceptance or trigger replay.
Vibe64 retains discovery, draft saves, Router and repair policy, authorized model
and skill preparation, attachment/receipt content, record layout and explicit
Close policy, routing-helper cleanup, attachments and logical-record deletion.
The shared persistent owner also performs the original idle/Stop/retain sequence
before engine changeover, canonical receipt recovery through the existing
continuity owner, and Stop/delete over retained native histories. Each successful
history retirement is saved before proceeding; failures retain the same retryable
closing record. Native and routing contexts keep their original stores and
write-lease order, without a second journal. The same sessions-owned AssistantFeature now accepts
the project/session/logical-chat selector. Its common runtime handle delegates
Send, Stop and selection to the original authorized actions; read and delivery
inspection use the original logical write owner. It creates no native thread or
runtime metadata on open. Its native segment stays absent until the original
coordinator has saved the actual native ID.

Codex's existing scoped subscription, Claude's normalized message callback and
OpenCode's existing completion observer publish into the same scoped stream
owner. Original transcript reconciliation publishes the saved turns and retires
their exact live identities. No additional native observer or per-delta read is
installed. Each shared subscription rechecks project access before forwarding.
Closing this presentation handle preserves the saved chat and its native work;
only the original explicit Close performs destructive cleanup. The Temporary
Vue consumer acquires the same supplied binding dynamically for each task.
Subscription starts only after its original Create saves the requested logical
ID. Hidden mounted tasks retain that reader; removal, actor changes and unmount
release it without stopping native work. The application keeps collection,
Create, settings/draft PATCH and explicit Close policy. The shared prepared Send
registers its optimistic entry before the original save/Create sequence and owns
the sole canonical HTTP request, abort handle, receipt and uncertainty state.
Only conversation persistence and cleanup differ. The server stores each chat's
identity, settings, draft and repair state below its session's `conversations/`
directory. Each chat uses the existing JSKIT transcript policy with a separate
filesystem scope and a persisted native provider conversation. Codex user-facing
chats are not native ephemeral threads. They never appear in main History.
When reconciling native messages, the accepted request's recorded selection and
mode supply metadata for new transcript blocks, including progress and later
assistant replies after an initial message. If no request receipt is available,
the retained temporary selection supplies the identity. Existing block metadata
is preserved; this does not relabel historical messages or inherit Main's model.
The collection GET restores open chats; POST creates an idempotently named draft;
PATCH saves presentation and settings. Draft and attachment saves omit model
settings; only explicit model/thinking edits submit them. This prevents a stale
pre-routing selection from becoming an override or blocking an Auto draft save.
Acknowledging an older settings save retains a newer pending edit. First Send
creates the native conversation under the session write coordinator. Accepted
message identities prevent a retry
from sending the same work again. Native history reconciles replies completed
while the browser was absent; incomplete replies remain visible as they arrive.
Temporary conversation requests wait briefly for that coordinator instead of
failing immediately on contention. A still-busy draft save retries automatically;
a later successful save clears the earlier save error. Restoration starts when
the session is available, independently of the main model's connection. It reads
current readiness on mount and watches later changes; scoped native read errors
remain attached to the affected conversation. Restoration has no separate
socket-connect handler. Assistant-operation contention still retries without
opening an empty temporary workspace or showing an error. Losing readiness cancels restoration
retries and invalidates pending responses; recovery restores again. Changing
sessions or unmounting also retires pending restoration. Genuine restoration
failures retain the explicit retry action.
Feature routes wait for response delivery, including asynchronous response hooks,
so error codes and messages reach the client instead of an empty response.
Typing presence reuses the session presence endpoint, realtime event, debounce,
and expiry with the saved conversation ID as an additional scope. Actual input
is coalesced into at most one update per five seconds, with no autonomous heartbeat
or overlapping requests. Requests have a five-second deadline.
The server takes the actor from authentication, reads only session status and
checks the saved chat record. It never loads agent runs, background tasks, chat
history or a provider for presence. State remains bounded and in memory. Main chat and other temporary chats ignore its typing events.
The shared composer status displays the person's name, or a count for several
people, without receiving draft text through presence. Blur, Send, switching
chats, hiding the workspace and disposal cancel pending updates without requests.
Remote indicators expire within ten seconds; reconnect sends no typing request. This indicator does not lock or
merge simultaneous draft edits.
Switching sessions preserves each session's selected temporary chat and draft.
Switching sessions or removing the view sends draft, attachment, settings and
repair-field edits still waiting for their save, including one queued behind an
unfinished save; their responses are not applied to the departed view.
Main and temporary chat views read a saved routing request through the shared
runtime reader and show an unreadable value as none; server guards use the
strict reader and refuse to act on it.
While mounted, each task tracks unread assistant text in browser-local state.
New or streamed reply text received outside the active visible conversation
marks that task's tab, the expanded incognito button and the compact session
actions trigger/menu entry. Viewing a task clears only its own indicator;
opening the actions menu does not mark messages read. Unchanged snapshots, user
messages and reasoning-only updates do not create unread replies. The compact
trigger preserves independent renewal attention after unread replies clear.
Restored history starts as a baseline rather than announcing old replies.
Reloading or removing the project view stops only its local readers. It sends no
Stop or Delete request. Late responses cannot restart a retired reader or report
an obsolete repair result. Server startup restores discovery and finishes recorded
Close attempts. Work discovered without its original backend observer is stopped;
restoration does not send or resume a turn. Active temporary work and Codex goals
also prevent dormant-project cleanup, just like main chat. Claude counts only a
temporary turn its server is running; one saved as active before a restart ended
with that server and does not keep the project open.
Explicit Close is one server operation: retain the closing record, pause any goal,
confirm native work stopped, delete the native conversation, remove its owned
attachments, then delete the record and transcript. A failure retains the record
and offers the same Close again, including after reload. File edits remain.
After the cleared stream is published, Close retires that chat's open entry in
the shared conversation runtime (`retireOpenConversation`), so its old handles
close. Archive retires every temporary chat entry of the session the same way,
after the Main session closes, while keeping the saved records.
For Claude, the retained JSKIT conversation owner coordinates verified Stop and
active native-transcript deletion, then awaits Vibe64's saved metadata and scoped
receipt removal before retiring the entry. The original deletion guard and
application receipt storage remain in Vibe64; archival history retirement
remains a separate preservation workflow.
After deletion succeeds, the session realtime event identifies the closed
conversation. Other browsers remove only that project's matching session tab,
cancel its pending saves, release its reader, and ignore late responses that would restore
it. Reconnection reconciles the saved collection to recover missed closures while
preserving new local drafts. A closed-conversation API error also removes the
stale tab; Send never recreates a chat closed by another browser.
Creation publishes `temporary-conversation-created` once, when the chat is first
saved. Other views that do not already show it reread the saved collection, and
every view rereads it when its realtime connection returns, so a chat created
while a view was disconnected also appears.
Closing an incomplete Update repair requires confirmation that partial edits
will remain and may still need repair. Closing waits for Stop and provider
deletion to succeed; a failure leaves the chat available for retry, and a failed
Stop leaves the existing live reader active. Update verification must finish before its repair can be closed. A Close during
conversation creation waits for creation and prevents a pending Send. Stop does not reset source files, HEAD, or the
index, and a late response cannot turn a cancelled repair into an automatic
Update. Partial application edits remain subject to review; cancellation does
not claim the application is repaired.
Stop errors appear above the composer and Close errors inside the confirmation,
so a notification cannot cover the retry control. Visible repair results do not
also raise a duplicate toast; background completion still notifies the person.
An unavailable progress read keeps the draft and Stop available. Subsequent
native events and reconnects invalidate the same supplied reader; there is no
private polling loop. A read failure does not report completion, erase the
durable chat or send another turn. Confirmed native state and the original
admission policy govern the next Send.
Task attachments use the shared upload queue, text references and preview/download
dialog. The shared attachment service retains sent and saved draft files under
an explicit conversation owner. Closing removes only that owner's files and
uploads; it cannot delete main-chat attachments. Restored draft attachments appear
beside the composer and can be removed before Send. Both adapters receive trusted
file descriptors from the same attachment service.
Assistant replies use the same formatted text presentation as normal chat,
including lists, bold text, code, and links. User-authored text stays literal.
Raw HTML remains text, and executable or data-URL links are not made clickable.
Main and temporary chats use the same JSKIT conversation element, transcript,
composer and collapsible progress components. Their supplied bindings own
pending entries, failed delivery and receipt matching. The shared prepared-submit
binding chooses Send or Steer from the application's native-working eligibility,
checks uncertain receipts without resending, and removes only accepted composer
attachments. Router admission and repair payloads remain application policy.
Temporary Send inserts its user bubble before waiting for a draft save,
conversation creation or native admission. The shared element overlays that entry
on canonical history and replaces it once by message identity. Resend keeps the
original message ID, text, settings and attachment IDs, while preserving a newer
draft and unsent files; their presentation is saved after retry acceptance. Edit
and Cancel act on the failed entry. The application retains request admission,
repair context, attachment ownership and task lifetime checks.
Each temporary task retains its
server-owned draft, attachments, settings and provider cleanup. Temporary
progress starts collapsed inside its assistant message; expanding it uses the
scrollable transcript. The fixed status above the composer uses normal chat's
shared plain status component and says “Sending to assistant…” during admission,
then “AI is working…” during execution. The transcript has no
second working indicator and the status never repeats reasoning paragraphs.
Long progress cannot push Stop or the composer out of view. The temporary
workspace leaves the project session tabs and shared Save/Update activity
available above it. Main chat stays outside the horizontally scrolling temporary
tabs, so selecting or scrolling a task cannot cover the Main chat control.
Main chat aligns with the other tab buttons above their horizontal scrollbar.
Activity notices have a bounded height, and the temporary composer keeps its
buttons visible while long drafts scroll within the input. Repair details start
collapsed. The open Update repair replaces the duplicate repository error panel.
During reconnection the shared connection notice takes precedence over the repair
status and matching connection error; drafts stay editable and Send waits for
the connection. A failed generated repair request shows its concise description
in the composer while retaining the full request and message identity for retry.

Every product-owned repair entry, including project setup warnings, uses the
shared Fix it with AI control and temporary-task sender. It opens, selects, and
focuses a separate Temporary AI task immediately, even while the main assistant
is working. These entries and subsystem generation check the viewer's effective
Junior access, independently of the main chat's mode or personal connection,
except Update merge-repair entries, which check Senior access.
Onboarding's create, inspect and adoption actions use that same
temporary-chat path. Each onboarding request opens a fresh chat. The task
shows a concise user-facing repair request and a compact status heading while
the AI works. Completion and verification results appear after the task stops.
Detailed diagnostics remain in the AI request without overwhelming the visible
user message.

A product-owned recovery action may remember the exact temporary task it
started and observe that task's terminal result. Workspace preparation uses
this narrow handoff: after an accepted repair turn completes or fails, Vibe64
reruns its own safe deterministic preparation operation because a provider
timeout may arrive after useful edits were made. An unrelated, still-active,
or deliberately interrupted task does nothing. Temporary AI can edit or
explain, but it never declares the managed operation successful; the managed
operation's own result remains authoritative and visible.
When that deterministic check succeeds, its verified result becomes the task's
headline even if the AI provider timed out after making useful edits. The
provider timeout remains visible as secondary audit detail instead of leaving
the user with a false failure conclusion.

An Update repair that explicitly reports completion triggers Vibe64's existing
Update operation. The repair chat shows “Checking Update…” while that operation
runs and blocks new AI edits until it settles. Only a successful Update shows
“Session updated”. Repair prompts define completion as file edits ready for
Vibe64 verification, not an AI-owned Git operation, and reserve continue results
for actual user decisions. A failed conflict check supplies its latest diagnostic
to the same conversation. It permits at most three automatic follow-ups and
pauses when the same canonical version and conflict diagnostic recur. A pending
reply or attachment, Stop, departure, or active repository work
prevents automatic follow-up. Provider/admission failures stay visible for manual
retry rather than looping. Questions, interrupted or failed turns, stale session
completions, and duplicate completion notifications do not automatically run
Update.

The selected chat's saved transcript is projected without provider observation
when source coordination is busy; its snapshot explicitly defers reconciliation.
Every status change is saved before it is announced, so each view applies the
saved status from such a snapshot exactly as from a reconciled one. A routing
notice marks a view working only while its request is delivering or running, and
adopts that request's ID unless the view's own Send is still being delivered; a
failed or uncertain Send never fences another view's request. The send fence
holds only a request that the saved transcript has not yet followed with a later
one. While a turn runs, each completed native message marks its chat for saving.
One coalesced write per session saves every marked chat after a short delay, so
a session's chats never compete with each other for the lease, and output
completed during that write is saved by one more write after it. The write
does not wait: when the lease is busy the marks stay for the next completed
message. The idle completion, the last server work for a finished turn, retries a
busy source lease for both its transcript save and its routing completion and
logs a failure instead of silently leaving the turn in progress. Every view
showing a reply therefore settles on the same finished state, whichever view
sent it.
Plain draft-only writes use the short session-store mutation and a durable draft
revision, so admission of an older message cannot clear newer typing or files.
The Update request identity is recorded on the existing background task. The
repair view compares that identity and status after reconnect or reload rather
than interpreting a lost response as completion or starting another Update.

The compact repair status and Check Update action remain outside the scrolling
transcript. Check Update deliberately verifies an idle repair, including one
whose AI returned a continue result. The header's Update action uses that same
check when an unresolved repair exists. Explicit checks pass no conflict review
ID, even after an AI-complete result. Review resolved conflicts opens the same
file-list acknowledgement available on the session's Update error. The person
may confirm after any idle repair outcome or work done elsewhere; the current
saved conflict ID is used, not an older AI run's ID. The existing result reporter
updates that chat after a manual acknowledgement without requesting more AI work.
Repair launchers reuse the session's
existing unresolved Update task even when diagnostics change, preserving unsent
replies and attachments. Verification diagnostics remain available to subsequent
turns instead of being cleared by a follow-up question. Save repairs do not
automatically publish work, and Update itself never publishes.

Interactive Codex temporary turns have no fixed completion deadline. They remain
observable until completion, Stop, deletion, or loss/replacement of the shared
provider connection. Short helper turns retain their bounded deadlines.

OpenCode temporary Start returns the accepted turn immediately, keeping Stop
available while the same JSKIT native owner observes completion. Conversation reads
retain working or failed state for that turn. Stop requires provider confirmation
within five seconds; a refusal or timeout leaves the turn available for retry.
A confirmed Stop cancels only that conversation's pending reads. Deleting a
conversation retires only its observer; provider shutdown drains all observers
using that provider.
Scoped helper cleanup removes its native conversation and environment entry,
while the existing project runtime retains the shared OpenCode service for the
next helper. Project closure, runtime invalidation and server shutdown still
stop that service. Each new request rechecks its selected connection and access.

Temporary and lightweight helper conversations use the parent session's
selected Codex or OpenCode service, but they do not start or retain a second
resident assistant service. A user-visible temporary conversation receives one
stable Genesis and Vibe64 context with main chat's project capabilities,
while ordinary human turns contain only the person's authored text. Update
repair follow-ups additionally carry the latest Vibe64 verification diagnostic;
the visible bubble keeps the person's text or a concise automatic retry label.
It keeps the
session directory and normal command boundary. Ordinary temporary replies have
no forced result schema. Update repair explicitly requests its structured
completion result for verification; this format does not change permissions.

The bounded native output-schema validator originally owned by
`codexAppServerSessionBridge.js` now lives in JSKIT assistant-core's
`conversation/structuredOutput.js`. The Public bridge retains Helper profile
and error policy. OpenCode's original `openCodeDetachedPrompt` and
`openCodeStructuredOutput` now live in the shared `conversation/openCodeTurn.js`
owner, used by both the Public terminal and common native driver. Claude and
Codex forward the validated schema through their existing native turn settings;
the direct-API engine rejects that unsupported configuration before inference.

The temporary composer remains editable during work. Steer sends guidance to
its current native conversation and keeps Stop available. The server retains
that chat's current model and skips source/skill preparation during steering.
Codex uses the exact active thread/turn; Claude uses its existing native
interrupt-and-continue path; OpenCode uses native steering while the same
observer follows the latest prompt. Late reads cannot overwrite a newer send,
and failed steering does not imply that the original work stopped.

A composing host can inject one optional conversation descriptor through
`VIBE64_HOST_CONVERSATION_KEY`. Its label, theme colour and component appear in
the existing temporary workspace beside Main and temporary tabs. Main and task
selection leave that host view without closing its conversation. The host owns
its state and capabilities; public Vibe64 knows no host-specific repair actions.
The same view is reachable when the project has no session.

The terminal service also exposes one generic non-project ephemeral
conversation seam for a composing host. Its exact scope supplies a private
absolute working directory, private runtime root, empty or explicitly bounded
environment, provider binding id, and one bounded host-authored stable context.
It requires an explicit admitted provider/model selection but requires no
project, session, worktree, History, or Genesis project conversation kind.
The host can opt into native persistent retention without relaxing this scope;
its own storage still owns discovery, transcript and explicit clearing.
Persistent interactive waits have no default turn deadline. Native completion,
Stop and connection loss settle the wait; an explicit deadline or a bounded
Helper execution profile still limits the turn.
Codex runs that scope read-only with dynamic tools and inherited facilities
disabled; OpenCode retains its native tool definitions with approval required,
and the session plugin rejects every host-conversation tool call before native
execution. The guard also refuses unregistered conversations and applies through
verified native ancestry. Without that plugin, the host agent remains deny-all.
This preserves Zen's native request format without granting shell, filesystem,
network, or subagent execution. Stop, read, wait, deletion,
provider cleanup, and unchanged authored turns reuse the ordinary provider
lifecycle. Codex deletion detaches the exact thread/provider from a shared
process or requires verified exit when that runtime is no longer shared; it
retains the exact binding for retry when exit cannot be proven. The shared
ephemeral message presentation and parameterized model selector let a composing
product present that lifecycle without changing Temporary AI's project-writing
contract.

Router now uses the generic non-project seam with its existing bounded workload.
Scoped Codex, Claude and OpenCode profiles use the exact resolved model; profile
provenance covers scope, actor, connection and destination and cannot be restored
as inference authority from a saved JSON snapshot. Input/output limits, deadlines
and tool restrictions remain provider-enforced. Lifecycle operations carry the
same scope and provider settings, without the parent session's runtime or binding.
Codex wait retains the original deadline and interrupts the exact turn on timeout.
A bounded Codex Helper also retains its admitted native account signature until
completion. Public validates that same signature before exposing the result;
a same-account credential refresh remains valid. The shared run owner keeps the
Helper busy during validation, and a late check cannot revive a stopped turn.
The parent retains its original cleanup receipt and retry ownership.
OpenCode wait retains bounded-output validation even with an explicit timeout.
Claude applies the helper's output limit to answer text and structured results;
reasoning keeps the normal block-size limit instead of consuming that allowance.
Router refuses interrupted or failed helper results before parsing a decision,
preserving the provider's error and cleaning up without dispatching the request.
Claude reports its managed execution ID before inference so the parent request
can retain it for restart cleanup. Cleanup uses the captured native reference and
must verify stop; it does not authorize another inference. Cancellation before
native thread creation also releases any catalogue runtime owned by that scope.
The same JSKIT runtime owns the original bounded helper coordinator through
`runScopedTurn`. The manager supplies its existing admitted operations and keeps
the required live-profile validation and audit snapshot. The shared coordinator
awaits the parent's native-identity event before starting. Abort during startup
stops the late native turn; abort while waiting stops that same scoped turn,
retaining Stop-failure precedence over an earlier wait or abort error.
Scoped Codex, Claude and OpenCode Send, read, wait, Stop and explicit deletion
enter the same JSKIT conversation runtime through its native representation.
Each native driver invokes its existing shared owner: Codex's run owner,
Claude's conversation owner, or OpenCode's shared runtime. Application bindings
supply the authorized scope, native identity and original preparation; they open
no main session store, copied transcript or additional delivery journal. Before a native
ID exists, the shared coordinator invokes the same admitted creation operation
and awaits the parent's thread receipt; it creates no placeholder identity or
second runtime. Repeated responses reuse the supplied native conversation ID and
return the actual new turn ID. Native wait keeps the exact run and original deadline. A failed
delete or provider-exit proof retains the common handle and the feature receipt
for retry. Runtime shutdown releases the original scope's provider resources;
it does not clear the feature's durable cleanup reference or delete its paths.
OpenCode's private scoped preparation retains the guarded profile, authorized
context, original input/output/deadline bounds, historical message identities
and product publication. Its lazy cleanup descriptor is read only after
successful native deletion; the same shared runtime owns lifecycle and reuse.
Claude's original authorized entry acquisition supplies the same retained entry
to its shared owner for each operation. Session close still drains those entries
and closes its terminals before an explicitly requested cached-binding release.
After restart, its parent's captured managed-execution receipt still drives verified Stop
before native history or the retained scoped record is removed.
Save naming and suggestions resolve the actor's effective Quick helper, and source
explanations and database help its Explain & check, through this seam. Each feature retains its own durable helper-cleanup
references, exact destination and connection identity; the last main-chat model
does not determine helper access.

Prompt suggestions, commit subjects, database help, and source explanations
use the bounded low-cost execution profile in a private non-project workspace.
Their complete task prompt is their only model context: they receive neither
Genesis project context nor Vibe64 driver output. Codex helper admission is
bound to the shared service's Vibe64 login identity. Its fingerprint remains
stable across native token refreshes and server restarts, including when native
ChatGPT tokens omit the OpenAI account ID. A new Vibe64 sign-in replaces that
local identity, so it cannot reuse earlier helper ownership. Isolated runtimes
that explicitly transfer authentication still require the actual OpenAI account
ID and never substitute the local login ID. OpenCode tasks
use the same model-advertised response-limit policy as the main conversation,
and any narrower task-specific limit remains authoritative.

The shared Codex Helper owner restores durable ownership only while its exact
managed runtime and provider context remain current. If the runtime has disappeared,
it atomically retires the stale ownership. If the provider context changed under
the same account, it first verifies retirement of the earlier runtime and then
retires the ownership, allowing a fresh bounded helper instead of reporting a
false account conflict. A real account change cannot adopt or delete the earlier
account's threads. Cleanup-required records can be retired through the local
runtime owner: it verifies shutdown of that account's process, or verifies that
a replacement was already installed after shutdown. It never stops a replacement
for stale cleanup. The existing background-task history records retirement and
cleanup failures; unverified records remain for retry on the next reconciliation.
Each reconciliation reports one result per session: any remaining failure keeps
the cleanup status failed, even when other records were successfully retired.
Prompt-hint cancellation awaits interruption before attempting thread deletion.
The runtime owner notifies the waiting task only after verified retirement and
durable ownership removal. The task uses that acknowledgement for its exact
thread instead of interrupting or deleting it again. Failed retirement retains
ownership and remains reportable and retryable through the same runtime owner.

The original native Helper interruption, thread deletion and invalid-request
read-back proof live in JSKIT assistant-core's `codexProvider.js`. Its shared
Helper lifecycle writes cleanup-required ownership before invoking that operation
and removes the durable receipt only after success. It also owns native cleanup
coalescing and provider retirement. Native conversation commands call that same
Helper owner directly at the original control-inspection point; a returned
retirement promise still releases application admission before settling. Vibe64
retains account/profile authorization, authorized storage locations, application
cleanup policy and retry/error presentation. Scoped preparation supplies its
existing verified isolation owner once for compatibility checks and execution.

The original detached Codex turn watcher, immediate status handling, provider
failure detail grace and completion wait belong to JSKIT's existing run owner.
Its conversation commands project the native thread ID after ordinary or Helper
acquisition. The same Helper owner retains the pending-start map and awaited
ACTIVE receipt: dispatch failure retires the Helper before releasing that map
entry, while successful dispatch releases it before waiting for completion.
Account rechecks and the READY receipt also belong to that owner. The original
server-only detached run/stream facades use one lazy operation on that same common
runtime and native owners, without opening Main or writing a canonical transcript.
The manager retains fresh access and trusted profile resolution. No-profile calls
retain the Main writer lease for the complete turn; profile calls retain their
separate admission. Codex/OpenCode emit the original audit before dispatch without
awaiting it; Claude acquires its entry before awaiting the audit and starting work.
Admitted context remains separate from each engine's original native options.
Vibe64 supplies Codex's ordinary and Helper preparation, output bounds and contextual
errors; shared owners retain watcher, account rechecks and Helper lifecycle.
Current bounded tasks also use the unchanged scoped runtime. Saved Helper receipts
keep their existing interrupt/delete cleanup.

Database Copilot begins with bounded database identity and object counts, plus
the exact selected table attached to each user question. The current selection
must exist in the refreshed schema; historical messages retain their original
table context. The UI shows the current context above the composer. “This table”
uses the question’s captured selection and the existing bounded schema lookup.
Changing selection during a request cannot retarget it or replace another
table’s visible query result.
Its temporary helper can search the refreshed schema, list object names and
kinds, and request complete SQL-relevant definitions for a bounded set of
matches before proposing a query. Truncation is explicit and another search is
available; credentials never enter the helper conversation. PostgreSQL and
MySQL or MariaDB implement one server dialect contract for connection,
inspection, SQL policy, read-only execution, and result interpretation, while
the assistant consumes only the normalized schema contract. Any requested
query runs only through the session's read-only database identity.


Temporary chat uses the shared model chooser for its native model and thinking
parameters. Selections remain local until Apply, matching the main chat control;
changing them preserves the prompt draft. The chooser uses the same live
catalogue as main chat, scoped to the session's current engine and connected
model provider. Only available models and their advertised thinking variants
are selectable. New chats start with the main selection; each chat then keeps
its own model and thinking settings. Before a new turn, the server resolves
those settings through the existing catalogue validator and passes that
selection to the native temporary conversation without changing main metadata.
OpenCode applies the selection only to the temporary native session; its shared
process retains the main session's configuration. Catalogue failures are shown
with Retry, and unavailable selections cannot be applied or executed.
An unfinished native goal retains its orchestrator and suppresses automatic
review; settings remain editable for subsequent turns. Its observed goal reaches the mode menu through restoration,
canonical reads and live updates; an omitted goal in a failed read cannot clear
an earlier observation.
Native completion first saves the final reply through the ordinary snapshot
owner. Review then checks the saved reply for the composer's structured questions;
an unanswered question retains the coding model and waits for the user's answer.
Settings saves retain current access and catalogue validation. An unavailable
native goal does not disable preference saves or clear its existing pin. Native
settings updates require an observed goal and preserve its objective and progress.

Bounded tasks use the central resolver's exact destination. Their provider
profiles validate that model and enforce workload limits without choosing an
implicit fallback. The profile
retains the model for that task. Codex requires low thinking; Claude validates
low effort when the model exposes effort controls. Claude's tool-free process
uses the selected account's private home without the project's command
environment, Genesis prompt or driver. Routing changes affect new tasks.

Bounded operations use the `helper` execution profile and the model and thinking
of their purpose's role: Explain & check for source explanations, database help
and lesson reviews, Quick helper for titles, commit subjects, prompt hints and
summaries; Auto classification uses Router's separate assignment. The
profile constrains tools, environment access, output and time, not model selection.

Custom is the first mode in ordinary temporary chats and opens the same
Orchestrator → Model → Thinking dialog as Main. Apply validates the exact
selection and stores it in this conversation's routing preferences. The next
send uses the existing native changeover and conversation handoff, leaving Main
untouched. Active goals retain their orchestrator while accepting future-turn
model settings. Merge repair keeps its picker available during work while
retaining Senior and its repair instructions.
Custom never silently substitutes another model; a selection the person cannot
access is refused.

Temporary conversation reads optionally accept a stable message cursor and a
bounded count, return messages in chronological order, and report whether earlier
messages exist. An unknown cursor reports a conflict instead of silently reading
another page. Normal reads retain the complete UI transcript. The assistant tool
projection returns bounded text and explicit truncation flags, never native
provider bindings or attachment records. A read failure cannot establish that
agent work stopped.

Managed OpenCode Helper turns preserve the same native tool definitions as
ordinary requests. The existing execution plugin enforces
the conversation’s actual access when a tool is called; a classification task
does not gain coding access merely because definitions are present. Without
the plugin and its trusted session registry, the Helper remains denied. Routing
therefore admits a connected OpenCode model for Router, Explain & check and Quick
helper as well as chat. Vibe64 offers no account-free model: OpenCode Zen's free Big Pickle is
never offered, so without a connected AI these background workloads are not
admitted.

Temporary chat uses the same chronological transcript rendering as Main. Saved
authored rows and native streamed replies interleave by their message times,
including user steering inside one native turn. Rendering preserves the original
turn identities, metadata and stored history.

## Optional recent Main context

The existing creation dialog remembers whether it was opened without a selected
temporary or host conversation. Cancel and dialog dismissal then use the normal
Main-selection event, even if saved chats finish restoring while the dialog is
open. Otherwise the selected conversation and draft remain untouched. Cancellation
never creates a record or sends a turn.

The ordinary New temporary AI task control offers an unchecked context-copy
option. Creation captures at most forty canonical visible user, assistant and
commentary messages from the authorized session's Main transcript, bounded to
64 KiB of text, without attachment payloads or reasoning. The shared goal-message
classifier excludes native management records just as the transcript UI does; the
existing exact objective decoder removes generated role envelopes from remaining
visible goal text.
The optional `recentChatContext` field belongs to the newly created temporary
record; absent means no copy. Existing records require no conversion or backfill.
Repeated creation with the same ID preserves the captured text and timestamp.

The temporary routing owner supplies this immutable snapshot to the existing
conversation continuity owner alongside its own transcript. Existing seen/pending
admission state delivers context and manages retries and model changes. Copied
messages are not written as newly delivered turns. Main remains unchanged, and
neither conversation observes later messages or edits in the other.

Definite pre-delivery rejection retains the authored follow-up but restores the
previous admitted message/run identity before reconciling native output. The
shared scoped owner anchors the first answer to its original unanswered transcript
turn, preserving the existing separate-turn projection for later native messages.
New ordinary sends reserve the existing pending shape just like catch-up sends;
only the same message ID with retained `attempted: false` allows a pre-write retry
after reload. Unknown delivery still uses receipt inspection and never grants
automatic replay. Historical rows and missing pending evidence are unchanged.
