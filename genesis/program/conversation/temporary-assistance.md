# Temporary AI assistance

People can open one or more clearly separate, short-lived AI tasks for focused
help without adding those exchanges to the main project conversation or
session history.

A host-provided conversation appears in the tab strip only while selected.
Its host owns the entry point; ordinary chat headers and temporary-chat tabs
do not keep a permanent shortcut. Returning to Main chat or a temporary chat
hides the host conversation without deleting its saved history.

## Sources

- `packages/vibe64-core/src/server/featureRoutes.js`
- `packages/vibe64-terminals/src/server/assistantRouting.js`
- `packages/vibe64-runtime/src/server/assistantRoutingStateUpgrade.js`
- `tests/server/assistantRoutingStateUpgrade.unit.test.js`
- `src/components/studio/vibe64-session/Vibe64ChatModeControls.vue`

- `src/lib/vibe64AssistantHost.js`
- `src/components/studio/Vibe64SessionPanel.vue`

- `packages/vibe64-terminals/src/server/agent/providers/claudeSessionAgentProvider.js`

- `packages/vibe64-runtime/src/server/codexAppServerProvider.js`
- `packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js`
- `packages/vibe64-database-tools/src/server/assistant.js`
- `packages/vibe64-database-tools/src/server/databaseDialect.js`
- `packages/vibe64-database-tools/src/server/schemaAccess.js`
- `packages/vibe64-database-tools/src/server/service.js`
- `packages/vibe64-terminals/src/server/codexEconomyThreadLedger.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-terminals/src/server/sessionConversations.js`
- `packages/vibe64-terminals/src/server/sessionAttachments.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `packages/vibe64-sessions/src/server/sessionPresence.js`
- `src/composables/useVibe64SessionTypingPresence.js`
- `packages/vibe64-terminals/src/server/opencodeServerProcess.js`
- `packages/vibe64-terminals/src/server/opencodeTerminal.js`
- `packages/vibe64-terminals/src/server/agent/sessionAgentManager.js`
- `packages/vibe64-terminals/src/server/agent/providers/codexSessionAgentProvider.js`
- `packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js`
- `src/composables/useVibe64TemporaryAi.js`
- `src/composables/useVibe64MountedSessionData.js`
- `src/composables/useVibe64AutopilotView.js`
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

Ordinary persistent temporary chats offer the same Plan, Code, Economy, Auto
and optional review controls as main chat, through one icon in the bottom
composer toolbar. Owners can open the shared Model routing overlay directly
from its menu. Each keeps its own selection, routing
preferences, pending request and retained native conversations. Creating an ordinary
draft starts in Plan with review off, inherits only its parent's workflow, and
does not require inference access to the parent's last model. The first routed Send resolves the submitting
actor's destination. App-generated implementation and repair drafts explicitly
select Code with review off, preserving the parent's workflow. Dedicated repairs
retain their instructions and cannot change mode.
The authenticated actor supplied by the HTTP turn action is captured with the
routing request, so later automatic review retains the submitting user's access
even when an owner reads the conversation or triggers reconciliation.
The shared routing coordinator uses the temporary conversation's existing write
lock and transcript; it does not write main-chat history or alter its selection.
Creation and polling release that lock before looking up mode availability.
Slow provider catalogue reads therefore do not block sibling Router updates or
draft saves; native admission and transcript reconciliation remain serialized.
Connected Codex history reads reuse their existing native observer. They do not
rebuild the execution environment; Send and reconnection still prepare it.
The existing filesystem lock admits local waiters in arrival order, so repeated
polls cannot overtake a pending routing update or cancellation. Wait timeouts
still apply, and filesystem ownership continues to protect separate processes.
Realtime routing updates share an already pending conversation read instead of
starting overlapping polls. A replaced turn resumes polling after the older
read settles; closed views and changed actors still discard that response.
Native idle events and read-time reconciliation recover one eligible review after normal
Code completion. Polling can schedule it when the current coordinator admitted
that Code request, even if its native idle event arrives later. After a backend
restart, a completed Code request instead offers explicit review Retry/Skip.
Closing or stopping a chat cancels pending routing and review.
Skipped, cancelled and incomplete reviews remain explained above the composer
after reload, until the next request replaces their status. The notice does not
restart work.
When routing stops before delivery, the local prompt returns to the composer;
its next explicit Send uses a new message ID. Newer draft text and attachments
are retained, and a clean cancellation does not appear as a failed message.
Dedicated repair requests keep their own instructions and do not expose modes.

Each ordinary temporary chat reads availability from the same central resolver as
Send, using its own workflow, mode and custom override. Its menu labels the user's
effective destination and Shared backup, rather than using the main chat's last
model or an account-wide preview. Mode changes return refreshed decisions without
inference. Explicit model/thinking edits update that mode's saved override; their
availability is validated against the current catalogue. Auto requires choosing
an explicit mode before customizing its model. A foreign backup cannot turn a
Plan/Code override into a split-orchestrator pair. Configuration and connection changes refresh existing chats' decisions
without replacing unsent drafts or switching away from Main chat or the selected
temporary chat. Initial restoration still opens saved temporary chats.
Only account and connection events reload the
collection; unrelated progress events do not. Refreshes during a pending read
share that wait, then the latest refresh reads one fresh snapshot. Actor changes
clear the old view and reload it;
late responses from that view cannot alter the newly loaded chat with the same ID.
Opening this workspace and restoring its history do not require access to the
main chat's last model. An active turn reports its separate native steering
permission; a collaborator may be unable to steer that turn while still having a
shared route for the next request.

Foreign Economy and Backup turns use the same changeover preparation and Send
owner as Main chat, scoped to this chat's metadata and visible transcript. The
previous native conversation is stopped and retained before selection changes;
a failed stop leaves that selection unchanged. Returning resumes the recorded
native conversation and sends missed or corrected visible messages with the
ordinary authored request. No separate handover inference is added. Each retained
binding stores its native ID, exact selection, settings and last message/run IDs.
Codex routed histories retain their home; legacy external-provider histories keep
their compatibility restriction even after an intervening foreign-engine turn.
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
User-facing temporary chats have the same capabilities, tools and project access
as main chat in Codex, Claude Code, and OpenCode. They use normal execution settings and
the same session write coordination and skill preparation. There is no temporary
permission mode or R/O–R/W toggle. Preview screenshots and console/network
diagnostics attach to the selected conversation through the normal upload path.
Only conversation persistence and cleanup differ. The server stores each chat's
identity, settings, draft and repair state below its session's `conversations/`
directory. Each chat uses the existing JSKIT transcript policy with a separate
filesystem scope and a persisted native provider conversation. Codex user-facing
chats are not native ephemeral threads. They never appear in main History.
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
heartbeat and expiry with the saved conversation ID as an additional scope.
The server takes the actor from authentication and checks that the chat belongs
to this session. Main chat and other temporary chats ignore its typing events.
The shared composer status displays the person's name, or a count for several
people, without receiving draft text through presence. Blur, Send, switching
chats, hiding the workspace and disposal clear the old presence; reconnect
refreshes it only while typing remains active. This indicator does not lock or
merge simultaneous draft edits.
Switching sessions preserves each session's selected temporary chat and draft.
While mounted, each task tracks unread assistant text in browser-local state.
New or streamed reply text received outside the active visible conversation
marks that task's tab, the expanded incognito button and the compact session
actions trigger/menu entry. Viewing a task clears only its own indicator;
opening the actions menu does not mark messages read. Unchanged polls, user
messages and reasoning-only updates do not create unread replies. The compact
trigger preserves independent renewal attention after unread replies clear.
Restored history starts as a baseline rather than announcing old replies.
Reloading or removing the project view stops only its local readers. It sends no
Stop or Delete request. Late responses cannot restart a retired reader or report
an obsolete repair result. Server startup restores discovery and finishes recorded
Close attempts. Work discovered without its original backend observer is stopped;
restoration does not send or resume a turn. Active temporary work and Codex goals
also prevent dormant-project cleanup, just like main chat.
Explicit Close is one server operation: retain the closing record, pause any goal,
confirm native work stopped, delete the native conversation, remove its owned
attachments, then delete the record and transcript. A failure retains the record
and offers the same Close again, including after reload. File edits remain.
After deletion succeeds, the session realtime event identifies the closed
conversation. Other browsers remove only that project's matching session tab,
cancel its pending saves and polls, and ignore late responses that would restore
it. Reconnection reconciles the saved collection to recover missed closures while
preserving new local drafts. A closed-conversation API error also removes the
stale tab; Send never recreates a chat closed by another browser.
Closing an incomplete Update repair requires confirmation that partial edits
will remain and may still need repair. Closing waits for Stop and provider
deletion to succeed; a failure leaves the chat available for retry, and a failed
Stop resumes progress polling. Update verification must finish before its repair can be closed. A Close during
conversation creation waits for creation and prevents a pending Send. Stop does not reset source files, HEAD, or the
index, and a late response cannot turn a cancelled repair into an automatic
Update. Partial application edits remain subject to review; cancellation does
not claim the application is repaired.
Stop errors appear above the composer and Close errors inside the confirmation,
so a notification cannot cover the retry control. Visible repair results do not
also raise a duplicate toast; background completion still notifies the person.
An unavailable progress read keeps the draft and Stop available and retries the
existing read loop. It does not report completion or send another turn. Only a
confirmed terminal state, expired conversation, or successful Stop releases the
composer for another send.
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
composer and collapsible progress components. Both use JSKIT's
`createAssistantMessageDelivery` for pending entries, failed delivery and receipt
matching. Temporary Send inserts its user bubble before waiting for a draft save,
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
Code access, independently of the main chat's mode or personal connection.
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

The compact repair status and Check Update action remain outside the scrolling
transcript. Check Update deliberately verifies an idle repair, including one
whose AI returned a continue result. The header's Update action uses that same
check when an unresolved repair exists. Repair launchers reuse the session's
existing unresolved Update task even when diagnostics change, preserving unsent
replies and attachments. Verification diagnostics remain available to subsequent
turns instead of being cleared by a follow-up question. Save repairs do not
automatically publish work, and Update itself never publishes.

Interactive Codex temporary turns have no fixed completion deadline. They remain
observable until completion, Stop, deletion, or loss/replacement of the shared
provider connection. Short helper turns retain their bounded deadlines.

OpenCode temporary Start returns the accepted turn immediately, keeping Stop
available while the existing controller observes completion. Conversation reads
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
Codex wait retains the original deadline and interrupts the exact turn on timeout;
OpenCode wait retains bounded-output validation even with an explicit timeout.
Claude applies the helper's output limit to answer text and structured results;
reasoning keeps the normal block-size limit instead of consuming that allowance.
Router refuses interrupted or failed helper results before parsing a decision,
preserving the provider's error and cleaning up without dispatching the request.
Claude reports its managed execution ID before inference so the parent request
can retain it for restart cleanup. Cleanup uses the captured native reference and
must verify stop; it does not authorize another inference. Cancellation before
native thread creation also releases any catalogue runtime owned by that scope.
The manager also composes these scoped operations into one bounded helper turn,
awaiting the parent's native-identity event before starting. Abort during startup
stops the late native turn; abort while waiting stops that same scoped turn.
Save naming now resolves effective Economy through this seam, with durable
cleanup references in the existing Save task. Suggestions, source explanations
and database callers still need migration from their older per-account settings
and detached operations.

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

Codex restores durable helper ownership only while its exact managed runtime
and provider context remain current. If the runtime has disappeared, Vibe64
atomically retires the stale ownership. If the provider context changed under
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
An unfinished native goal fixes the temporary chat's mode and model and suppresses
automatic review. Its observed goal reaches the mode menu after restoration and
polling; an omitted goal in a failed read cannot clear an earlier observation.
Native completion first saves the final reply through the ordinary snapshot
owner. Review then checks the saved reply for the composer's structured questions;
an unanswered question retains the coding model and waits for the user's answer.
This also applies when a collaborator uses a foreign Backup pair.
Changing modes or models requires a successful native read. Configuration changes
cannot move a paused native goal to another model on its next Send.

Bounded tasks use the central resolver's exact destination. Their provider
profiles validate that model and enforce workload limits without consulting a
per-account helper preference or choosing an implicit fallback. The profile
retains the model for that task. Codex requires low thinking; Claude validates
low effort when the model exposes effort controls. Claude's tool-free process
uses the selected account's private home without the project's command
environment, Genesis prompt or driver. Routing changes affect new tasks.
