# Direct agent conversation

People work with the coding agent through one ordinary project conversation,
including follow-up guidance while a turn is active.

The shared transcript groups adjacent reasoning summaries across storage rows.
User messages, commentary, answers and system messages separate progress groups.
Vibe64 supplies the existing active execution state as `conversation.working`;
the renderer previews only trailing progress while working. No provider-turn
association or history rewrite is required for grouping, including goal
continuation and loading older history.

## Sources

- `src/components/studio/vibe64-session/Vibe64CodexPlanUsage.vue`

- `packages/vibe64-core/src/server/sessionRealtimeEvents.js`
- `packages/vibe64-sessions/src/server/inputSchemas.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-sessions/src/server/sessionMessageSuggestions.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `packages/vibe64-runtime/src/shared/conversationAttachments.js`
- `packages/vibe64-runtime/src/shared/assistantSelection.js`
- `packages/vibe64-runtime/src/shared/agentSettings.js`
- `packages/vibe64-runtime/src/shared/promptHints.js`
- `packages/vibe64-runtime/src/server/codexAppServerProvider.js`
- `packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js`
- `packages/vibe64-runtime/src/server/minimumCodexVersion.js`
- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-genesis/src/server/promptContext.js`
- `packages/vibe64-runtime/src/server/codexSessionCommandHook.js`
- `packages/vibe64-execution/src/host/execHelper.js`
- `packages/vibe64-execution/src/server/request.js`
- `packages/vibe64-execution/src/server/runVibe64Command.js`
- `packages/vibe64-execution/src/server/engines/helperClient.js`
- `packages/vibe64-execution/src/server/engines/capture.js`
- `packages/vibe64-execution/src/server/result.js`
- `packages/vibe64-terminals/src/server/codexGitCommand.js`
- `packages/vibe64-terminals/src/server/agentCommandEnvironment.js`
- `packages/vibe64-terminals/src/server/agentSessionCommand.js`
- `packages/vibe64-terminals/src/server/conversationActor.js`
- `packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js`
- `packages/vibe64-terminals/src/server/agent/providers/codexSessionAgentProvider.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-terminals/src/server/codexTurnOutcomeNotice.js`
- `packages/vibe64-terminals/src/server/agent/providers/opencodeAssistantCatalog.js`
- `packages/vibe64-terminals/src/server/opencodeServerProcess.js`
- `packages/vibe64-genesis/bin/genesis`
- `packages/vibe64-terminals/src/server/opencodeSessionEnvironmentPlugin.js`
- `packages/vibe64-terminals/src/server/opencodeTerminal.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-terminals/src/server/sessionAttachments.js`
- `packages/vibe64-terminals/src/server/sessionPromptHints.js`
- `src/composables/useVibe64AssistantCatalog.js`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64ConversationLog.js`
- `src/composables/useVibe64MountedSessionData.js`
- `src/composables/useVibe64SessionRuntimeHost.js`
- `src/composables/useVibe64PromptHints.js`
- `src/components/studio/Vibe64CodexSession.vue`
- `src/components/studio/Vibe64InteractiveTerminal.vue`
- `src/components/studio/Vibe64OpenCodeSession.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64ConversationLog.vue`
- `src/components/studio/vibe64-session/Vibe64ConversationAttachments.vue`
- `src/components/studio/vibe64-session/Vibe64AttachmentDialog.vue`
- `src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue`
- `src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue`
- `src/lib/vibe64AssistantHost.js`
- `src/lib/vibe64ChatMessage.js`
- `packages/vibe64-runtime/src/shared/integrationSetupRequest.js`
- `src/lib/vibe64WelcomeName.js`
- `vite.config.mjs`

## Public contract

JSKIT owns the suggestion and working-status presentation, debounced suggestion
lifecycle, model-choice controls, goal controls, upload queue, and upload lifecycle.
Vibe64 supplies native state and actions, project-aware suggestion requests,
connected-provider policies, upload storage, attachment opening, and favourite files.
The goal indicator flashes red while active, stays orange while paused, and shows
elapsed active time when space permits. The application omits goal controls for
assistants without that capability.

The conversation uses `AssistantConversationElement` from
`@jskit-ai/assistant-core/client/conversation`. Main chat, temporary assistance,
and database copilot share its transcript and composer primitives. Vibe64 owns
selection, uploads, integration actions, model/permission settings, suggestions,
Save and provider execution policy. Its application adapter is documented in
`docs/assistant-application-contract.md`.

The same package owns Codex notification classification, detached-turn watching,
Codex JSON-RPC and OpenCode HTTP/SSE transport, and conversation transcript
policy. The session store supplies the existing filesystem adapter and session
locks. Saved files, history ordering, identity, actor metadata and archive
behavior retain their current format and ownership. No transcript migration or
second durable history is introduced.

The Codex indicator reads the current main conversation goal from `thread/goal/get`
on its existing provider. Goal controls require assistant access and accept only
pause/resume on that session's current thread and unchanged objective/creation
identity. Status-only `thread/goal/set` preserves Codex-owned objective, budget
and usage history. Pause prevents further automatic turns without interrupting
the current turn or releasing its write ownership; Stop still interrupts work.
Resume uses Codex's native goal scheduler. Completed goals and exhausted token
budgets are not restarted by this control. Goal notifications invalidate the
protected read endpoint without broadcasting the objective. The same square
retains weekly allowance and exposes goal controls independently of plan data.

When reconnecting to a native goal continuation, live thread activity takes
precedence over a terminal status in turn history. History can lag while the
resumed turn prepares its context. The main-thread bridge requires an observer
before native resume, and provider observers survive replacement of the socket.
Notifications from an obsolete socket cannot reach the current observers.
Reading a saved final answer never resumes a thread.

Each completed final reply is saved and broadcast immediately using its native
thread, turn and item identity. Two replies in one provider turn remain separate,
even when their text is equal. A replay is idempotent across controller restarts;
a correction updates only that item's original row. Terminal-origin finals use
this same writer. Commentary retains its separate duplicate-progress policy.
Goal continuation and settlement keep their existing execution owner and do not
gate message visibility. Older events cannot borrow a successor's identity.
Native-history recovery uses the same per-item writer, including while a goal
is active or a verified observation stop awaits explicit continuation.
After observation loss, a failed native-history read rejects continuation and
retains the stopped state until recovery succeeds.

Vibe64 retains the outer chat owner, visible progress and steering while the
provider reports activity. A fresh live observation can repair a falsely failed
or interrupted current turn under the session lock. This does not let delayed
notifications revive completed turns or overwrite a successor. An active goal
alone does not override a confirmed inactive, interrupted turn.


Observation loss is owned by the provider controller. Codex transport loss and
notification-processing failures block provider work, persist an observation-loss
barrier, then pause the native goal and interrupt its turn. A fresh idle read
proves a per-thread stop. If control fails, the existing runtime owner must
verify process exit; shared sessions are suspended together. The barrier prevents
background native resume and stale activity writes. Only explicit Send or Resume
clears it. A healthy stopped control connection remains available for goal reads.
A shared-process fallback may make goal details unavailable until an explicit Send.
The saved main-thread owner is registered before startup connection attempts.
Failed observer attachment and failed history writes use the same stop owner.
Shared-runtime cancellation includes providers that own only temporary chats.
Failed stop-state persistence retains the owner for retry; provider retirement
or release follows that durable write and precedes publication of the stopped
state. Reconciliation cannot prune an unverified stop owner.

OpenCode opens its SSE observer before prompt admission, including temporary
turns without a UI event callback. Unexpected stream completion, event-handler
failure, or transcript persistence failure triggers the same verified native-abort
or process-stop policy. A failed stop retains active ownership for retry. Late
SSE events are rejected after cancellation, and an explicitly resumed session
gets a fresh cancellation controller after shared-process shutdown. Internal
helper tool restrictions are unchanged.

The composer keeps typing available while sending, stopping, or reconnecting.
External run state updates its delivery controls directly; a verified suspended
state permits a new Send. Pending Stop can settle from its matching realtime
receipt before the original HTTP request completes. An observation-loss state
with unverified cancellation blocks steering and explains that stop verification
is pending. The shared textbox measures after Vue updates and responds to pane
width changes once per animation frame, preserving the draft, caret, and focus.

Codex plan allowance uses `account/rateLimits/read` and
`account/rateLimits/updated` on the existing interactive provider connection.
Only normalized percentages, window durations and reset timestamps reach the
account-access-checked session read endpoint. Account changes and connection
replacement invalidate the in-memory reading; late reads cannot restore a
previous account's values. API connections and unauthorized collaborators
receive no allowance. Realtime session events carry invalidation only. The
active Codex chat indicator reads on mount and live invalidations, with a
one-minute visible-page refresh and bounded provider reads. It never starts
an assistant to obtain usage, stores no allowance in project history, and
shows only the percentage remaining for the seven-day window. Missing or
expired weekly readings hide the number until Codex confirms current values.
Hover/tap details include known weekly reset times and the five-hour allowance
and reset time when supplied, without adding them to the visible percentage.


Codex and OpenCode pass readable, single-quoted command text to the existing
session command wrapper. Shell quoting preserves literal quotes, substitutions,
multiline text, and whitespace until managed execution. The wrapper encodes the
text for the unchanged socket transport and retains session identity validation,
output, exit status, and session-owned cleanup. Codex displays the wrapper
`VIBE64_WRAPPER` environment variable without embedding a reconnect warning in every command;
control failures remain runtime errors. OpenCode unwraps its canonical quoted
invocations before rewrapping tools or presenting model history.

The shared session command environment exposes `VIBE64_DROP_ZONE`, resolved from
the session store. Main and task conversations may use that directory to exchange
files with the person outside Git; runtime-state protections still apply elsewhere.
Read-only conversations retain their no-write instruction. The exchange is
per-session and expires on successful archival.

Main assistant context describes one explicit final `vibe64-integration` code
block containing only the saved integration slot ID. The conversation renderer
recognizes a complete final assistant block, preserves ordinary prose and
leaves malformed, quoted and non-assistant content as text. Its Configure card
uses the existing project route with the current session and originating turn.
The Integrations page selects that development slot and explains a missing slot.
The ordinary saved assistant message owns request restoration. The runtime
shared parser is used by both the renderer and session store. For explicit
requests the store returns a request fingerprint and a saved decision.
Its skip operation serializes a decision beside the original conversation turn,
rejects changed requests and preserves the result through reopening and archive.
It does not alter provider grants or deliver another assistant message. The
session Skip action takes the actor from authenticated request context and
requires normal assistant access before mutating the store. The card exposes
Skip only for a saved pending request, displays the saved outcome and reports
a refused save. Realtime notification and the HTTP completion reload history;
a response from a departed session cannot replace the current card error.
The store also supports an internal completed decision containing a configuration
hash, verification time and one stable continuation message ID. Concurrent
completion retries return the saved identity; a different configuration is
rejected. Completion cannot overwrite Skip, and Skip cannot erase completion.
Recording it does not send an assistant message. The setup-command service can now supply completion after checking assistant
access, the exact saved request and configuration, and an application-reported
connected result with a verification time. Configure carries the request fingerprint through the project route. Integrations
attaches it only for the matching development session and slot, together with the
loaded configuration hash. Confirmed decisions reload the server conversation;
the card renders Setup completed independently of live account status. Completion publishes the existing session-changed event with a refresh reason;
other selected-session conversation models reread durable history rather than
trusting event-provided decision data. Status restoration does not publish another
completion event. After completion, the Integrations screen calls the session-owned
resume action and reloads conversation state, including when delivery is uncertain.
The OpenCode controller can inspect admission of an exact message on its original
native thread. A matching user message proves acceptance; absent or unavailable
bounded history leaves admission unknown. Inspection creates no native session,
sends no prompt and returns no conversation content. Integration continuation uses this admission check after uncertain delivery. A controlled test closes the sending
controller after a failed local write and inspects the accepted message with a
fresh controller using the same provider history. Full browser and process-restart recovery remain unverified. Codex can likewise inspect the current bound native
thread for an exact user-message client ID, keeping missing or unreadable history
unknown. The session manager exposes admission inspection through both provider
adapters and requires normal assistant access before dispatch.
The completed decision also owns continuation delivery state. A serialized claim
records the original engine and native thread before delivery. Only the first
claim can send; reopening a sending record requires admission inspection. An
accepted record cannot be claimed again or rebound to another thread. These
store operations do not themselves contact the assistant. The terminal service
claims and delivers under the existing main assistant write lock. Before the first
claim, the sessions feature supplies the source editor's configuration reader;
the terminal service requires the completed configuration hash and slot to still
match. Source edits use that same write lock. A missing reader or changed
configuration leaves the continuation pending without a prompt. Recovery of an
existing claim does not depend on current configuration. It sends a fixed
continuation containing only the slot ID, checks provider history after uncertain
delivery, and never resends a claimed message. The session action takes its actor
from authenticated context and exposes only request identity as input. A controlled
OpenCode service test proves later admission recovery after local persistence fails
and provider history is temporarily unavailable. Two competing service calls
use the real session-store write lock and retain one continuation identity and
one provider prompt. The feature setup test verifies that sessions receives the
source editor's reader through its declared capability. The Integrations screen preserves
the connected account when continuation delivery cannot be confirmed and exposes
the error through its existing connection feedback. A controlled Codex service case closes the original service after a failed
local user-message save and unavailable history. A fresh service confirms native
acceptance from the saved claim and provider history without another prompt or
steer. This uses simulated provider history, not an operating-system crash. The restored
chat card displays pending, unconfirmed, or accepted continuation separately
from Setup completed. Check continuation calls the session resume action directly from the saved
chat request. It does not run an application setup command or require the slot
to still exist. Configure remains a separate navigation action. Skip and
continuation use the conversation model's shared pending/error state; late
responses cannot replace another selected session's feedback. Full browser and process-restart recovery acceptance remain
outstanding.

The command boundary can carry a private release environment-file reference for
a finite application deployment command. It excludes editable project/session
Env and the editor process environment, and rejects local execution when no
managed host can consume the reference. The host helper requires the private,
owner-held `artifact/service/environment` file and a working directory inside
its sibling `workspace`. The transient unit loads that file; its command runner
keeps the host-selected identity and runtime paths. This is an execution
capability, not a production Integrations screen or an active-release selector.
The caller must still select and coordinate the active release.

The managed Git/gh command boundary preserves stdout and stderr bytes, including
NUL-delimited filenames, binary data, and leading or trailing whitespace. Capture
does not trim either stream. The existing base64 output encoding carries bytes
through the JSON socket; the wrapper decodes them and lets output flush before
exiting with the command's status. Human-readable errors and bounded operational
logs decode the transport without changing the returned streams. Display-only
combined output may still be trimmed. Genesis verification therefore remains
current across repeated checks until relevant source or its contract changes.

The conversation accepts messages, structured answers, attachments, and
steering guidance. It streams commentary and the final response, persists the
conversation in order, restores it after reconnection, and lets the person
interrupt the current turn without deleting the session. Agent questions may
be answered as free text or through suggested choices while the submitted
reply remains ordinary conversation text.
Numbered question labels and their suggested choices use the shared inline
Markdown renderer, preserving bold text, code, and links without interpreting
raw HTML. Their file links use the same source-editor navigation as prose.
Explicit numbered questions may include explanatory sentences after the question
mark; those sentences remain attached to their question and do not suppress the
answer fields. Numbered statements alone still do not create answer fields.
The shared hints/status row keeps the same 2.25rem height when empty, loading,
showing suggestions, or reporting assistant activity. It remains a normal grid
row directly above the composer, moving with the input as that input grows or
shrinks. Hint transitions do not resize the conversation area.
Escape returns focus to the composer before dismissing hints, so that focus
change does not immediately regenerate the dismissed suggestions.
The shared Markdown renderer sizes table columns from their content, wraps
prose at word boundaries, and preserves declared column alignment. Table cells
override the inline renderer's arbitrary word breaking; long identifiers remain
bounded. Wide tables scroll inside a labelled, keyboard-focusable container
without widening the conversation. Headers and row separators use theme colors.
OpenCode connects its turn event stream before submitting a new prompt, retaining
failures raised before a native assistant message exists. An error event does
not by itself prove execution stopped: native idle state or a completed response
settles that failure, and its details become a durable conversation notice.
An acknowledged native abort cancels only that turn's history and event reads,
persists interruption, and releases the controls without waiting for a final
assistant message. An unresponsive abort fails after five seconds and permits
another Stop attempt; it does not claim unconfirmed work has stopped or kill
other conversations sharing the provider process.

The selected session's model catalogue loads in the background. Opening its
menu refreshes choices while retaining already loaded controls; only a first
load shows placeholders. Identical overview and provider-list queries share
one cached request, including their connected-provider filter. Explicit refresh
reloads that shared query once; a provider search or later page remains a
separate request. Applying a selection still uses the provider's current
catalogue validation.
Codex chat model discovery reuses a successful catalogue for up to thirty
seconds while the account, authentication generation, and runtime context stay
the same. Account transitions discard it. A temporary probe must finish verified
runtime cleanup before its catalogue can be reused; an existing shared assistant
process stays running.

Assistant verification observes an established provider connection without
taking the session's agent-write lock or rebuilding its command environment.
The session-agent manager shares overlapping checks after authorizing each
caller. A missing, unloaded, or disconnected provider session goes through its
provider controller's preparation path, which waits up to ten seconds for the
agent-write lock. Attachment uploads retain that lock so renewal cannot freeze
and clean up a session while an upload is writing. Provider checks discard late
responses when their session or connection has closed or changed. Codex helper
ownership restoration belongs to startup reconciliation and helper operations,
not main-conversation readiness.

The browser coalesces checks for the same
connection and retries failures after one second, backing off to thirty seconds.
Session detail reads have a twenty-second deadline and honor query cancellation,
so a hung read cannot trap later recovery attempts. Each complete check has a
forty-five-second deadline. Disconnecting or leaving the session cancels that
browser's check and retries without stopping provider work;
old responses cannot overwrite the new connection's status. Hidden browsers
pause recovery retries and resume them when visible. A successful provider check
requires an explicit success response and remains verified if a subsequent
display refresh fails. Failed checks preserve the active conversation and log
their error code for diagnosis.
An empty conversation's welcome can use a host-provided reactive name for the
current person. Without that presentation provider it uses the standalone
personal profile. An explicitly empty host name stays generic instead of falling
back to an unrelated profile. This name changes only the welcome, not authored
messages or saved conversation history.
An explicit Possible answers block remains one selectable answer group when
explanatory prose or a numbered recommendation list appears before it. Only
actual numbered questions become separate required fields, so ordinary
numbered content retains its normal Markdown presentation.
When canonical session state reports a completed turn that was not observed
through realtime conversation delivery, the mounted conversation rereads its
durable history. A missed notification therefore cannot leave a completed
answer absent until the person sends another message.
Session and terminal services share one session-event publisher. Each event
carries its trusted project identity, allowing the host to authorize delivery
before conversation patches reach a socket. Mutation services own completion
events; action declarations do not publish the same completion again. Lifecycle
progress remains separate from completion.
Long user messages remain available in full but initially use a compact preview
that each reader can expand or collapse.
The shared composer inserts ordinary `[Image #1]` and `[File #1]` references and
shows the same labels beside uploaded files. Removing an upload removes its
exact reference and renumbers remaining references; edited text remains ordinary
text and never deletes a file. Both Codex and OpenCode use the same upload,
reference, admission and retention implementation. Their adapters translate
resolved image descriptors into native image inputs; other files remain
available through trusted file paths in the provider prompt. OpenCode also
records per-conversation native access to those attachment directories so its
file tools can reopen them later, preserving unrelated permission rules.

The session attachment service resolves project- and session-scoped upload IDs
and copies submitted files into the existing session artifacts before delivery.
Files prepared for a submission stay for the session lifetime, including failed
delivery attempts that may be retried, and are included in the session archive.
The temporary upload lease still expires abandoned uploads. A retry can resolve
the same ID from session artifacts after that temporary copy has expired.
Conversation records retain IDs, safe file names, sizes and references without
provider paths or file bytes, preserving paginated history. Clicking a queued or
sent file opens the shared dialog: supported raster images display inline and
other files offer download. A failed image decode falls back to download. The
read route uses the existing project authorization and resolves the attachment
within its session; active document formats such as SVG are download-only.
Send, steering and Resend clear only the upload IDs acknowledged for that
message, preserving newer draft uploads and renumbering their references.
Older conversation records that retained only file details cannot recover bytes
already removed by upload expiry.

When a host reserves an AI connection for its owner, collaborators can submit
message suggestions for the owner's approval or dismissal. A new suggestion
and each owner decision capture that person's preferred name, falling back to
their trusted account name. Those stored names do not change when a person
later edits their preference. Normal approved delivery sends the authored
message unchanged; its visible attribution names the author and approving owner.
Each approval checks its current caller, including requests that arrive while
an owner's delivery is already pending. Duplicate owner approvals share that
delivery; a failed delivery remains retryable with the same provider message id.

New paginated Codex conversations persist their native identity and empty
history before Vibe64 publishes them as ready. Their initial native name is
their conversation id. This one-time initialization reads only the newly
created empty thread; it preserves pagination and does not hydrate an existing
conversation. The first message can therefore resume the same conversation
without requiring an earlier model turn to create its history records.

Vibe64 expands the session's opening project request with Genesis guidance once.
Ordinary follow-ups and active-turn steering remain ordinary conversation
instead of regenerating that complete prompt. An explicit Deslop request uses
the same visible message-delivery path with a narrow task marker so Genesis can
compose cleanup instructions for the selected task changes or explicit commits.

If an inactive conversation still names a Codex thread that the provider
reports as exactly missing, the next message enters the established thread
replacement path. Vibe64 records the replacement, restores the durable visible
conversation into the new provider thread, and then delivers that message once.
An active turn and unrelated invalid provider requests remain failures rather
than being reinterpreted as missing history.

Separately, Genesis composes one stable session context containing its project,
Engineering, and Collaboration guidance plus Vibe64's main-conversation rules.
Codex installs it as thread instructions and OpenCode keeps it in the system
context through Genesis's ordinary project plugin. It creates no conversation
message or additional agent turn. Collaboration changes become current only
when that stable context is next established or refreshed; Codex cannot replace
developer instructions inside an already-live thread.
The provider may serialize its system or developer instructions again for a
later stateless model request, but Vibe64 does not rerender them into the
person's message or copy them into the turn-context lane.

The Vibe64 Genesis hook executable grants Git trust only to the registered
OpenCode provider session's exact working directory when invoked from that
directory. Unregistered sessions and other worktrees keep Genesis's ordinary
ownership checks. This uses the same scoped compiler trust operation as
Vibe64's in-process inspections, without global Git configuration or ownership
changes.
The OpenCode runtime plugin imports only the prompt formatter from the Genesis
boundary, so formatting host context does not load the compiler's native source
parsers into OpenCode's Bun process. Genesis hooks still run through the separate
Node executable.

Non-project, tool-free conversations have no Genesis project plugin. OpenCode's
host plugin therefore installs their validated, host-supplied context directly
in the system lane, replacing coding-agent defaults for that exact native
conversation only. It reads the current context on each model request so a
refreshed host snapshot takes effect without adding a user message. Ordinary
project conversations keep their existing Genesis prompt lifecycle.

Every real human turn keeps the person's authored text unchanged. Vibe64 adds
no turn context: no name, actor id, policy identifier, tone, response length,
experience, explanation style, project note, question format, or concealment
instruction. Genesis retains a generic bounded turn-context capability for
hosts that need one, but Vibe64 deliberately does not use it. When Codex mirrors
a user message entered through its native terminal into Vibe64 History, that
history item inherits the actor metadata from the latest Vibe64 UI message.
This attribution is internal conversation data and is never sent to the model.

Message delivery and provider work remain visibly distinct. The composer shows
the initial send while the message is being accepted, then reports the selected
assistant as working for the rest of the active turn. The session tab and
assistant avatar use that same live turn state until completion or interruption.
New Send and Steer submissions clear the draft immediately. Their pending
conversation entry retains the submitted text, and later delivery leaves any
new draft untouched. A rejected Steer restores its original text only when the
composer is still empty; otherwise its failed entry keeps the Resend and Edit
actions without replacing the newer draft. Retries retain the same message id.
A durable user-message receipt with the exact submitted message id settles Send
and the saved-commit Deslop banner even while the HTTP request remains pending.
Unrelated messages do not acknowledge delivery. Codex records that authored
message from its provider receipt before subsequent answer notifications;
expanded Genesis instructions remain out of visible history. The normal HTTP
completion shares the same write and cannot duplicate the user message.
Codex finishes delivery and its admission bookkeeping from either the exact
persisted receipt or the provider acknowledgement; it does not wait for both.
Once the receipt confirms delivery, the message-delivery path does not repeat
its bookkeeping or resend that message when a late acknowledgement fails.
Stop settles when the matching turn becomes inactive or the interrupt request
returns. Subsequent session reconciliation runs in the background. Recoverable
Git checkpoints retain their lifecycle without holding the composer busy after
the stopped state has been published. A new message may start without waiting
for an already-confirmed message's HTTP response. A later turn can also be
interrupted while an earlier confirmed Stop request is still finishing; the
transport does not discard it as a duplicate in-flight command. Late results from an older
request or a previously selected session cannot overwrite the current draft.
An interruption failure uses the top error banner so it cannot cover the mobile
composer's Stop or Steer controls. Retrying, a changed turn, or leaving the
session clears that failure.
If message delivery fails, the exact error belongs to the failed message with
its Resend, Cancel, and Edit actions inside the scrollable conversation. The
composer does not repeat that raw error below its input or let it displace the
chat layout. If the server disappears after claiming a prompt but before the
provider creates a turn, Vibe64 fails the expired unowned claim automatically
so the next message can start normally.
When an OpenCode provider reports successful completion without a user-facing
response, Vibe64 makes one bounded continuation request for that response. If
the provider again returns no response, the turn fails visibly instead of
appearing to have completed silently.

The chat cog opens a compact selector for the AI used by that session. It shows
only currently connected providers and currently available models, chooses a
compatible conversation agent automatically, and offers the selected model's
thinking choices when present. If a saved model is no longer available, the
draft shown in the cog moves to that provider's available default, then its
first available model, for the person to apply explicitly. If the saved provider
itself is unavailable, the draft offers a connected provider within the same
session engine and explains that Apply is required to reconnect. It never saves
that replacement merely because the picker opened. Up to six models
remain immediate buttons; a longer provider list becomes one searchable
autocomplete so the selector stays compact. When a host
exposes configurable model access, the owner sees the same warned unlock switch
as account settings. The cog also exposes a direct return to the host's
recommended model; relocking first moves the current session to that model, and
a session whose prior model was already relocked can still recover because the
target selection is checked independently. A provider-default thinking choice
delegates that setting to the provider instead of substituting another listed
choice.
Hosts may mark account-wide access controls as management-only; only their
enabled model results appear in the cog, while the control itself remains on
the host's account-management surface.
The new-session AI chooser is a separate, preloaded view of Vibe64's saved AI
connections. It presents one choice for Codex when connected and one choice for
each saved OpenCode route, using each connection's verified default model. It
orders a host-designated preferred provider first, so that choice is selected
when the dialog opens. It does not start OpenCode or read OpenCode's provider
and model catalogue when
the chooser opens or when the session is created; creation validates the
selection against the same saved connection view. A session keeps the
assistant engine that owns its native history: Codex cannot be changed to
OpenCode or vice versa. The explicitly opened chat selector may load a complete,
compatible model choice within that fixed engine. It remains available for
inspection during an active turn, but can apply a choice only between turns.
Creating a session does not load that catalogue. The mounted session selector
preloads it separately from provider/thread preparation. Distinct
OpenCode provider ids remain
distinct choices, so separate routes or plans from one provider can coexist and
be selected independently without becoming Codex. People can choose among
already connected AIs even when they cannot manage account connections; only
people who can manage connections see the shortcut to configure more. Loading,
retryable failures, and the absence of a connected AI remain visible in the
relevant selector.

Codex model choices use the running provider's paginated `model/list` catalogue,
including its display names and supported reasoning efforts. If no Codex service
is running, discovery starts one temporarily and verifies its shutdown before
returning. Configured-only new-session choices retain the configured default
without model discovery. Selected model and reasoning ids survive persistence
and turn mapping unchanged; selection validation uses the live catalogue.

Managed OpenCode requests allow up to 128K output tokens only when the selected
model advertises that capacity. A smaller advertised output limit remains
authoritative, while a missing or invalid limit retains OpenCode's 32K
fallback. OpenCode uses the same managed ceiling when reserving context for the
response and deciding when to compact the conversation.

The AI Terminal follows that fixed session engine without substituting another
one: Codex sessions expose a Codex terminal and OpenCode sessions expose an
OpenCode terminal. A person starts the interactive terminal explicitly and
sees the complete terminal rather than a collapsed status line. Closing it
terminates and hides the terminal, and a clean terminal exit such as Ctrl-D
hides it without affecting the durable conversation.

Opening the selected session view prepares that session's chosen provider and
native thread without sending a model prompt or loading the provider catalogue.
Creating a session by itself does not start a provider. Open sessions in one
workspace share a single running Codex service and a single running OpenCode
service according to the assistant each session has selected. Codex and
OpenCode remain independent: a provider service runs while
at least one matching session is open and stops after the final matching
session closes. On a managed host, the provider also remains attached to the
exact Vibe64 server controller that started it; if that controller disappears,
the provider's complete process tree stops rather than surviving as an orphan.
An OpenCode cold start gets one full readiness window rather than churning
through short-lived replacement processes. Prompt admission still happens only
after that service is ready. An immediate first message joins the same in-flight
provider and native-session preparation instead of starting either operation
again. A startup failure remains attached to the unsent message as a readable
retryable error rather than becoming a generic server response.
Conversation identity, working directory, command environment,
model settings, and provider history remain session-specific even though the
resident provider process is shared. Capability discovery without an open
session may run a bounded command but does not leave another provider service
running. OpenCode and Codex shell commands and any descendants they leave
running are attributed to the originating project session through their
ordinary provider command boundaries, and closing that session drains those
descendants.

Tool-free economy turns run without the session source lock, while provider
thread ownership and terminal admission still protect cleanup and renewal.
Environment inspection retains the same provider identity as interactive chat
without preparing the project again. Writable detached turns keep their source
lock. The economy compatibility gate accepts stable Codex versions at or above
`MINIMUM_CODEX_VERSION`, defined once in
`packages/vibe64-runtime/src/server/minimumCodexVersion.js`. Tests import
that minimum and derive version boundaries from it. Versions compare numerically
by major, minor and patch; newer releases need no allowlist update. Older or
unrecognised versions fail before configuration and hook inventory. Accepted
versions still pass the existing isolation checks, with shell, hook, plugin,
clock, sleep and context-budget features disabled. Model selection remains the
provider-owned Luna-low profile. Minimum-version acceptance does not prove that
every future Codex release preserves the tool-free execution contract.

Contextual prompt suggestions prioritize the current unsent draft, then recent
visible user and assistant messages, grounded in the session's Blueprint. Newer
user corrections supersede earlier plans. Suggestions should develop that
intent without inventing requirements or repeating finished or declined work.
The browser waits for a short typing pause, cancels superseded requests and
rejects late responses. Draft context is bounded to its latest 4,000 characters;
it is sent only to the tool-free suggestion helper, not saved as a chat message.
Cache identity includes the draft alongside the Blueprint and conversation.
An empty conversation still uses its Blueprint or draft; generic starters are
reserved for a session with none of those inputs.
Suggestions may preview their full text in an otherwise empty
composer without modifying the draft. Showing or hiding that preview preserves
the composer's geometry, while text the person actually enters still grows the
composer normally. Selecting a suggestion inserts ordinary editable text.
Suggestions must form a complete set of three valid, distinct label/prompt
pairs. Malformed or overfull responses are ignored, not displayed as a filtered
subset. The browser and server share the same normalization contract.

If an OpenCode provider later rejects a previously saved key, the failed turn
records a durable recovery notice that links the owner to AI Accounts without
exposing the raw provider credential error. Other structured OpenCode API
failures preserve the readable provider message and add the same durable
account-management route. Existing conversation and project changes remain
available for either failure, and the person can retry after the account is
recovered. Other OpenCode turn failures preserve their readable error in a
durable conversation notice without sending the person to account settings.

When Codex reports its exact structured usage-limit condition, the durable turn
outcome links directly to Codex usage and billing while preserving completed
project changes. Similar prose alone is not classified as quota exhaustion, so
an unrelated failure cannot gain an account link merely because of its wording.

## Implementation map

- `codexAppServerRuntimeOptionsForSession()` keeps the Codex process identity
  workspace-wide while carrying each session's directory and environment into
  its thread requests.
- `codexAppServerCommandBaseEnv()` and
  `normalizeCodexAppServerTerminalEnv()` pass the curated host and session
  environment explicitly while withholding the desktop message-bus variables
  that would let a descendant move itself out of the managed Codex execution
  scope. The command runner does not merge the host process environment again,
  and the managed startup shell repeats the exclusion at the final process
  boundary.
- `runCodexAuthPreflight()` recreates the private volatile runtime directory
  before using it, so a shared Codex service can start normally after a host
  reboot has cleared that directory.
- `withCodexAppServerProviderLifecycle()` serializes provider attachment,
  replacement, and final-runtime shutdown so concurrent session closes make
  one authoritative last-owner decision.
- `stopOwnedCodexAppServerExecution()` stops the exact managed Codex execution
  scope and can prove that scope empty after its ordinary resource-history
  record expires, without treating an unrelated process as the provider.
- `ensureSharedProcess()` and `stopProcessRecord()` own OpenCode's one-process
  lifecycle. Established session targets and pending starts both retain that
  process; directory-scoped clients and `Vibe64SessionEnvironment` preserve
  each session's working and command boundary. The shared process receives
  only Vibe64's bundled Genesis executable path; the environment plugin adds
  each session's command paths and private control identity when that session
  executes a tool.
- `safeOpenCodeEnvironment()` retains project configuration and plugins while
  disabling OpenCode's unrelated default plugins and loading Vibe64's
  session-environment plugin for command routing. It raises OpenCode's response
  and compaction ceiling only alongside that host plugin.
- `readOpenCodeCatalog()` starts a bounded temporary OpenCode service and reads
  its complete provider and agent APIs while the resident session service stays
  asleep. Its non-secret Zen `public` identity makes paid-model metadata visible
  without loading an owner's saved key. The client allowlists safe provider and
  model capability fields before they can enter the catalogue cache. That
  metadata is reconciled with the ids from Zen's bounded, credential-free
  public model endpoint before presentation or verification; a newly advertised
  id absent from the pinned metadata receives only a minimal safe fallback. The
  temporary service must be proven stopped before the result is returned.
- `openCodeConfiguredAssistantCapabilities()` projects saved connection labels,
  access descriptions, preferred-provider status, and verified default models
  into the new-session choices
  without consulting the live OpenCode catalogue. The configured-only
  capability and session-creation paths both use that projection, while
  `Vibe64AssistantSessionDialog` preloads it before the dialog opens.
- `verifyConnection()` checks the exact current provider and model before
  `verifyOpenCodeApiKey()` runs one finite, tool-free request in an isolated
  credential home. It omits provider URL overrides so OpenCode owns native
  routing, bounds time, output, and captured bytes, sanitizes failures, and
  removes the temporary credential root on every outcome.
- `Vibe64SessionEnvironment` presents ordinary shell commands rather than
  Vibe64's transport wrapper in the model-facing instructions and history. At
  execution it recognizes only canonical invocations of the session's exact
  trusted wrapper, removes any repeated copies, and applies that wrapper once;
  persisted provider history remains unchanged. It also clamps the raised
  response allowance to the selected model's advertised output limit and
  restores the 32K fallback when no valid limit is advertised.
- OpenCode's turn monitor detects a successful provider result with no text,
  queues one tool-free request for the missing final response, and records an
  explicit failure if that bounded recovery also returns no text.
- `prepareAgentSessionCommand()` publishes the authenticated session command
  broker. OpenCode's session environment plugin routes commands through that
  boundary before execution, and Codex's `PreToolUse` hook routes Bash commands
  through the same broker. The broker environment applies the same desktop
  message-bus exclusion so a session-owned descendant remains inside its
  managed execution scope.
- `Vibe64SessionRuntimeHost` selects exactly one interactive terminal from the
  session's immutable engine id and has no cross-engine fallback.
- `Vibe64SessionRuntime.renderPrompt()` owns Genesis prompt composition.
  Codex and OpenCode call it for the opening request and an explicitly marked
  Deslop request; later ordinary messages are sent without rebuilding the full
  Genesis prompt, and Codex steering continues through its existing direct
  steer path.
- `composeVibe64SessionContext()` uses one provider-neutral, session-only
  Vibe64 driver through Genesis for stable Vibe64 conversation rules.
- `sendCodexAppServerPromptForSession()` and `stablePromptBody()` preserve the
  authored user text without attaching Vibe64 turn context.
- `writeMirroredCodexAppServerTerminalMessage()` copies the latest prior UI
  user's existing actor metadata onto a native-terminal user item in History;
  it does not alter provider input.
- `sendCodexAppServerMessage()` recognizes only the provider's exact
  missing-thread response for an inactive conversation and routes it through
  `ensureCodexAppServerThreadForSession()` so its existing replacement,
  durable-history recovery, and identity update complete before the pending
  message starts the new ordinary turn.
- `startAttachedTerminal()` attaches OpenCode's native TUI to the session's
  existing upstream history in a session-owned PTY. The OpenCode controller
  owns its bounded snapshot, stream, input, resize, close, and session cleanup;
  ordinary input transport does not repeat assistant-selection authorization.
- `helperOperationForRequest()` keeps assistant PTYs on the project command
  policy instead of the home-only account-login policy, and maps both the
  resident OpenCode service and its credential-free catalogue service to the
  constrained OpenCode provider-workspace policy.
- `resolveAllowedCwd()` admits only the exact Codex or OpenCode provider
  workspace beneath either the hosted workspace runtime or the target OS
  user's per-user runtime, covering hosted services and standalone local use
  without granting general access outside managed project roots.
- `runManagedExecutionPayload()` holds a managed service's controller lease and
  terminates the detached service process group if that lease closes.
- `vite.config.mjs` temporarily preserves xterm identifiers and syntax because
  re-minifying xterm 6.0.0 breaks terminal query parsing under
  xtermjs/xterm.js#5800. Remove the workaround after Vibe64 upgrades to a fixed
  xterm release.

Inline integration requests also expose Connect. The conversation client reads
the saved project configuration, invokes the existing app-owned setup command
with the exact request and configuration hash, and offers the returned consent
link plus Check connection and Cancel. Cancel names the current attempt and
then reads status so an older grant remains visible. Per-user accounts direct
the operator to the application's account flow. Server-confirmed completion
uses the existing continuation action. When the card becomes visible after navigation or reload, it requests app
status once for each pending request, sequentially. This restores the current
consent link without creating another attempt or persisting it in browser
storage. Archived/hidden cards do not initiate recovery. Check connection uses
status too; only Connect may start a new attempt.

If continuation delivery is unconfirmed, the card retains the completed
connection, reports the continuation error and reloads the durable request.
A configuration read returning after session navigation cannot start Connect
for the session the user left. Focused conversation-client fixtures cover both
boundaries without running provider calls or browsers.

A controlled expanded-browser journey verifies inline Connect, consent recovery
after reload, cancellation, reconnect and one accepted continuation against the
built UI. Provider consent itself is simulated; this is editor interaction
evidence, not live OAuth or native assistant admission proof.

The Genesis session prompt describes the same Configure/Connect/Skip contract:
the final block must name a saved slot, cannot carry secrets or consent URLs,
and does not itself authorize connection. The assistant waits for the separate
server-confirmed setup continuation before treating the account as connected.

Integration continuation enters the ordinary session agent-write boundary before
reading the setup request or consulting a provider. A focused real-store fixture
checks archived and renewal-quiesced sessions: both reject admission and retain
the pending continuation unchanged. No separate integration lifecycle bypass
is available for an old session.


The shared goal control can create a Codex goal with an objective and optional
positive token budget. Vibe64 validates the displayed thread and any completed
goal being replaced, prepares the ordinary main thread if necessary, and
attaches its observer before activation. Creation uses the same agent-write
coordination as Resume. An observation-stopped conversation requires explicit
Resume/Send before a new goal; goal creation does not bypass that stop barrier.
The shared model chooser, file queue, sent-file list, preview and question inputs
provide presentation. Vibe64 retains native model/account policy, authorized
attachment URLs and accepted-file retention, question submission ownership,
favourite files, project access and operation admission.
