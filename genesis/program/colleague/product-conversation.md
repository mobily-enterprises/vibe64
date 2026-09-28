# Colleague product conversation

Colleague gives the user a continuing conversation for discussing intentions and
operating Vibe64, independently of any development session.

Colleague can inspect the actor's configured coding destinations and change the
requested session's chat mode or assistant through the existing selection action.
Its bounded inspection distinguishes saved `chatMode`, workflow and review
preferences from the mode of the previous/current routing request and its selected
model. Changing preferences alone does not send work or claim that a running
model changed. Mode inputs expose Senior, Junior and Auto explicitly; the service
retains goal, access, pending-work and engine-changeover guards. The access
projection reports configured roles, effective selections, Backup use and missing
prerequisites without connection bindings or execution profiles.

Colleague reads Main's Auto work plan through its canonical paged action. It
must finish all pages of one revision before describing the complete document;
a changed revision restarts the read. Only the user's approval authorizes sending
that exact revision as `planRevision` through ordinary Main Send. Readiness,
active work, role, goal and access checks remain in the existing routing owner.

## Sources

- `packages/vibe64-colleague/src/server/Vibe64ColleagueProvider.js`
- `packages/vibe64-colleague/src/server/actions.js`
- `packages/vibe64-colleague/src/server/service.js`
- `packages/vibe64-colleague/src/server/attention.js`
- `packages/vibe64-colleague/src/server/conversationSummary.js`
- `packages/vibe64-colleague/src/server/protocol.js`
- `packages/vibe64-core/src/server/actionContext.js`
- `packages/vibe64-colleague/src/client/Vibe64Colleague.vue`
- `src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue`
- `src/composables/useVibe64AssistantCatalog.js`
- `src/lib/studioUrls.js`
- `src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue`
- `packages/vibe64-terminals/src/server/agent/providers/claudeSessionAgentProvider.js`

## Public contract

The server exposes state, focus, message admission, stop and context operations.
A host authenticates the person at the shared action boundary; public local mode
uses its local identity. Separate people have separate state. New conversations
use a private empty native scope and an accessible configured Senior model. They
have no repository context or coding tools. Product operations use JSKIT's native
action catalogue and each operation's own authorization, validation and results.
The shared project context accepts deleting projects only when the operation
declares that lifecycle scope; callers cannot grant it through input fields.
Only completed, validated model envelopes can request a tool. Malformed replies
have a bounded correction opportunity and never execute embedded prose.

The feature stores canonical JSKIT transcript data, native conversation identity,
model selection and its most recent operation receipt under private application
state. A known message ID is admitted once. Each tool receipt is saved before
execution and again with its result. A restart during execution reports an unknown
outcome and does not retry that operation. Credentials and HTTP requests are never
persisted. A fresh authenticated request is required to continue after restart.

An accepted request captures its UI focus. Subsequent navigation does not silently
redirect its operations. New steering can arrive while a model response is active;
code checks it before dispatching that response's tool. Stopping Colleague stops
its native turn and preserves history; it does not operate a coding-session Stop
or any audio playback. Tools themselves retain their ordinary cancellation rules.
New steering carries its own captured focus into the next decision boundary;
merely opening a different project does not change an earlier request's target.

The host can mount the reusable text drawer outside routed project content.
Its shared chat element accepts messages and steering while a turn is active.
The host supplies the existing avatar, optional persistent voice controls and
display name (default Colleague). The service accepts a host-owned name resolver
and includes its current value as data in each model turn. Changing the name
updates labels and future replies without replacing native history or typed drafts.
The drawer fits the available viewport width, including when a classic scrollbar
is present. Its minimize, model and watch controls have 48-pixel touch targets.
Voice submissions use the same message-ID admission as text, carry their
recording's original focus, and never alter the typed draft. Colleague's API stays global when the
selected project changes. Opening a view sends a command only to the initiating
browser; the actual router and conversation owners acknowledge its result.
An unacknowledged or failed navigation is reported as failure, not completion.
Connection failures use the existing footer status and clear on a current
successful refresh. Stale failed reads cannot restore a recovered error.
Command and model failures use shared transient action feedback without adding
an error block to the drawer; an unchanged retained model error is not announced
again on every poll. Failed text submission preserves its draft and retry identity.

Retained Claude scopes save their native identity, account binding, execution
reference and turn state atomically under their private runtime root. Restoring
a scope observes and stops an orphaned execution before continuing; it never
resends a saved request. This does not create or mutate development sessions.
Previously unpersisted scopes remain unavailable rather than being guessed from
native history. Ordinary one-shot helpers do not create these retained records.

The model button reuses the existing model picker and actor-aware capability
catalogue through a global route to the same catalogue action. No coding session
is needed. `model.select` resolves the current catalogue choice and checks access
before saving it. Active work and unresolved native turns prevent switching;
stopping the previous turn makes switching available. A switch retains the
product transcript and identity, starts no inference, and creates a fresh native
conversation on the next message. That first turn receives the latest 24 written
messages, each bounded to 2,000 characters. Previous private native records remain
in the user's scope; they are not reused by the new selection. The current choice
survives restart and does not change coding-session routing.

Conversation watches are ordinary create/list/cancel/resume actions. Each user
can retain up to 16 active or paused watches, with exact project/session and
optional temporary-conversation identity. Conditions cover completed replies,
finished turns and explicit attention states; failures are reported for every
condition. An existing completed answer is reported immediately. Quiet output
does not imply that an agent is blocked. One-shot watches retire after delivery;
ongoing watches compare run, message and status cursors to suppress duplicates.

The existing session event bus schedules coalesced reads outside the publisher's
write lock. A 30-second code-only reconciliation catches missing events while a
watch is active. No watches, unrelated events, unchanged state and partial tokens
start no model calls. Watches and pending observations persist, but credentials
do not. Reads resume after authentication, recheck target access, and pause visibly
on a read failure. Resume reconciles from the retained cursor. Notifications also
recheck project access before sending their bounded observation to the model.

Updates wait for a decision boundary when Colleague is busy. Autonomous reports
use the same JSKIT catalogue filtered to query actions, so they cannot assign
work or stop an agent. New user steering takes priority and captures its own
focus. Reports get their own canonical system/assistant turn, preserving the
user's previous answer. Cancelling a pending watch suppresses its late report;
it does not stop the watched agent. The drawer lists watches with cancel/resume
controls and continues fetching state while minimized with an active watch.
Large-range conversation reads use the configured Helper with the existing
tool-free `conversation_summary` execution profile. The operation reads at most
20 Main turns or 12 temporary messages, caps input at 120,000 characters and
marks omitted content. Ranges of up to 8,000 characters return directly without
inference. Larger ranges return a bounded summary with citations validated against
the supplied message identities. Invalid answers, unavailable models and execution
failures return explicitly labeled bounded excerpts instead. Helper identity,
execution and cleanup state are retained before work starts; failed cleanup must
finish before another Helper can start. Stop Colleague aborts and cleans up that
Helper too. Non-conversation watches remain to be added.
Online owns global capture, playback and avatar behavior through the voice slot.


Global Management navigation uses `vibe64.colleague.navigation.open-management`
with an enumerated page, independently of project access. The initiating browser
must acknowledge the exact pending command before Colleague reports it opened.
The host maps these page identities to its real routes; arbitrary URLs are not
accepted. Project/session navigation retains its separate project-authorized
action. Opening a settings page does not authorize changing its settings.

Project navigation accepts an enumerated project/dashboard pane. Session views
and temporary conversations require an exact session ID. When a session is
supplied, omitting the temporary conversation selects Main; keeping a temporary
chat selected requires its ID. The host acknowledges the actual route and loaded
conversation. This capability opens existing views without giving Colleague
repository contents, a terminal or screen access.
The active Preview publishes its displayed setup state separately from the
route name: new project, existing project awaiting setup, checking setup, or
output controls with or without a setup warning. The host includes that state
only when its project and session match the current Preview selection. Hidden
or disposed views withdraw it. Typed messages and recordings capture this view
along with their target, so later navigation cannot relabel an earlier request.
These are semantic UI states, not screen or repository access; output controls
alone do not prove an application is running.

The existing session rename, archive and workspace-preparation retry actions are
also available through bounded session summaries. They use the same current
actor/project boundary and service guards as the UI. Archiving is an explicit
session-close request, distinct from stopping an agent or Colleague; it removes
the working workspace and temporary chats while retaining ordinary archive
history. Preparation acceptance is reported as its current status, not as a
completed setup. Private paths, metadata and full logs are omitted from these
tool results.

The six existing renewal actions provide handover inspection, draft request/edit,
confirmation, cancellation and retry. Inspection returns the complete domain-bounded
draft with its exact hash and draft revision. Mutations return concise status and
guard values without repeating the draft. Colleague must obtain approval for the
current draft and workflow before confirmation; the renewal service still enforces
operation identity, stale-review checks and source/conversation revalidation.
Private provider/basis records and actor metadata are omitted from the tool
projection; the draft's canonical Saved source section remains intact for review.
The tool exchange permits up to 256 KiB so a valid 20,000-code-point
handover fits even with JSON-escaped Unicode; each action retains its own narrower
field bounds. Ordinary conversation results and watch summaries keep their existing
limits. The expanded catalogue uses JSKIT's native discovery instead of sending
every tool definition on each model request.
