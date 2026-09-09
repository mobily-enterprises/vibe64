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
- `src/components/studio/vibe64-session/Vibe64ConversationProgress.vue`
- `src/components/studio/vibe64-session/Vibe64EphemeralConversationMessages.vue`
- `src/components/studio/vibe64-session/Vibe64PromptHints.vue`
- `src/components/studio/vibe64-session/Vibe64RenewalAssistantSelector.vue`
- `src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue`

## Public contract

Each temporary task has its own model settings, optional attachments, message
stream, and explicit read-only or workspace-writing policy. Temporary tasks do
not offer preview, console, or network diagnostic attachments and are visually
distinct from the durable project conversation. Closing a task stops its live
turn, deletes its provider conversation and exact uploaded attachments, and
removes its browser-local state. Tasks are not restored after reload and never
appear in session History.
Switching between project sessions preserves each session's selected temporary
chat, progress, and reply draft. Selecting Main chat explicitly keeps Main chat
selected when returning to that session.
Removing the project view retires its pending sends and progress readers. Late
replies cannot restart polling, report a repair completion, or show obsolete
Stop or Close errors. Failures remain visible and retryable while the view is
still mounted. If conversation creation finishes after departure, the browser
requests deletion of that exact
conversation without starting a turn. Departure cleanup is best-effort; it does
not provide the confirmed Stop and deletion guarantee of explicitly closing a
task. Hiding a retained session or selecting Main chat does not retire its work.
Closing an incomplete Update repair requires confirmation that partial edits
will remain and may still need repair. Closing waits for Stop and provider
deletion to succeed; a failure leaves the chat available for retry, and a failed
Stop resumes progress polling. Startup and Update verification must finish
before their task can be closed. Stop does not reset source files, HEAD, or the
index, and a late response cannot turn a cancelled repair into an automatic
Update. Partial application edits remain subject to review; cancellation does
not claim the application is repaired.
Stop errors appear above the composer and Close errors inside the confirmation,
so a notification cannot cover the retry control. Visible repair results do not
also raise a duplicate toast; background completion still notifies the person.
Task attachments use the shared upload queue, text references and preview/download
dialog. They retain the temporary upload lease and exact-file cleanup when the
task closes; they are not copied into the durable main conversation's artifacts.
Both assistant adapters receive file descriptors resolved by the shared
attachment service.
Assistant replies use the same formatted text presentation as normal chat,
including lists, bold text, code, and links. User-authored text stays literal.
Raw HTML remains text, and executable or data-URL links are not made clickable.
Main and temporary chats share the collapsible progress component. Temporary
progress starts collapsed inside its assistant message; expanding it uses the
scrollable transcript. The fixed status above the composer uses normal chat's
shared plain status component and says “AI is working…”. The transcript has no
second working indicator and the status never repeats reasoning paragraphs.
Long progress cannot push Stop or the composer out of view. The temporary
workspace leaves the project session tabs and shared Save/Update activity
available above it. Main chat stays outside the horizontally scrolling temporary
tabs, so selecting or scrolling a task cannot cover the Main chat control.

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
reply or attachment, read-only policy, Stop, departure, or active repository work
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
stable Genesis and Vibe64 context for its read-only or workspace-writing kind,
while ordinary human turns contain only the person's authored text. Update
repair follow-ups additionally carry the latest Vibe64 verification diagnostic;
the visible bubble keeps the person's text or a concise automatic retry label.
It keeps the
session directory and appropriate command boundary.

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
false account conflict. A real account change remains blocked.

Database Copilot begins with only bounded database identity and object counts.
Its temporary helper can search the refreshed schema, list object names and
kinds, and request complete SQL-relevant definitions for a bounded set of
matches before proposing a query. Truncation is explicit and another search is
available; credentials never enter the helper conversation. PostgreSQL and
MySQL or MariaDB implement one server dialect contract for connection,
inspection, SQL policy, read-only execution, and result interpretation, while
the assistant consumes only the normalized schema contract. Any requested
query runs only through the session's read-only database identity.
