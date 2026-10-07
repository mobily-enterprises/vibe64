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
a changed revision restarts the read. The user's approval, including explicit
delegation to approve an in-scope assignment plan, authorizes sending that exact
revision as `planRevision` through the existing Main Send action. Readiness,
active work, role, goal and access checks remain in the existing routing owner.

## Sources

- `packages/vibe64-colleague/src/server/Vibe64ColleagueProvider.js`
- `packages/vibe64-sessions/src/server/Vibe64ConversationsProvider.js`
- `packages/vibe64-colleague/src/server/actions.js`
- `packages/vibe64-colleague/src/server/service.js`
- `packages/vibe64-colleague/src/server/attention.js`
- `packages/vibe64-colleague/src/server/assignments.js`
- `packages/vibe64-colleague/src/server/conversationSummary.js`
- `packages/vibe64-colleague/src/server/protocol.js`
- `packages/vibe64-colleague/src/server/usageKnowledge.js`
- `docs/colleague-usage/colleague.md`
- `docs/colleague-usage/lesson-authoring.md`
- `docs/colleague-usage/learning-with-colleague.md`
- `packages/vibe64-core/src/server/actionContext.js`
- `packages/vibe64-colleague/src/client/Vibe64Colleague.vue`
- `src/components/Vibe64ColleagueLauncherTarget.vue`
- `src/lib/vibe64AssistantHost.js`
- `src/components/StudioAppShellLayout.vue`
- `src/components/ShellLayout.vue`
- `src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue`
- `src/composables/useVibe64AssistantCatalog.js`
- `src/lib/studioUrls.js`
- `src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-colleague/src/server/conversationUpgrade.js`

## Public contract

Colleague uses JSKIT's `createConversationRuntime` for model turns, application
tools, native history, admission, cancellation and model replacement. Its service
owns product instructions, focused targets, watches, assignments and authorization.
It consumes normalized events; it has no provider-event parser or reply/tool
envelope loop. Its existing partial-reply and browser-stream projections reuse the
original trailing-high-surrogate guard for display only, leaving completed events
and canonical text unchanged. The terminal service supplies authorized account resolution and
managed execution. Each person has an independent native scope.
The shared host preserves the native Claude profile lookup used by Main;
it inherits an explicit configuration directory without inventing a default override.

The private `conversation.json` remains the authoritative product record. JSKIT's
record transactions commit its canonical transcript and runtime metadata through
the existing atomic writer, together with watches and assignments. There is no
reconstructed in-memory transcript. Turn metadata survives restart. The earlier schema-version-2 upgrade retains the old transcript and retires the previous native binding through the
numbered stopped-service upgrade `20261002-colleague-conversation`; opening a
legacy record refuses to mutate it or run inference.

Explicit **Start fresh** recovery retains the previous chat as read-only history
and installs a genuinely new public and backend identity in the same private
record. It preserves the person's model preference, watches, assignments and
captured project destinations, and never resends an old message. The original
admission and atomic writer own rotation; the original common runtime retires only
the settled chat. Active turns, summaries and stop operations must finish first.
A recovery operation ID retains its exact successor receipt across lost responses
and restart. Old facade operations fail before admission; an old voice binding
cannot silently enter the new chat. Product invalidation refreshes other tabs'
active identity while retiring their old transcript subscriptions.
Previous-conversation queries use the original paged transcript and product
visibility rules without opening a model, supplying a composer or granting tool
execution. Bounded client-reported unconfirmed submissions remain labelled as
unconfirmed annotations, never canonical receipts or executable requests. An
existing canonical receipt is displayed once. Assignment authorization resolves
its exact original message IDs across retained chats without replaying work.
The stopped-service `20261006-colleague-conversation-history` upgrade adds schema
version 3, retaining each existing chat's exact original runtime identity and all
history. It backs up the whole user record; normal reads never convert old formats.

Stable instructions remain installed through JSKIT's engine adapters. Focus,
observations, user-request identities and assignment summaries travel as bounded
application data alongside a turn, without changing the system prompt. Ordinary
user text remains readable in the transcript. Tools use the shared action catalogue,
with current permissions checked again at execution. Autonomous turns expose only
queries and, where an existing assignment authorizes them, its bounded commands.
An unavailable tool call cannot grant itself authority or cause automatic retries.

The server exposes state, focus, message admission, stop and context operations.
Its browser-conversation facade supplies the existing JSKIT assistant integration
with the same runtime and authored receipts. Reads before model setup use the
saved transcript without starting a native engine. Send and Cancel delegate to
the existing Colleague actions. A follow-up cancels and awaits the current response
before starting the new request, retaining captured focus, watches and cleanup.
Releasing a browser subscription does not stop the turn.
Explicit history queries pass only `beforeTurnId` and `limit` to the existing
JSKIT transcript page reader, before or after model setup. Ordinary reads keep
their full-history default. Both paths retain the same product visibility and
current authorization; no second paginator or history copy is introduced.
The model picker also uses that shared authenticated facade. Its declared
selection input reaches the original `model.select` action, which retains
catalogue revision, account access, active-work guards and the atomic selection
commit with the runtime configuration. The former private model route is removed;
there is no second selection implementation or browser access to native settings.
Each operation and live observation rechecks the original request's current
authority; an actor change cannot reuse an earlier person's conversation scope.
The sessions-owned conversation provider supplies the local request guard and
action context to the one assistant feature. Colleague contributes its existing
facade and declared schemas as an optional capability; Main does not depend on
Colleague being enabled. Colleague's conversation IDs, routes and product policy
remain unchanged, and neither product registers a second transport.
The facade retains Colleague's history visibility: internal wake prompts,
tool receipts and incomplete saved answers are not exposed as completed chat.
The exact completed watch notice remains visible through the existing system
message renderer; its projection excludes private wake data and arbitrary system text.
Transient snapshots retain authored identity and request origin; autonomous tool
commentary retires any earlier unclassified partial without becoming a spoken
progress acknowledgement. Browser configuration does not include Colleague's
internal system prompt. These projections do not rewrite stored history.
The drawer uses JSKIT's retained conversation binding for draft, delivery,
transcript, live updates and cancellation. Its model picker, watches, navigation
receipts and custom toolbar remain product presentation. Text and voice retain
one exact actor/conversation target. Live recording preview is applied after
canonical delivery and cannot acknowledge an unaccepted message. Product reads
refresh on invalidation, reconnect, opening and focus; no browser polling runs.
The same original body supplies the combined view through one binding-owned local
target in the root voice host's existing presentation slot. It keeps the core
transcript and custom composer, adding the extracted voice controls beside the
upper-right avatar overlay and keeping review in the feedback area. No second reader or controller is acquired. Recorded
speech stays separate from the editable typed draft; continuous hands-free capture
keeps typed Send independent, while one-off capture and startup retain their guards.
The transcript opts into hidden-view retention, preserving the reader's position
across minimise/reopen through the shared scroll owner. The body has no Talk/Text navigation, and remains available
for typing when voice setup fails. Minimize/reopen retains the same target and
body; actor loss and unmount keep the original cleanup fences.
Its query actions `vibe64.colleague.usage.topics.read` and
`vibe64.colleague.usage.guide.read` discover and read task guides shipped under
the application root's `docs/colleague-usage/`. The topic index is searchable and
paged, and returns bounded metadata without guide bodies. A guide read returns
one complete document of at most 16,000 Unicode characters. Topic IDs cannot
choose arbitrary files or follow file links. Lookup needs authenticated access
but no selected project; it opens no session and starts no inference.
Colleague reads the relevant guide before naming exact controls, explains useful
steps and offers supported execution. How-to questions and offers remain
informational; accepted offers and direct requests retain native target,
permission and confirmation rules. Guides cannot authorize actions or provide
source, shell or screenshot tools. Missing documentation is reported without
inventing UI. Hosts ship their guides through the same application directory.
A host authenticates the person at the shared action boundary; public local mode
uses its local identity. Separate people have separate state. New conversations
use a private empty native scope and an accessible configured Senior model. They
have no repository context or coding tools. Product operations use JSKIT's native
action catalogue and each operation's own authorization, validation and results.
The shared project context accepts deleting projects only when the operation
declares that lifecycle scope; callers cannot grant it through input fields.
JSKIT admits complete native tool requests, saves their reservation before
execution, then saves the result before further inference. Interrupted reservations
and uncertain server failures remain inspectable and are not executed again. Model
output alone does not establish that an application action succeeded. The same
shared executor serves all supported engines.
Unavailable autonomous commands remain excluded from the tool schemas. Their
verified no-effect refusal is saved by the shared catalogue and returned to the
model for a real final reply; provider failures and uncertain effects still stop.

Product snapshots show user text, completed replies, commentary and the fixed
completed watch notice; unfinished wakes remain hidden. Streaming uses JSKIT's
normalized message
events. Partial tool arguments and reasoning are not exposed as assistant text.
Hosted realtime updates remain actor-private, coalesced over 25 ms, with
stream epoch/revision checks. HTTP refresh and socket reconnection reconcile the
same conversation. The shared voice binding consumes that projection and canonical
completion. Neither projection edits the typed draft.

Tool progress is commentary, separate from the final answer. Product instructions
request a short sentence for the first interactive lookup. The original first-only
acknowledgement is selected at the shared tool owner's reserved, pre-execution
event. A completed reply from that exact authored turn supplies its text; otherwise
the original “Let me check that.” fallback applies. The selected `interimReply`
is transient product presentation on the same authorized read/subscription, not
another stored assistant answer. A single generation-fenced projector runs before
both product and browser publication, independent of subscription callback order.
Proven native output identity follows live output into saved history so speech
does not replay the acknowledgement or confuse it with the later answer.
Autonomous notifications suppress progress in the live projection. Stop, superseding user instructions and
failure clear transient output. An accepted application wake is retained even when
its watch is cancelled; cancellation stops that notification, suppresses its late
reply and leaves the watched coding agent running.

A known message ID is admitted once. Credentials and HTTP requests are never
persisted. Fresh authenticated access is required to continue after restart.
Uncertain native delivery must be inspected before another submission; neither
reopening nor recovery replays it. Failed record writes preserve the last committed
history and prevent the unsaved request from starting.
The shared inspection owner distinguishes an exact settled native no-admission
record from an unknown acknowledgement. Its typed not-sent result releases only
that request's restored client uncertainty barrier, retaining the draft, payload,
history and every genuinely unknown request. Current and retired no-admission
records require explicit false attempt markers without conflicting copies,
in-flight dispatch, replacement or storage/execution uncertainty. No native work,
canonical receipt, predecessor mutation or replay is manufactured. The original
retired-ID guard still requires a new authored message for a successor.

An accepted request captures its UI focus. Subsequent navigation does not silently
redirect its operations. New steering can arrive while a model response is active;
code checks it before dispatching that response's tool. Stopping Colleague stops
its native turn and preserves history; it does not operate a coding-session Stop
or any audio playback. Tools themselves retain their ordinary cancellation rules.
New steering carries its own captured focus into the next decision boundary;
merely opening a different project does not change an earlier request's target.

The host can mount the reusable text drawer outside routed project content.
Its shared chat element accepts messages and steering while a turn is active.
The host supplies the existing avatar, application voice configuration and
display name (default Colleague). The service accepts a host-owned name resolver
and includes its current value as data in each model turn. Changing the name
updates labels and future replies without replacing native history or typed drafts.
Colleague owns a mounted 380-pixel right-hand desktop navigation drawer. Its
Vuetify layout registration reserves space beside the existing workspace and
Preview, below the app bar, with no scrim or route-driven dismissal. JSKIT's
existing inline ConversationDialog holds the desktop panel; its fullscreen dialog
holds the phone panel. One original body Teleport selects the responsive target,
retaining the root target-switch slot when needed. The adapter, runtime, composer
and outer body survive resize, minimize and reopen, preserving drafts, history
and the existing voice session. The default inner Transcript scroll DOM remounts
and follows latest on reopening; the host does not opt into hidden-reader retention.
There are no Talk/Text tabs on that adapter path. Opening starts neither capture
nor read-aloud. Tap Talk starts hands-free; a hold records push-to-talk and release
sends, with automatic connection setup. Its existing portrait control hides or
reveals the face, while short containers can clamp the artwork.
The cog holds personal voice selection. The frame's minus minimizes; X/Escape
within the conversation closes and releases audio, discarding unsent speech. The header avatar owns the minimized-session
badge and reopening of the existing target, with a microphone cue while listening
and an adjacent Stop voice button. Clicking that avatar while the conversation is
open minimizes without ending audio. Desktop workspace clicks do not dismiss
the drawer. The phone keeps the original shared dialog focus and dismissal owner.
Relocating the original body preserves its typed draft and state; failed voice
setup leaves that body usable. Main uses the same host artwork and collapsible
overlay in its existing text view; its retained target keeps the caption fallback
when that view is unavailable.
The host supplies artwork and display preferences, not another voice slot
or controller. A 350ms hold on the launcher opens the same voice session and records
for explicit review; release finishes, and lost capture cancels. The trailing click
cannot also open the text panel. Keyboard hold and pointer ownership are handled
by the shared launcher. Public Vibe64 supplies live state, captured focus, stable
message identity, canonical admission and cancellation to the binding.
Colleague's persistent instructions still request brief replies, with detail when
asked. Model, Stop and Send/Steer retain their exact original composer toolbar.
The avatar and voice tools start visible as a fixed upper-right overlay
over scrolling text, and collapse without ending the voice session. The collapsed
row has passive Listening and Speaking indicators from the exact current voice
session; Show avatar is its only action. Muted capture does not display Listening,
and speaker preference alone does not display Speaking. Pending speech review
remains outside that overlay. Tab from a
sendable draft focuses Send/Steer without propagating to the dialog focus trap.
Colleague opts into the shared retained conversation's `deferWhileWorking`
policy and serial delivery queue. A nonsteerable turn keeps new typed and voice
follow-ups locally pending with their authored IDs and captured focus until the
same canonical subscription reports ready. Each then uses normal API admission
and permissions. The product browser facade advertises `steering: false` for
both empty and prepared chats: its direct send owner implements stop-and-wait,
not native steering. This truthful capability keeps ordinary browser follow-ups
buffered without interrupting the current answer. The composer shows Send;
the original direct service send and explicit Stop semantics remain unchanged. Stop cancels local pre-dispatch
followers, and account/access retirement cannot dispatch them later. Explicit
retries retain their original intent; unknown receipts remain inspection-only.
There is no server queue or separate Colleague turn loop.
Voice submissions use the same message-ID admission as text, carry their
recording's original focus, and never alter the typed draft. Colleague's API stays global when the
selected project changes. Opening a view sends a command only to the initiating
browser; the actual router and conversation owners acknowledge its result.
An unacknowledged or failed navigation is reported as failure, not completion.
Connection failures use the existing footer status and clear on a current
successful refresh. Stale failed reads cannot restore a recovered error.
Command and model failures use shared transient action feedback without adding
an error block to the drawer; an unchanged retained model error is not announced
again on every refresh. Failed text submission preserves its draft and retry identity.

JSKIT retains each native binding and its exact execution identity in the same
conversation metadata. Reopening observes or stops an owned orphan before further
work; no process is reclaimed by guessing its PID. Failed cleanup stays visible.
The model picker uses the existing actor-aware catalogue. Switching is unavailable
during active work. A selection checks access, then uses the shared replacement
journal to preserve logical history and prepare the destination native conversation.
Model selection is committed with the replacement metadata. An interrupted switch
requires selecting the same destination again to finish that operation. Switching
starts no inference and does not change coding-session routing.
Colleague compares its original five selection fields: engine, model provider,
model, agent and variant. An identical choice retains the current segment; a
changed choice requests a fresh native binding through the shared transaction,
including changes within one provider. Other consumers retain JSKIT's default
selection policy. A pending switch retries its recorded retirement policy,
including an older request's missing field, without changing the operation.
The product choice is published only after the replacement commits, even when
agent or variant changes leave the runtime configuration equal. Colleague's
logical conversation, transcript and uncertain predecessor receipts remain;
the next authored message uses the existing native history catch-up. The native
account identity guard remains enforced rather than relabelling an old thread.

Conversation watches are ordinary create/list/cancel/resume actions. Each user
can retain up to 16 active or paused watches, with exact project/session and
optional temporary-conversation identity. Conditions cover completed replies,
finished turns and explicit attention states; failures are reported for every
condition. Ordinary reply watches accept canonical completed assistant/commentary
responses during active work, preserving truthful `working` and `settled` facts.
Partial text, thinking and tool output remain excluded. This deliberately extends
the original settled-only reply predicate for ongoing-goal steering; it does not
declare the work complete. One-shot watches report the next response, which can be
progress rather than a resolved question. Assignment watches retain their native
completion boundary. An unreported reply does not advance its answer cursor,
so a final answer saved before the native idle event remains eligible afterward.
An existing completed response is reported immediately. Quiet output
does not imply that an agent is blocked. One-shot watches retire after delivery;
ongoing watches compare run, message and status cursors to suppress duplicates.
Auto implementation handoffs count as working until admitted or interrupted.
Uncertain continuation delivery and settled incomplete outcomes need attention;
the coding model's partial final reply does not clear that waiting state.
Hosts can register an authorized reader for a named workspace conversation source.
Those watches use the same scheduler, cursors, budget, cancellation and notification
flow without a project/session. Only the owning host action supplies that source;
ordinary watch input cannot choose it. New records retain the optional source name;
existing records without it remain coding-conversation watches without rewriting.
Unknown sources pause rather than falling back to a coding session. Reusing a
watch ID for a different target, source, condition or question is refused.

The existing session event bus schedules coalesced reads outside the publisher's
write lock. A 30-second code-only reconciliation catches missing events while a
watch is active. No watches, unrelated events, unchanged state and partial tokens
start no model calls. Watches and pending observations persist, but credentials
do not. Reads resume after authentication, recheck target access, and pause visibly
on a read failure. Resume reconciles from the retained cursor. Notifications also
recheck target access before sending their bounded observation to the model,
including the current host authority for a workspace conversation. Waiting for
these changes does not occupy Colleague's model turn; the user can keep talking.

Updates wait for a decision boundary when Colleague is busy. Ordinary autonomous reports
use the same JSKIT catalogue filtered to query actions, so they cannot assign
work or stop an agent. New user steering takes priority and captures its own
focus. Reports get their own canonical system/assistant turn, preserving the
user's previous answer. Cancelling a pending watch suppresses its late report;
it does not stop the watched agent. A compact eye-and-count composer button opens watch and assignment details
in an application-owned Vuetify dialog. No watch panels consume height below
chat. Resume/Cancel remain the existing actions, and closing details returns to
the same chat/draft. The client continues fetching state while minimized with
an active watch.
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
JSKIT owns capture, playback, local recognizer decisions and speech controls.
Public Vibe64's Colleague binding uses ordinary message admission; there is no
separate readiness/classification API or Helper inference. Spoken questions and
corrections retain the selected model, tools and identity/focus/retry contract.
Conversation summaries retain their existing Helper lifecycle,
including cleanup of retained historical executions.
The client emits the local message-submission identity synchronously before
sending. Voice hosts use it to distinguish a fresh invitation from a delayed
canonical acknowledgement after Stop speaking; it changes no stored history.
Live reply events use the same Colleague scope identity as HTTP snapshots,
rather than the native provider conversation identity. The shared transcript's
scroll key and display cache therefore stay stable across the two transports.

Assignments retain an actual user message and its original request, criteria,
exact project/session/implementer identity, subsequent user amendments, turn
allowance, receipts, summary and evidence in the same private Colleague record.
An absent assignment list means none were created; historical conversations are
not reclassified. Each model exchange receives a compact overview of open and
currently observed assignments, omitting full requests and evidence. The detail
action supplies those when needed. The drawer lists open assignments separately
from ordinary watches and receives their changes while minimized. The server
watch scheduler still observes its targets; the browser does not poll.

Assignment sends invoke the existing Main or temporary-conversation actions,
reserve an agent-directed turn before dispatch and automatically attach an
existing one-shot watch with its pre-send cursor and message identity. Repeated
send IDs do not spend another turn or send again. Unknown admissions retain their
reservation and require an observed user-message identity before continuation.
Quota exhaustion becomes needs-user; only a new user instruction can extend it.
Default allowance is eight turns, including approval, follow-ups and review.

An assignment observation grants only its own bounded continuation commands
through the same JSKIT catalogue, including discovery-mode execution. Explicitly
linked mediation has the separate, bounded relay permission below. Ordinary
watches still expose query actions only. The assignment owner checks the retained
target and allowance before invoking product actions; those actions recheck current
actor/project access. Replies to a different user message pause follow-through.
New user steering supersedes pending model tools. Stop Colleague suspends open
assignments, while assignment cancellation does not stop coding agents or speech.
After restart, fresh authentication is required; interrupted mutations need
inspection and are never automatically resent.

After implementation answers, review uses a temporary conversation in the same
session, with its existing configured routing and shared worktree. Assignment
work waits for its current participants to settle before sending another turn.
Readiness for human testing requires recorded evidence and a completed review
after the latest implementation send. The model must compare every original
criterion with that evidence, distinguish reported checks from observed results
and return material product decisions to the user. This does not prove source
correctness merely because the agents agree. Separate sessions retain separate
worktrees; assignment messaging never implicitly transfers source.

The current user's instruction can link two existing assignments for a stated
communication purpose. Links retain that actual instruction and do not grant
transitive authority. On either participant's observed reply, Colleague may relay
an observed answer to the other implementer. The relay checks current access to
both projects, identifies the originating assignment/session/conversation and
answer, retains those references in the send receipt, and spends the receiver's
allowance through the existing send/watch path. Links never authorize ordinary
cross-assignment sends, new scope, extra turns or resuming a paused/cancelled task.
Busy recipients wait for their existing native turn; there is no extra scheduler.

An assignment may record that it is waiting for another directly linked task.
The source's existing watch supplies the wake; a relay resolves the wait without
model polling. Circular waits are rejected. When a prerequisite is cancelled or
needs the user, runtime checkpoints suspend its waiting dependents, including
chains, without another model call. They retain the dependency for the user's
decision and do not resume automatically. Cancelling one assignment leaves
unrelated work and its native agents alone. Linked completed records remain retained while an open task references
them, and link/wait/send identities survive the same authenticated restart path.


Global Management navigation uses `vibe64.colleague.navigation.open-management`
with an enumerated page, independently of project access. The initiating browser
must acknowledge the exact pending command before Colleague reports it opened.
The host maps these page identities to its real routes; arbitrary URLs are not
accepted. Project/session navigation retains its separate project-authorized
action. Opening a settings page does not authorize changing its settings.
The System repair destination opens an available host's existing confirmation UI;
navigation never confirms a repair. Public Colleague does not own host repair.

Project navigation accepts an enumerated project/dashboard pane. Session views
and temporary conversations require an exact session ID. When a session is
supplied, omitting the temporary conversation selects Main; keeping a temporary
chat selected requires its ID. The host acknowledges the actual route and loaded
conversation. This capability opens existing views without giving Colleague
repository contents, a terminal or screen access.
The same action accepts an optional planView (default, current or history) for
an exact session's Main chat, without another pane or temporary conversation.
The native Plan and history owner reads fresh authorized data and opens its own
dialog. Default follows the button's current-or-history choice. Acknowledgement
reports the actual current/history tab only while that matching dialog is open.
Missing plans, load failures or changed selections return failure; opening
neither mutates a plan nor starts a coding turn.
The shared discovery contract identifies each action and executes it with
actionId plus nested input. A rejected malformed call is not evidence that an advertised
action is absent. JSKIT still validates and executes the unchanged request;
Colleague adds no argument repair or alternative dispatch path.
For Integrations, an optional exact integration ID requires the Integrations
pane and either a development session or the production environment. The browser
selects that slot through the existing panel owner, even when the same URL is
already open. Acknowledgement
waits for the matching panel to load and contain the slot; missing slots, failed
loads or changed selections fail. This does not start or complete provider consent.
The active panel publishes only its selection, environment and draft state to
Colleague, never configuration values or connection URLs. Focus includes
environment and draft state only for the matching loaded project and, for
development, session. A slot ID additionally requires an available selected slot;
manual changes update them independently of old URL parameters. Hidden or disposed
panels withdraw their selection. A displayed draft is not saved-state or provider
readiness evidence.
Reopening the already selected slot explicitly refreshes connection
status through the existing setup owner. Its request identity invalidates older
responses and the existing busy-command handling schedules the status read after
an active command settles. It never repeats Connect or Disconnect. Draft,
source-suspension, per-user and active-view guards still apply; failures remain
visible without automatic retries. Opening acknowledges the selection, not a
successful provider check.
An explicit integration selection also brings its detail into view after the
panel renders, including a repeated request for the same slot. It does not move
keyboard focus or animate scrolling. The request is local to that panel's
project/session/environment and is cancelled by a different selection; inactive
panels defer it. Missing slots do not scroll, and subsequent connection/status
updates do not repeatedly move the page.

Integration navigation also accepts an explicit development or production
environment. Development requires the exact session; a host's published view
needs only the project. The existing panel selection owner and URL carry the
requested environment and optional slot through reload and Back/Forward. The
host waits for the loaded environment and requested slot, including on an already
open URL. Empty loaded configuration can acknowledge the environment alone.
Production focus is independent of a development session; no configuration,
credentials or consent URLs enter Colleague's focus.

The existing app-page layout owner publishes its ready project and pane visibility
to the host. An explicit project view reveals that pane on compact screens;
session/conversation navigation without a pane reveals chat. A project-only open
reveals Preview. Navigation waits for the matching ready layout and releases its
watchers afterward. Captured focus reports `pane=chat` when the compact project
pane is hidden, omitting its Preview and integration detail. An unready or missing
layout reports no displayed pane. Publication ends with the layout's lifetime;
no new layout controller or persisted preference is introduced.
The selected session's conversation owner remains available when chat is hidden;
visibility still controls its ordinary UI activity. Selecting another session or
disposing the workspace withdraws that owner and rejects late navigation.
The active Preview publishes its displayed setup state separately from the
route name: new project, existing project awaiting setup, checking setup, or
output controls with or without a setup warning. The host includes that state
only when its project and session match the current Preview selection. Hidden
or disposed views withdraw it. Typed messages and recordings capture this view
along with their target, so later navigation cannot relabel an earlier request.
These are semantic UI states, not screen or repository access; output controls
alone do not prove an application is running.

Database navigation can include `databaseView` (`overview`, `erd` or `data`) with
an exact session and the Database pane. The host carries it in the URL and waits
for the actual workspace to load that view, reporting failed loads or changed
selections instead of claiming success. Captured focus reports `databaseScreen`
for loading, unavailable or workspace, with `databaseView` only for a loaded
workspace. It follows the active panel, not stale query parameters, and omits that
state for foreign project/session owners or hidden compact project content.
For Data, `databaseTable` captures the actual selected table identity. Navigation
can supply that fully qualified name with `databaseView=data` to use the native
table opener. Missing tables and busy queries fail; acknowledgement verifies
selection rather than successful query execution. Table drafts/results survive
switches within the mounted workspace, while reload restores the ordinary initial
table. Unknown identities and SQL/schema investigation go to coding agents.
These fields contain no SQL, table contents or credentials, and do not prove
connection health. Opening Data retains the UI's normal automatic table reads.

Shared Model routing is available through its existing global Accounts actions.
Colleague can read assignments and effective routes, search the choices offered
for an exact workflow/role in 20-item pages, preview proposed changes, and save
only user-requested patches with the current revision. Native owner, access,
role compatibility and concurrent-change rules apply. It receives no credentials
or connection identities. Saved routing affects future work across conversations;
Colleague's own model and the current session's mode remain separate operations.

Database status, schema refresh and exact-query cancellation are available through
their existing authorized actions. Results contain bounded identity, schema counts,
refresh time and active query IDs, never SQL, rows, credentials or full schema.
Activity comes from the query executor's project/session reservations, including
pending acquisition and Database Copilot SQL. Cancellation is a driver request;
Colleague must reread activity before claiming the query has left that owner and
must not infer rollback or undone writes. An empty list says nothing about other
sessions, external database clients or coding-agent work. SQL/schema authoring,
row editing and source investigation remain delegated engineering tasks.

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


## Fresh/history client presentation

The original Colleague element keeps its shared uncertainty status and Check
delivery action, and adds explicit Start fresh confirmation. The confirmation
explains that the old voice conversation ends, nothing is resent, history remains
readable and watches/assignments continue. Active admission, Stop, voice setup,
capture or sending must resolve first. Only the matching pending uncertain speech
may retire after an exact successful archive receipt. Newer known-unsent speech
remains discardable by its own ID despite another uncertain delivery; pausing the
microphone before its X lets the original capture owner become idle without
silently archiving those words.

The client retains one pending fresh operation and its exact body for lost-response
retry, suppressing background product retargeting until resolved. Actor, original
runtime and matching voice binding fences prevent a late response from ending a
different conversation or copying another person's draft. On confirmed success
it follows the current product pointer, preserves the latest typed draft through
the original setDraft owner, and leaves personal voice preferences unchanged. It
does not restart speech or submit the draft. Once the archive is committed and
the current pointer is applied, it reuses openVoice to restore the original
controls with a new paused matching session only when the root controller is
empty, not busy and has no pending target. A competing target remains untouched.
Voice-presentation failure reports separately and retains the committed text
chat/draft without restoring the archive operation. A late openVoice result
cannot hide a different actor or conversation view.

Previous conversations reuses the original responsive conversation dialog and
transcript renderer with the existing page normalizer/merge owner. Archived reads
create no runtime subscription, composer, model selection, voice connection or
delivery action. The archived-page caller forwards the shared transcript completion
callback and completes it before rendering the accepted page; rejected, busy and
obsolete requests release it without changing the page. Original cursors survive filtered-only pages. Client-reported
unconfirmed words remain separate plain-text annotations; they are never delivery
inputs. Actor changes and dialog closure fence late history responses. Its list
provides Start fresh independently of uncertain-delivery bubbles, including after
terminal provider failure. The entry uses the original busy/block reasons and
showFreshConfirmation, closes history through closeHistory and performs no mutation
until explicit confirmation calls the unchanged startFresh owner. History/voice,
draft, assignments and durable recovery semantics remain with those owners.

An external current-pointer change is held before the original retained voice
runtime and bubbles become hidden while hasUnsentSpeech remains true. A notice
requires original resolution or explicit voice close, then explicit Refresh
conversation; background reads cannot silently retarget after that notice.
Same-actor pointer changes preserve the current draft through the original
setDraft owner. Actor/access availability semantics remain with the original
runtime and controller; the UI does not forge an available binding.

Colleague supplies the existing shared runtime draftStorage host seam with
window.sessionStorage and an actor+conversation-scoped v1 key. The original
runtime alone owns its opaque byte shape, unknown-status restoration and writes.
This retains exact uncertain payloads when the final old runtime reader disposes,
without copying those messages into the new delivery owner or reopening archived
runtimes. The retention is local to the browser tab when storage is available;
there is no new server journal or cross-tab archive protocol.

### Lesson presentation acknowledgement

The original initiating-browser navigation receipt also carries bounded lesson
presentation operations supplied by the Training action owner. The browser's
existing Preview handle awaits the original player's readiness, completed command
or semantic snapshot. A successful acknowledgement must match the requested
attempt, visual, command and exercise view; command acceptance cannot settle it.
The receipt remains private to the initiating connection and is retired through
the original Stop/disconnection lifetime. It adds no speech or grading authority.


## Issued lesson references at message authorship

The existing Colleague state read optionally asks the host-supplied
`context.trainingTeaching.readQuestionReference` for one bounded issued reference.
It exposes that reference only when original current-scope turn metadata proves
the matching native question reply completed. `stageTrainingQuestion` saves a
prepared mark for the current interactive accepted turn/generation.
`requireTrainingQuestionTurn` uses the same eligibility check before the question
action saves its checkpoint; stage rechecks inside the native transaction.
A present cue must be completed in the initiating current conversation. The
original final-save transaction promotes it only with native completion and the actual
saved canonical assistant output ID whose trimmed final text exactly matches
the captured authoritative question text. Unrelated finals, commentary,
cancelled outputs and tool progress never promote it. Restart reads the retained
mark; Fresh archives never qualify.

Typed submission captures it through the original runtime data getter; voice
stores it in the original utterance capture context, then separates it from view
focus before forwarding it as ordinary conversation data. The shared capture,
serial delivery, deferred admission, draft and canonical transcript owners are
unchanged. No JSKIT teaching concept, queue or second reference store is added.

The original native facade and message action accept only the six-field reference.
After an existing accepted UUID returns its original receipt, send admission can
call `captureQuestion` using the fresh authenticated actor and that submitted
reference. Only the detached Training-owned snapshot enters canonical
`data.trainingQuestion`, together with server-derived question conversation, turn
and output identities; caller snapshots and outcomes are never trusted. Stale,
absent or unavailable references leave messages ordinary and ungraded without
blocking Send or reassigning them to a new question. Stop and closure fences are
rechecked after the asynchronous read before original preparation/cancellation.
Actual accepted message and turn identities retain their native authority. No
grading caller is registered by this integration. Optional new writes require
the release's prospective upgrade; no historical question association is inferred.


## Native lesson answer evaluation

`evaluateTrainingAnswer` selects the actual canonical user message from the
current admitted interactive turn and its original context user-message IDs. It
requires the saved server-owned question capture and exact current-scope native
question delivery/final-output proof. Archives, autonomous turns, caller
snapshots and unrelated messages cannot supply evidence. It neither imports
Training nor writes progress; the host's single `trainingAssessment` owner
validates the pin/question, grades and saves through its native assessment owner.

The operation reuses original `summaryRunning`/`summaryAbort` serialization,
Helper process creation and cleanup. Its one original `runHelper` method is
adapted to recheck fresh actor, scope, turn, generation and operation abort before
returning Helper text to Training, preventing a retired turn from saving a grade.
The optional caller signal aborts only this operation; listeners are removed and
transient owners are cleared by identity. Original Stop joins and cleans up the
same Helper. Persisted submission replay remains Training-owned before inference.

Native practical gestures use the existing initiating connection and admission
tail. The HTTP-only, assistant-excluded `training.observe-native` action
reauthenticates the caller, requires an actually delivered current question, reads
the Training owner's exact ready exercise contract, and uses ordinary session
inspection for project access. One transient slot retains at most three exact
gesture payload/receipt pairs and one server-derived observation. Same-ID retry
returns the original step receipt; conflicting payloads fail. Workspace navigation
requires project selection, revealing the exact reserved Main session through its
session tab or Show chat, then visible Preview; return requires actual body
minimize, same-exercise workspace use, then restore. These formative observations
preserve saved assistance and do not grade, write progress, wake Colleague, or run
a coding agent. Restart requires repetition; no durable gesture journal or
anti-cheating attestation is claimed. The client admits Colleague minimise/restore
tickets only for the return-to-Colleague assessment. Ordinary launcher use during
workspace navigation retains the conversation and collection without an unrelated
observation request or error; strict server sequence/target checks remain intact.

The same native receipt endpoint admits `exercise-response` only for the pinned
`try-the-application` practical. Four bounded protocol UUIDs and the original
numeric frame generation travel as browser identities; terminal, origin, check
and outcome never do. The existing `terminals.outputs.read` action selects the
current App terminal, and the host's original declared-check owner verifies its
run/pin and server interaction. A late question/scope/access change rejects the
receipt before mutation. One exact payload/receipt, factual observation and
server check result occupy the same connection slot; duplicates do not rerun the
check. Stop marks the original admission fence and joins the finite check; its
original managed execution/cleanup and caller signal remain authoritative.

Answer and practical evaluation share the original private native admission and
serialized Helper lifetime. `evaluateTrainingPractical` accepts IDs, selects only
the current connection's exact observation/reference/check and actual accepted
current-turn explanation, and passes them to the host Training assessment owner.
Fresh scope/generation/auth and the captured observation object/facts are checked
again before Helper text returns. The original owner saves and consumes evidence;
Colleague supplies no grade setter, journal or parallel Helper.

The original `context.read` query projects accepted partial steps separately as
`trainingPracticalProgress`: exact reference/assessment, collecting phase, bounded
count and actual last control. The same question, target, fresh access and
connection fences guard this read-only coaching context. It has no observation
ID, outcome, pass or persistence; Colleague continues the next step under the same
question. Completion removes this projection and retains the original completed
`trainingPractical` DTO. The query projects that completed native practical
observation only for this connected current conversation and delivered
question. It uses fresh Training capture and ordinary session authority, then
rechecks the same slot after awaited reads. The whitelist includes the issued
reference, observation/assessment identity, declared producer/operation, observed
time, assistance/origin and optional check outcome. Teacher origin projects
as demonstration assistance. Stale, unavailable and unauthorized facts are
omitted without changing the original context response or writing state.
This lets the existing practical action discover real IDs; it does not wake the
teacher or grant access to App/window/source/check bytes.

### Lesson authoring through existing operations

The release's `lesson-authoring` guide connects existing assignment creation,
receipt/watch follow-through and same-session review with native requested
Save/PR publication. Colleague remains a coordinator without source or shell
access; the coding owner authors and runs the original Training CLI. Git source
publication is supported through existing permission/review/recovery owners,
while installation/enablement remains an explicit local operator operation.
Read-only how-to or quoted guide examples supply no mutation authority.

The product instructions route lesson template/source inspection and Training
validation/bundling directly to the existing coding assignment. Colleague loads
the create/send contracts for the supplied exact target instead of searching for
source access or preflighting later review/publication before delegation. This is
coordination guidance, not another action, a larger tool budget or new authority;
the original assignment receipts and later review/Save owners remain required.

Usage discovery still reads each release-matched topic through its original
16,000-character bound. The teaching guide is split into task topics rather than
raising that limit or changing the reader. No new runtime action, state format,
conversation loop or browser authoring control is introduced.


### Browser question admission

The original browser facade omits undefined Training owners so native action
contributors can supply them on each operation; explicit owners or null remain
unchanged. Future admitted answers retain the existing canonical question
snapshot and delivery identity. Older ordinary messages stay ungraded; this
correction performs no historical conversion or inferred association.
