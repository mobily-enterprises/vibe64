# Temporary AI assistance

People can open one or more clearly separate, short-lived AI tasks for focused
help without adding those exchanges to the main project conversation or
session history.

## Sources

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
- `src/composables/useVibe64AutopilotView.js`
- `src/components/studio/Vibe64TemporaryAiFixAction.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64ConversationAttachments.vue`
- `src/components/studio/vibe64-session/Vibe64EphemeralConversationMessages.vue`
- `src/components/studio/vibe64-session/Vibe64RenewalAssistantSelector.vue`
- `src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue`

## Public contract

Each temporary task has its own model settings, attachments and message stream.
User-facing temporary chats have the same capabilities, tools and project access
as main chat in both Codex and OpenCode. They use normal execution settings and
the same session write coordination and skill preparation. There is no temporary
permission mode or R/O–R/W toggle. Preview screenshots and console/network
diagnostics attach to the selected conversation through the normal upload path.
Only conversation persistence and cleanup differ. The server stores each chat's
identity, settings, draft and repair state below its session's `conversations/`
directory. Each chat uses the existing JSKIT transcript policy with a separate
filesystem scope and a persisted native provider conversation. Codex user-facing
chats are not native ephemeral threads. They never appear in main History.
The collection GET restores open chats; POST creates an idempotently named draft;
PATCH saves presentation and settings. First Send creates the native conversation
under the session write coordinator. Accepted message identities prevent a retry
from sending the same work again. Native history reconciles replies completed
while the browser was absent; incomplete replies remain visible as they arrive.
Temporary conversation requests wait briefly for that coordinator instead of
failing immediately on contention. A still-busy draft save retries automatically;
a later successful save clears the earlier save error.
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
composer and collapsible progress components. Each temporary task retains its
server-owned draft, attachments, settings and provider cleanup. Temporary
progress starts collapsed inside its assistant message; expanding it uses the
scrollable transcript. The fixed status above the composer uses normal chat's
shared plain status component and says “AI is working…”. The transcript has no
second working indicator and the status never repeats reasoning paragraphs.
Long progress cannot push Stop or the composer out of view. The temporary
workspace leaves the project session tabs and shared Save/Update activity
available above it. Main chat stays outside the horizontally scrolling temporary
tabs, so selecting or scrolling a task cannot cover the Main chat control.
Activity notices have a bounded height, and the temporary composer keeps its
buttons visible while long drafts scroll within the input. Repair details start
collapsed. The open Update repair replaces the duplicate repository error panel.
During reconnection the shared connection notice takes precedence over the repair
status and matching connection error; drafts stay editable and Send waits for
the connection. A failed generated repair request shows its concise description
in the composer while retaining the full request and message identity for retry.

Every product-owned repair entry uses the shared Fix it with AI control. It
opens, selects, and focuses a separate Temporary AI task immediately. That task
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

The terminal service also exposes one generic non-project ephemeral
conversation seam for a composing host. Its exact scope supplies a private
absolute working directory, private runtime root, empty or explicitly bounded
environment, provider binding id, and one bounded host-authored stable context.
It requires an explicit admitted provider/model selection but requires no
project, session, worktree, History, or Genesis project conversation kind.
Codex runs that scope read-only with dynamic tools and inherited facilities
disabled; OpenCode uses its hidden deny-all agent. Stop, read, wait, deletion,
provider cleanup, and unchanged authored turns reuse the ordinary provider
lifecycle. Codex deletion detaches the exact thread/provider from a shared
process or requires verified exit when that runtime is no longer shared; it
retains the exact binding for retry when exit cannot be proven. The shared
ephemeral message presentation and parameterized model selector let a composing
product present that lifecycle without changing Temporary AI's project-writing
contract.

Prompt suggestions, commit subjects, database help, and source explanations
use the bounded low-cost execution profile in a private non-project workspace.
Their complete task prompt is their only model context: they receive neither
Genesis project context nor Vibe64 driver output. Codex helper admission is
bound to that shared service's selected
account identity, so a credential refresh for the same account remains valid
while an account switch cannot reuse earlier helper ownership. OpenCode tasks
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
changing them preserves the prompt draft. Vibe64 supplies each provider's allowed
parameters and passes the applied configuration through the normal temporary
conversation endpoint.

Bounded Codex economy tasks resolve the connection's saved helper model before
starting. Recommended selects the default; explicit models must remain available
and support low thinking. An unavailable choice does not fall back to the main
chat model. The resolved execution profile retains the model for that task.
