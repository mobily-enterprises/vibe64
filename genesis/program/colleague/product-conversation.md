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
- `packages/vibe64-colleague/src/server/actions.js`
- `packages/vibe64-colleague/src/server/service.js`
- `packages/vibe64-colleague/src/server/attention.js`
- `packages/vibe64-colleague/src/server/assignments.js`
- `packages/vibe64-colleague/src/server/conversationSummary.js`
- `packages/vibe64-colleague/src/server/protocol.js`
- `packages/vibe64-colleague/src/server/usageKnowledge.js`
- `docs/colleague-usage/colleague.md`
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
- `packages/vibe64-terminals/src/server/agent/providers/claudeSessionAgentProvider.js`

## Public contract

Each native turn reminds Colleague to read the current full guide for how-to
answers, including when a persistent provider retains older system instructions.

The server exposes state, focus, message admission, stop and context operations.
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
Only completed, validated model envelopes can request a tool. Malformed replies
have a bounded correction opportunity and never execute embedded prose.
Each native turn explicitly distinguishes application operations from native
runtime tools, with a tool-envelope example and the StructuredOutput carrier when
provided by the runtime. Claude provider events expose attempted direct calls to
advertised application tools. Those calls never dispatch an application action;
Colleague suppresses their reply projection and rejects a final reply in favor of
a bounded protocol correction. A valid tool envelope can still dispatch exactly
once. Repeated mistakes produce a specific handoff error instead of saving or
speaking a false application outage. Only application feedback establishes whether
an operation succeeded or failed; retained native history receives current guidance.
The first interactive tool envelope can carry a natural progress sentence of
at most 280 characters in `text`. Current guidance is repeated in each native
turn for retained provider conversations; subsequent prompts include the already
announced sentence. After completed-envelope validation and receipt persistence,
dispatch publishes this sentence (or “Let me check that.”) as a complete transient
assistant projection with its own per-request ID. It remains visible through
tool/model waits until reply text arrives, without exposing arguments or reasoning.
Further tool steps cannot announce again. New user steering resets that allowance;
autonomous observations never announce tools. Stop/failure clears the projection.
Only the final answer enters the unchanged transcript format. The voice host can
finish the short progress utterance independently of the still-running model work.

The feature stores canonical JSKIT transcript data, native conversation identity,
model selection and its most recent operation receipt under private application
state. A known message ID is admitted once. Each tool receipt is saved before
execution and again with its result. A restart during execution reports an unknown
outcome and does not retry that operation. Credentials and HTTP requests are never
persisted. A fresh authenticated request is required to continue after restart.

Persistent interactive turns wait for native completion, Stop or connection loss,
without the ordinary three-minute detached-helper wait. Explicit caller deadlines
and bounded Helper profiles still apply. If a completion wait fails, Colleague
reads the exact retained native run once and accepts an already completed answer;
an active, failed or different run retains the failure without resending work.

Native text events update an in-memory reply projection. Only the decoded text
of the expected reply envelope prefix is exposed; partial tool requests and reasoning
stay private. Authenticated hosted clients receive actor-private JSKIT realtime projections
coalesced over 25 ms, with epoch/revision checks against stale snapshots. Existing
one-second HTTP refreshes and socket reconnect reconcile authoritative state.
Local mode without an authenticated realtime actor retains that HTTP path.
The chat displays one pending assistant message. Completed envelope validation still controls saved history
and tool dispatch. Stop, steering, failures and superseded model steps discard
the projection; reopening reads the latest projection without replaying actions.
The host's voice slot receives that projection and canonical completion with the
same message identity, allowing phrase streaming without replaying the final
answer. No streamed fragments are persisted. The host can supply a transient user
transcript with its admission ID; the chat shows it as Pending until the canonical
user message replaces it. Neither projection edits the typed draft.

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
The centered full-height panel is 560 pixels wide or the available viewport width
on small screens. A compact header shows a 48-pixel avatar, name and Close button.
One persistent Vuetify dialog owns focus and visibility; outside clicks leave it
open, while Close/Escape hides it and returns focus to the launcher.
Hosts supplying the voice slot get Text chat and Voice chat tabs, with text as
the initial view. Native tab keyboard behavior switches the view. Both content
owners stay mounted with inactive content hidden, retaining draft, transcript and
voice lifetimes. The selected tab survives closing/reopening during the page's
lifetime. The small header avatar does not change message wrapping.
Colleague's model instructions, repeated in each application turn so retained
native conversations receive current style guidance, default to one or two brief sentences, with detail
when requested. Greetings get greetings. Focus remains operational context rather
than unsolicited page recaps, no-change lists or generic readiness offers.
The model, microphone, speaker, Stop and Send/Steer controls share the Text chat
composer's icon toolbar. Tab from a sendable draft focuses Send/Steer and stops
that handled keypress from also reaching the dialog focus trap. Enter activates
the focused button; ordinary reverse Tab navigation remains available.
The persistent voice slot receives the `preview` element above the composer for
brief status/recording feedback, the `panel` target for full Voice chat controls,
`minimized` visibility, and an `openVoice` callback. That callback selects Voice
chat and opens the same dialog; hosts do not need their own expanded voice modal.
The shared component does not start/stop audio when changing views or closing.
The host shares the routed header target through its root; Teleport places the
persistent panel in the dialog without remounting the voice connection or clearing
drafts. While a header is unavailable, the compact launcher stays at the top edge.
When the host supplies speech, holding this button for 350ms emits a recording
gesture. Release finishes it; cancellation, lost capture or leaving the window
cancels it. Its trailing click cannot also open the conversation. The voice slot
receives the launcher element to anchor the host's transcript review bubble.
The `@colleague-mobile` browser cases run against a composed host with
`VIBE64_E2E_COLLEAGUE_HOST=1` and `PLAYWRIGHT_BASE_URL` set. They click the real
session Send control before and after opening Colleague, preserve both drafts,
and cover compact, tablet, desktop and reduced-height layouts.
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
The slot supplies ordinary message submission; live voice has no separate
readiness/classification API or Helper inference. The host confirms local
recognizer revisions before admission. Spoken questions and corrections use the
selected Colleague model, tools and the same identity/focus/retry contract as
typed messages. Conversation summaries retain their existing Helper lifecycle,
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
from ordinary watches and keeps polling while minimized.

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
The native prompt also repeats the discovery call format on each exchange:
contract lookup identifies the action, and execution supplies actionId plus
nested input. A rejected malformed call is not evidence that an advertised
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
