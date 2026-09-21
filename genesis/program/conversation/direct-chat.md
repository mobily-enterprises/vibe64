# Direct agent conversation

People work with the coding agent through one ordinary project conversation,
including follow-up guidance while a turn is active.
The Settings cog stays on the same horizontal centerline as the neighboring icons.
It labels the next recipient underneath without shifting the icon, increasing
the button height or adding a tooltip. The session store
snapshots the assistant selection on a new turn. History preserves that snapshot
through normalization, and the adapter supplies per-turn labels and hover details
to the shared transcript. Replies without a saved selection display "agent";
old history is not backfilled.
Composer spacing closes in narrow panes so the companion control does not push
Send onto another row when the controls themselves fit.
OpenCode waits for its project event connection before sending, allowing cold
initialization up to two minutes. A pre-send connection timeout is retryable.
Each attempt retains its own failure notice, so resending the same message
cannot hide a later provider rejection behind the earlier connection failure.
Existing assistant status and message-delivery diagnostics include the requesting
user's authenticated username when supplied by the host. Request context takes
precedence over operation options; background work without an actor records
`username: null`. Logs do not include the user's credentials or message text.

The shared transcript groups adjacent reasoning summaries across storage rows.
User messages, commentary, answers and system messages separate progress groups.
Vibe64 supplies the existing active execution state as `conversation.working`;
the renderer previews only trailing progress while working. No provider-turn
association or history rewrite is required for grouping, including goal
continuation and loading older history.

Undo last turn is a main-conversation command, available while idle. Its saved
target identifies the latest user prompt and every following reply/activity row.
The preceding user turn must use the same current assistant application; the
first turn after an application switch cannot be removed. Changing a model
within that application does not create a boundary. The confirmation states
that project files and databases remain unchanged, and the removed prompt
prefills only an empty composer.

The existing main assistant write lock serializes Undo with Send. A saved
`assistant_changeover.rewind` boundary precedes native mutation. Claude uses
`rewind_conversation`; history reads follow its durable `last-prompt` resume
anchor. Codex App Server uses `thread/revert` with the exact excluded native turn;
a turn containing steering cannot be represented as one visible prompt and is
rejected before mutation. OpenCode deletes the exact tail message IDs in reverse
order through its conversation-only endpoint. Each provider checks the saved
boundary on retry, so a lost reply cannot remove another exchange. Older
non-paginated Codex threads reject Undo before mutation.

The filesystem adapter retains undone message files and their IDs, excluding
the listed rows in `conversation-log/rewound.json` from active history. This
preserves deduplication and prevents ID reuse or later AI catchup from restoring
the removed exchange. Pending Undo is exposed with the history response after
reload and blocks Send, AI changeover and goal restart until native and stored
history agree. Rewind publishes `conversation-rewound`, not a turn-idle event,
so it does not trigger workspace preparation. The action does not restore Git,
run project setup, execute tools, or touch the project's database.
Integration setup requests in discarded turns cannot be resumed from an old tab.

The filesystem transcript maintains `conversation-log/message-ids.json` for
duplicate delivery checks. Ordinary checks read this index instead of walking
every historical turn. Transcript writes invalidate it before changing message
files and publish it afterward under the session mutation lock; missing or
damaged indexes rebuild from message filenames, including undone turns. Nested
transcript writes share the existing mutation queue so concurrent participants
cannot overwrite each other's receipts. AI changeover still compares transcript
contents to preserve corrections and missed history.

Session detail has its own query key, so a realtime detail refresh does not also
invalidate access, suggestions and renewal queries. Session lists ignore events
identified as belonging to another project. Deleting a temporary Claude chat
removes its metadata record instead of accumulating empty files that every
session read would reopen.

## Sources

- `src/App.vue`
- `src/composables/useVibe64InAppLinks.js`
- `tests/server/inAppLinks.unit.test.js`
- `src/components/studio/vibe64-session/Vibe64AgentPlanUsage.vue`
- `packages/vibe64-terminals/src/server/agent/providers/claudeSessionAgentProvider.js`
- `packages/vibe64-terminals/src/server/claudeCodeProcess.js`
- `packages/vibe64-terminals/src/server/claudeConversationHistory.js`
- `packages/vibe64-terminals/src/server/claudeStdioBridge.js`
- `packages/vibe64-runtime/src/server/claudeStreamJson.js`

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
- `packages/vibe64-runtime/src/server/agentSessionCommandHook.js`
- `packages/vibe64-execution/src/host/execHelper.js`
- `packages/vibe64-execution/src/server/request.js`
- `packages/vibe64-execution/src/server/runVibe64Command.js`
- `packages/vibe64-execution/src/server/engines/helperClient.js`
- `packages/vibe64-execution/src/server/engines/capture.js`
- `packages/vibe64-execution/src/server/result.js`
- `packages/vibe64-terminals/src/server/codexGitCommand.js`
- `packages/vibe64-terminals/src/server/unixJsonCommand.js`
- `packages/vibe64-terminals/src/server/agentPreviewCommand.js`
- `packages/vibe64-terminals/src/server/agentEnvCommand.js`
- `packages/vibe64-terminals/src/server/agentDatabaseCommand.js`
- `packages/vibe64-execution/src/server/runtime/agentPreviewWrapperSource.js`
- `packages/vibe64-terminals/src/server/agentCommandEnvironment.js`
- `packages/vibe64-terminals/src/server/agentHelperCommand.js`
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
- `tests/server/opencodeReasoningSummaries.unit.test.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-terminals/src/server/assistantChangeover.js`
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
- `src/components/studio/Vibe64NativeAgentSession.vue`
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

Claude Code uses the unmodified pinned CLI and a bounded streaming JSON reader
inside the existing managed execution owner. Control replies bypass ordered,
bounded chat-event persistence so streaming output cannot block an interrupt
acknowledgement. Claude request and admission waits use a 30-second deadline;
the duration of an assistant task is governed separately. Native admission acknowledgements
and message IDs prevent duplicate sends. Steer interrupts generation before
continuing the same native conversation with the new instruction. Stop verifies
that the owned process scope exited; the next Send resumes native history.
Account identity is persisted with conversation ownership, so a restart preserves
the binding and another signed-in account cannot adopt it. Native terminal and
JSON chat have one writer at a time. JSON sessions explicitly request native
thinking summaries with `--thinking-display summarized`; newer models otherwise
return empty thinking text. Exposed thinking and answers use the shared
transcript. Native frame UUIDs keep thinking and answer blocks distinct when
they share an API message ID, including after history reload. Tool commands
enter the existing session command broker.
Older session snapshots reuse the already-owned main Claude conversation.
The launcher identifies Claude's own PID for startup Git probes that leave stdin
open, so those probes cannot stall session preparation or the first prompt.
Shell-tool pipelines still forward their input through the normal Git broker.
The chat control labels Claude by name.
If Claude cannot produce a renewal handover, the shared renewal flow opens its
editable manual handover instead. The original conversation stays intact while
the user reviews the context to carry into the successor session.

Claude uses the shared in-chat model and effort selector. Idle conversations
apply model and effort changes through native JSON controls without restarting
the process. A rejected settings change retires the process before another Send.
The chat toolbar also
shows native goals and subscription allowance. Goals use `/goal` commands,
structured history markers, and `active_goal` refresh events. Pause stops the
current turn while retaining the goal; Resume starts native goal work again.
Cancel stops work and clears the native goal. Claude's form omits token budgets
because the CLI does not provide Codex's hard token-budget control. The pinned
CLI's experimental `get_usage` JSON control supplies current five-hour, weekly,
and available model-specific windows. Missing or expired data is never presented
as a refreshed allowance. Both controls retain the assistant's access boundary;
plan allowance is owner-only. Passive goal and allowance lookup failures stay
local to those controls and do not report an app-wide network outage.

The shared command environment installs `vibe64-helper` beside the existing
session executables for Codex and OpenCode. Its fixed groups are `preview`,
`playwright`, `env`, `database` and `github`; `--help` lists them, and group help
comes from the existing command owner. The dispatcher replaces itself with
the matching sibling executable, preserving stdin, argv, environment, cwd,
exit status and signal handling. Missing groups fail without searching PATH
for a substitute. Each underlying command retains its session binding and
authorization. The individual executables stay installed for existing
conversations and scripts; new session guidance uses the common entry point.
The ordinary `vibe64` launcher, managed `git`/`gh`, and internal process helpers
retain their existing roles.

The chat column, empty-session column and divider use the same resize width.
The resize controller owns the 512-pixel desktop minimum and default. Dragging,
keyboard resizing and restoring older saved widths all respect that minimum;
the layout does not impose another minimum.

JSKIT owns the suggestion and working-status presentation, debounced suggestion
lifecycle, model-choice controls, goal controls, upload queue, and upload lifecycle.
Vibe64 supplies native state and actions, project-aware suggestion requests,
connected-provider policies, upload storage, attachment opening, and favourite files.
The main composer groups Add, Settings, Goal, weekly
allowance, and icon-only Send, with Stop alongside Send while needed. Goal and
available allowance stay visible outside the menus. Its empty textbox uses one
compact row and still grows with entered text. Add contains left-aligned file,
preview, and diagnostics attachment actions. The Settings cog opens the
model/access selector directly, including recovery guidance and pending message
requests even while its catalogue is unavailable. The host tools target sits
immediately after Settings in the composer row, followed by the icon-only
starred-files menu, and remains mounted independently of Settings. Composer icon
spacing grows with the chat pane's width, within a compact upper limit. The
desktop minimum keeps Send and Stop on the same row as the other controls,
including the host avatar, goal timer and allowance. On narrow screens the chat
uses the full available width and controls can wrap to remain accessible.
Recovery guidance appears inside Settings,
with an attention badge on its button. Continue uses ordinary message delivery;
an existing draft or attachments are kept for review instead of being sent.
The goal popover shows a bounded objective preview beside the existing status
and Pause/Resume/Cancel controls. View full goal opens the exact instruction in a
scrollable dialog with a fixed Close action. Preview truncation affects only
presentation; goal updates still identify the complete original objective.
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

JSKIT's `createConversationStreams` accumulates live Codex deltas and OpenCode's
existing 250 ms message snapshots outside durable history. Vibe64 admits Codex
events under the session lock against the current native thread and turn, supplies
project/session scope and saved message identities, and broadcasts snapshots on
its existing realtime channel. The history read includes the current snapshot
for browser reconnects. The client uses JSKIT's `mergeConversationStream` and
ignores older revisions; chunk events do not refetch history or session details.
The session notification queue combines adjacent text fragments still waiting
for delivery, so a slow authenticated broadcast does not create one pending
storage operation per fragment. Reasoning, completion and turn-state events end
the batch and preserve provider order. Text and reasoning notification handlers
read the agent-run record without hydrating the full session history.
Successful persistence replaces the live item. Stop and verified observation loss
clear unfinished output. Saved replies retain their recovery authority, and a
server-process restart relies on native history rather than a second partial log.

The Codex indicator reads the current main conversation goal from `thread/goal/get`
on its existing provider. Goal controls require assistant access and accept only
pause/resume/cancel on that session's current thread and unchanged objective/creation
identity. Status-only `thread/goal/set` preserves Codex-owned objective, budget
and usage history. Pause prevents further automatic turns without interrupting
the current turn or releasing its write ownership; Stop still interrupts work.
Resume uses Codex's native goal scheduler. Completed goals and exhausted token
budgets are not restarted by this control. Cancel uses `thread/goal/clear` for
any unfinished goal, including blocked and budget-limited goals. It removes the
goal without resuming the thread, marking the objective complete, interrupting
the current turn, or deleting conversation history. The existing goal-cleared
reconciliation updates run state and lets the UI offer a new goal. Goal notifications invalidate the
protected read endpoint without broadcasting the objective. The same square
retains weekly allowance and exposes goal controls independently of plan data.

When reconnecting to a native goal continuation, live thread activity takes
precedence over a terminal status in turn history. History can lag while the
resumed turn prepares its context. The main-thread bridge requires an observer
before native resume, and provider observers survive replacement of the socket.
Thread preparation and reconnection restore the saved assistant selection and
request concise reasoning summaries in the thread configuration, including when
Codex resumes a goal before the next explicit message. Model capability rules and
explicit isolation settings still apply.
The interactive Codex app-server starts with explicit `approval_policy="never"`
and `sandbox_mode="danger-full-access"` configuration overrides. Codex does not
apply its top-level sandbox bypass flag to app-server defaults. Setting those
defaults prevents native work restored without per-turn overrides from falling
back to a network-disabled sandbox that denies managed command sockets. Economy
startup retains its separate isolation. The native paginated-history test runs
the production launcher and verifies the effective defaults and automatic goal
continuation permissions after a cold restart.
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


Managed tool readiness includes the live Git, shell, Preview and Env control
identities, not only native thread observation. The provider records the environment
bound to each thread. Listener replacement or a valid stale-generation request
triggers one serialized check through that owner; account credentials and Env values
never enter lifecycle logs. Logs correlate session, socket, control generation,
native thread, connection generation, replacement/rejection and recovery outcome.

Codex can retain an old shell environment across an already-loaded resume. To
change it, Vibe64 pauses an active goal, confirms that its turn stopped, detaches
and resumes the same thread, then proves the effective managed environment with a
bounded native shell digest check and authenticates its live control health routes.
The check uses no model, prints no environment values and is excluded from live
chat turn reconciliation; its shell record remains in native history. Another
native subscriber can retain the old environment, so unsubscribe alone is never
readiness proof. Failed verification leaves work stopped with an actionable error.
Only the same goal paused by this recovery may continue, and a concurrent explicit
Pause or goal change wins. Recovery does not replay a human prompt or tool command.

Session command-environment preparation and closure share a project-scoped admission
boundary. Closure drains admitted preparation and rejects overlapping acquisitions,
stops the assistant before retiring its controls, and uses retained provider identity
rather than preparing controls during cleanup. Browser reconnect checks reuse a
healthy binding. Restricted helpers retain their explicitly empty environment.
The focused managed-control regression includes the actual native CLI with a local
model fixture, a second subscriber, interrupted goals and preserved files/history.

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
Connection acquisition retries a cached observation failure through that same
stop owner. Concurrent attempts share the pending stop; a failed retry retains
the barrier. After a verified stop, acquisition uses the retained healthy provider
or its normally acquired replacement. It does not replay a message or resume a
goal; explicit Send/Resume still owns continuation.
Each provider retains the exact runtime identity acquired during startup through
failed cleanup and connection disposal. If its runtime metadata was removed or
replaced by another owner, shutdown verifies that retained execution through the
existing execution gateway without deleting or stopping the replacement. Missing
files alone are never exit proof; a provider without an identifiable owner stays
blocked. Verified shutdown remains available to later cleanup retries until the
provider acquires a new runtime.
Normal redacted operational logs retain the original observation cause and any
stop failure separately, without requiring session-debug logging.
Startup and ordinary connection checks also reconcile a persisted active
observation-loss barrier, including one missing its turn identity. Under the
agent-write lock, the controller uses the session's known conversation to read
native goal and thread status without resuming it. Only confirmed idle/unloaded
status with no active goal releases the unchanged record; failed reads, unknown
status, missing identity and newer state retain the barrier. The recovered stop
is persisted and broadcast, releasing Save and Update while retaining explicit
Send/Resume for further assistant work.
Save and Update share the repository-write guard: when persisted state is busy,
it calls the selected provider's existing session check and rereads durable
activity under the agent-write lock before admitting a repository mutation.
OpenCode's connection check similarly releases an observation-loss record only
after its native session reports idle and no local monitor owns the turn. It
retains a changed record or failed/unknown status and updates both durable and
in-memory activity after recovery. Its startup stop verification remains in use.

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

Managed `git` and `gh` share a thirty-second budget across credential lookup and
the requested command. The command service deducts elapsed preparation and lookup
time before each gateway call and refuses to start the next call after expiry.
The existing execution gateway owns termination and verified cleanup; admission
and cleanup can extend wall-clock response time. The Unix socket wrapper limits
connection establishment to the existing two-second health budget, with no
competing response-inactivity timeout. An executor timeout stays a timeout,
including during credential lookup. Missing control preserves its transport
errno, stale identity remains distinct, and a lost connected response explicitly
leaves the command outcome unknown. No command is retried automatically. Timeout
diagnostics are appended even when a failed command emitted stderr. The existing
completion event records the stage, timeout flag, underlying failure code and
execution identity when available; credential output is never returned or logged.
Platform-failure stderr also carries a bounded diagnostic with that stage,
underlying code, thirty-second budget, elapsed time and execution reference
(explicitly null when none exists). `commandSubmitted=false` proves the requested
Git/gh action never reached the executor; true records submission, not successful
startup or completion. Credential-lookup timeouts retain their specific message.
Expired pre-submission budgets likewise report that the requested command was not
submitted. Execution timeouts and lost, unreadable or incomplete responses leave
effects unconfirmed and require a read-only state check before repeating a write.
Malformed response envelopes cannot become successful empty command results.
Success and ordinary Git nonzero exits retain their original byte streams;
platform failures append the diagnostic without replacing captured output.

The provider-neutral managed Git session instructions require user-facing
reports to name the failed action, earlier confirmed work, remaining undone or
unconfirmed work and the next safe step. They retain supplied diagnostic references
and distinguish facts from hypotheses, without inferring an authentication,
quota, GitHub-service or suspension cause from a timeout. Reconnection is suggested
only when the reported error calls for it. Main and temporary chats receive the
same rule through their existing context lifecycle; no extra model turn or
automatic retry is introduced. Contract tests verify the supplied instructions,
not that every generated model reply will follow them.

The conversation accepts messages, structured answers, attachments, and
steering guidance. It streams commentary and the final response, persists the
conversation in order, restores it after reconnection, and lets the person
interrupt the current turn without deleting the session. Agent questions may
be answered as free text or through suggested choices while the submitted
reply remains ordinary conversation text.
Numbered question labels and their suggested choices use the shared inline
Markdown renderer, preserving bold text, code, and links without interpreting
raw HTML. Their file links use the same source-editor navigation as prose.
The application shell handles otherwise-unclaimed ordinary anchor clicks through
Vue Router when their same-origin URL matches a registered page. Root-relative
paths and full URLs preserve their query and fragment without reloading the
document. This applies to rendered Markdown and teleported dialogs as well as
ordinary page content. The shell's not-found route does not turn API, download
or unknown URLs into app navigation. Modified clicks, explicit targets,
downloads, external links and component-handled file links keep their existing
owners. The document listener is removed when the shell unmounts.
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
OpenCode creates its own native conversation ID. The controller persists it as
`opencode_conversation_id`, separately from the currently selected application's
identity, and uses it for resume, event observation, and the system-prompt registry.
Its native database lives in the persistent service data directory, outside the
temporary process directory removed by daemon restarts.
Sessions without this saved identity start a fresh native conversation; old
caller-supplied IDs are not reused or migrated.
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
agent-write lock. Attachment uploads wait up to sixty seconds for that lock and
retain it so renewal cannot freeze and clean up a session while an upload is
writing. Admission rechecks the session after waiting, so renewal or archive
cannot be bypassed by a queued upload. Vibe64 configures JSKIT's shared attachment
queue for one upload at a time, matching this storage boundary; selected files
appear immediately as queued and proceed automatically. Concurrent requests from
other composers wait at the same server boundary. Provider checks discard late
responses when their session or connection has closed or changed. Codex helper
ownership restoration belongs to startup reconciliation and helper operations,
not main-conversation readiness.
Codex readiness acquires its provider runtime outside the session mutation lock,
while retaining preparation's agent-write admission. Disconnect cleanup may need
to write that same session, so runtime acquisition must not wait for cleanup
while holding its mutation lock. Thread preparation rechecks the session under
the startup gate after acquisition. Observation loss still stops and records
active work and active goals, but preserves completed main and temporary turns.
Codex runtime preparation is shared by runtime directory across session providers;
waiting callers recheck their own authentication and configuration before reuse.
Runtime-lock contention is a retryable reconnect, not observation loss: it retains
the provider and active run, schedules managed-thread recovery, and never invokes
the shared runtime stop procedure merely because another startup holds the lock.
Once an idle process has been verified stopped, the next automatic connection
check can recreate it and resume the existing conversation without replaying a
message or requiring an explicit Resume.

The browser coalesces checks for the same
connection and retries failures after one second, backing off to thirty seconds.
It retains the reported failure in the connection notice until a successful
check. A control-socket path configuration error stops timed retries and shows
the repair instruction beside explicit Retry, preserving the draft.
Git, session shell, Env, database, preview and browser command sockets use compact,
process-user-scoped names in the server temporary directory. Their identities
include the full wrapper path and control kind, keeping projects and sessions
separate without placing a long workspace path in the socket address. The shared
path builder checks the OS byte limit before binding; an oversized configured
temporary root reports `vibe64_agent_control_path_too_long` with a repair action.
An unavailable AI connection is a separate account-attention state: it stops
timed retries, explains that Codex needs sign-in (or that the selected account or
model is unavailable), and offers Open AI Accounts through the existing account
dialog. Account-change events recheck readiness, including when they arrive
during an older check. Drafts remain intact and no message is sent automatically.
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
Codex installs it as thread instructions, Claude appends it to the system prompt
when launching its native process, and OpenCode keeps it in the system context
through Genesis's ordinary project plugin. It creates no conversation
message or additional agent turn. Collaboration changes become current only
when that stable context is next established or refreshed; Codex cannot replace
developer instructions inside an already-live thread.
The provider may serialize its system or developer instructions again for a
later stateless model request, but Vibe64 does not rerender them into the
person's message or copy them into the turn-context lane.

Codex restores missing startup instructions at the shared cold-resume boundary,
before native resume can schedule a goal turn. A cold thread alone is insufficient:
restoration also requires a newly started runtime or a changed managed execution
identity. Session identity metadata records that execution id; older metadata can
prove replacement when the current process started after the saved attachment.
A replacement socket or stale command generation does not trigger this instruction
resolver. Supplied instructions are retained, including renewal and temporary-chat
context. The resolver fills omitted instructions from the existing session composer
and includes the current thread settings and hook trust configuration.
Claude uses the same complete session composer for JSON and native-terminal
launches after the prior owned execution has been verified stopped. Reusing its
live process returns before composing instructions. Neither provider replays the
person's opening request or creates an extra conversation turn for this restoration.

The Vibe64 Genesis hook executable grants Git trust only to the registered
OpenCode provider session's exact working directory when invoked from that
directory. Native children carry verified parent ids from the Genesis adapter
so the same registered worktree remains trusted. Unregistered sessions and other worktrees keep Genesis's ordinary
ownership checks. This uses the same scoped compiler trust operation as
Vibe64's in-process inspections, without global Git configuration or ownership
changes.
The OpenCode runtime plugin imports only the prompt formatter from the Genesis
boundary, so formatting host context does not load the compiler's native source
parsers into OpenCode's Bun process. Genesis hooks still run through the separate
Node executable. Hosted OpenCode explicitly disables the unused Genesis turn
lane with `GENESIS_TURN_CONTEXT_ENABLED=0`. Idle session preparation refreshes
the generated OpenCode adapter through Genesis's scoped synchronization API
under source-write admission, independently of authored project migration.
An already-loaded older adapter takes the same disabled-lane fast exit in the
managed command shim before compiler loading or Git inspection. The refreshed
adapter itself becomes active on the next provider instance load.

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

Main and temporary chat share JSKIT's `createAssistantMessageDelivery` controller
for optimistic entries, failed sends and canonical receipt matching. Vibe64
supplies its native transport, admission policy and authoritative receipt watcher;
the shared controller has no Vibe64 session or provider dependency. Active-turn
steering opts into its ordered delivery queue. Each submission immediately clears
its draft into a Pending bubble, and the composer stays available for further
text guidance. Transport acceptance or the exact durable receipt advances the
queue. Failures remain in their own bubbles with Retry, retaining the payload and
message ID; later guidance and newer drafts remain intact. Retiring a conversation
discards its unsent queue so it cannot send into a replacement session. This
browser-memory queue does not persist unsent messages across a browser reload.
Message delivery and provider work remain visibly distinct. The composer shows
the initial send while the message is being accepted, then reports the selected
assistant as working for the rest of the active turn. The session tab and
assistant avatar use that same live turn state until completion or interruption.
New Send and Steer submissions clear the draft immediately. Their pending
conversation entry retains the submitted text, and later delivery leaves any
new draft untouched. A rejected Steer restores its original text only when the
composer is still empty and no newer submission exists; otherwise its failed entry keeps the Retry and Edit
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
itself is unavailable, the draft offers another connected application/provider
and explains that Apply is required to reconnect. It never saves
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
Applying an engine change checks destination access, stops the old controller
under the existing session write lock, and preserves native history. It does
not need the old account to authorize a new prompt. Codex retains its thread id
and workdir independently of the currently selected engine; OpenCode keeps its
existing deterministic native session id. Returning Codex goals are paused
before native resume, which can otherwise start a goal automatically. After
work in another engine, an ordinary Send must catch Codex up before Goal can
start or resume work.

The ordinary Send path reads the canonical stored bubbles and prepends the
changeover context to that same user request. A new engine receives the latest
30 visible messages; a returning engine receives every missed or corrected
message and the identities of removed messages. User messages, answers,
commentary and system notices supply the context; there is no separate summary
or acknowledgement turn. The visible user bubble retains the authored text and
attachments. The filesystem transcript preserves engine attribution and the
original content fingerprints at message creation, so even an immediate edit
before the engine's next Send is detectable. Corrections preserve those original
fingerprints; existing answers acquire one before their first correction. One
`assistant_changeover` metadata record tracks each engine's received content
fingerprints. Edits to older bubbles therefore remain detectable across any
number of switches and server restarts.

While delivering a changeover request, that record freezes its message id,
prompt, attachments and history snapshot. Each adapter records the native
thread immediately before sending. An explicit native rejection permits retry;
an uncertain receipt is checked against the native message id without replay.
Unconfirmed delivery remains a visible error and does not prevent selecting
another engine. Receipt recovery restores the authored bubble and advances only
the snapshot actually delivered. Operational logs record preparation, acceptance
and uncertainty with engine/thread/message ids and counts, never prompt text.
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
The shared OpenCode configuration defines economy subagents for connected
providers, while task admission and native chat/model hooks restrict use to the
registered parent's selected provider and configured Helper model. Resuming a
helper from another parent is rejected. The plugin resolves native child
`parentID` ancestry for command control, history unwrapping and host capabilities;
unknown or unverifiable ancestry fails closed. Helpers gain no extra account or
command permissions.
OpenCode progress broadcasts coalesce to at most one per second per session,
with the first state published immediately. A meaningful reasoning sentence or
completed part can queue one bounded, tool-free summary through the selected
Helper model. Streaming and final projection share turn-owned entries, so
replayed parts never submit duplicate requests and initial partial words do not
consume a part. The existing completion reader waits for the helper's finished
answer. Main completion persists any missing mechanical headlines before its
answer without waiting for a model request. Turn closure cancels outstanding
summaries and deletes the native helper session; failed deletion remains tracked
for retry on session closure. Full provider reasoning is not persisted.

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
Genesis hook failures format their structured scope, timeout/exit/signal,
elapsed time and bounded stderr into that notice, with a runtime-repair/retry
instruction. Legacy hook failures identify the missing diagnostics and leave
timeout unconfirmed, instead of displaying a Bun stack.

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
