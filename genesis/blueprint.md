# Blueprint

Vibe64 is the visual, managed shell around Genesis for people building software
with an AI coding agent.

Maintainers can develop Vibe64 inside another editor's preview. The development
preview runs a complete editor with its own runtime state and an independent
copy of a bundled, dependency-free Node example. The example has complete
Genesis guidance, needs no database or external services, and preserves edits
across preview restarts. Frontend changes update through the development server;
server changes take effect after restarting Preview.

The initial document shows a lightweight loading shell before the editor's
JavaScript starts. It remains visible during initialization, offers a page reload,
and explains a failed download or initialization instead of leaving a blank
page or a loading message that never ends after failure.

People can open or create a project, work in isolated sessions, and have a
direct conversation with the agent while seeing the source, changes, running
application, environment, and the system's explained structure in one place.
Each session keeps valuable work recoverable and separate from unrelated work.
Assistants have one discoverable command entry point for the session's preview,
browser tests, environment, database and GitHub tools. Existing individual
commands remain available so earlier conversation instructions keep working.
Opening a project shows loading while its sessions are being fetched, including
when restoring the last selected session. It does not imply creation is blocked.
Opening a project link reopens its runtime before chat and Preview load, including
when returning with cached data. A failed opening or project-data load offers
Try again without requiring a browser reload. Recovery refreshes the project
data and retries opening; repeated failures keep the action available.
Opening the same project in another browser tab refreshes its runtime activity
without making existing tabs reload unchanged project data. Returning to a tab
reuses a recent repository check shared by the server; source-change events
still request an immediate fresh check.
Tabs inspecting the same session share an already-running worktree inspection;
completed results are not cached, and different projects stay independent.
Clicking an already-selected dashboard tab keeps the conversation and dashboard
mounted; repeating navigation retries opening only after an opening failure.
Dashboard page titles share one Material typography style. Session history keeps
its refresh action beside the heading, including on small screens.
Warnings use a muted gold palette in light and dark themes, with readable text
and restrained accents. Setup notices pair a soft warning surface with dark or
light foreground text appropriate to the theme; disabled actions remain legible.
GitHub-connected projects offer one Issues/PR entry in the project-wide Dashboard
menu, including when no session is open. Tabs return to the issue or pull request
list while retaining its filters and pagination. Opening it collapses the Dashboard menu
to give the list and conversation room, with a direct route back. People can
filter open, closed or all issues and select one or more repository labels to
match together. Clicking a label in the list or issue details searches that label
using `label:new` or `label:"some label"`, keeping the selected issue state and
returning to the first page. People can also type these qualifiers alongside
text or an issue number; typed and selected labels must all match.
Issue lists load 25 at a time and remain browsable beyond 1,000
issues with state and single-label filters. Title and description search or
multiple labels explain GitHub's 1,000-match limit when needed. Entering an issue
number, with or without #, finds that exact issue within the selected filters.
Issue descriptions and comments display GitHub's formatted content and attached
images, including private attachments available to the connected account.
Images fit the available pane width; editing preserves the original Markdown.
People can read an issue and its paginated comments, add a comment, and close or reopen it when their
GitHub permissions allow. People can create an issue with a title, Markdown
description and repository labels, edit issue titles and descriptions, and edit
comments when GitHub permits. Failed edits keep their inputs. Existing issue
labels can be edited individually or in bulk: select rows or all issues on the
current page, then add or remove labels while preserving other labels. Selection
clears when changing pages or filters. Partial failures retain only the failed
issues for an explicit retry. Descriptions
and comments support immediate @username suggestions from repository collaborators
and everyone participating in that issue. New issue descriptions suggest
collaborators too; keyboard or pointer selection inserts the username while
preserving the surrounding draft. Unavailable suggestions never block typing.
People with repository write access can create labels from the issue browser or
label pickers. A small form offers a name, colour swatches, a custom colour and
a live preview. A label created while choosing issue labels is selected immediately;
the issue draft stays intact. Duplicate names are explained and failed creation
keeps the form's choices.
Labels retain their GitHub colors with readable text in either theme. The issue browser
uses the available pane width, with Back to dashboard, Refresh and New issue in
one toolbar row and no extra heading or repository subtitle. Both browsers keep
the toolbar, underlined tabs and filters close together, with compact list rows.
Issue labels sit beside their title when space permits and wrap when needed.
Pull request branch details share the metadata row when space permits.
GitHub remains the authority; actions use the person's
connected account. Unsent comments survive navigation within the same browser
tab. Submitted comments appear immediately with a posting status. Failed comments
retain their text and an explicit Retry action in the conversation, including
after navigation in the same tab. Retrying leaves a newer draft intact.
A comment posted through Vibe64 gives other viewers of that project a short
notification and refreshes the issue conversation without clearing their draft.
This uses the existing realtime connection and shared snackbar; comments posted
directly on GitHub appear on the next refresh.
Agents run `vibe64-helper github refresh` after GitHub changes to refresh that project's
issues, comments, labels and PRs through the same realtime connection, without
clearing browser drafts or filters.
When assistants refer to this project's issues, they prefer links that open the
issue inside Vibe64 and may also provide the GitHub link.
Ordinary links to pages in the current Vibe64 app change the route without
reloading the app, including root-relative paths and full URLs on the same origin.
File links keep opening Files. External links, downloads and deliberate new-tab
clicks retain their browser behavior.
Projects without a GitHub repository do not show Issues/PR,
PR session actions, or PR publishing controls.
Pull requests has the same project-wide, full-width Dashboard presentation.
People can filter and search PRs, read descriptions, and open an open PR with a
writable source branch as an isolated session. Its exact head commit and
server-resolved source repository and branch become that session's authority.
The description is available to the assistant. Save and Update use the PR head
branch, including writable forks, and the destination stays visible in chat.
Session actions also offer Create pull request: review the title, description,
and draft choice, publish work on a new branch, and create the PR. The session
then keeps saving to that branch. Interrupted publishing retains that destination
and an explicit retry checks for an existing PR before creating another.
Neither workflow merges a PR or publishes session work to the PR's base branch.
Current changes uses the full project pane, with the dashboard menu hidden and
a Back to dashboard action, so file differences have room to read.
Resizing chat keeps its contents, divider and project pane aligned through the
smallest supported width.
Archiving immediately makes a session inactive and selects the previous available
session. Its gray tab remains while Preview, AI work, and other tools stop and
its workspace is archived in the background. A visible status beneath the tabs
names the closing session, current stage and elapsed time, including after reload.
Long waits explicitly state that completion is still unconfirmed. Success removes the tab; failure
restores its availability with a warning. All open tabs observe the transition.
Stopping a terminal or replacing Preview waits for confirmed process shutdown
and required cleanup. Queued or slow cleanup stays visibly closing instead of
becoming a failure solely because time elapsed. A replacement cannot start
until that cleanup finishes; realtime notification delivery does not delay it.
After a server restart, admitted archives resume from durable progress. Failed
recovery preserves the evidence and requires an explicit retry.
Hosts can register preparation before ordinary archival removes resources and
source. Failed preparation stops that archive attempt. Fully published archives
can be inspected through a guarded server operation. These extension points add
no automatic history deletion or context rotation to the standalone editor.
Explicit host operations can inventory and retire verified native histories,
replace idle native context using a supplied continuity briefing, and expire
archived attachment payloads while keeping text. Native-only forks and new chats
are discovered as candidates; hosts own preservation, exclusive ownership proof,
retention dates and user-facing policy.
Selecting a session shows incoming saved work as soon as its version check
confirms it, while the file-change details continue loading in the background.
The chat header gives three session tabs room to show their labels, hides the
new-session plus when all three slots are occupied, and groups Save beside the
session actions.
Hovering or keyboard-focusing a session tab for one second shows its basic
details. Touch users can tap its info button to read the same details without
switching sessions.
Selecting a session keeps those details closed until the pointer leaves and
enters its tab again. Deliberate keyboard focus and its info button still make
the details available on demand.
Files separates the repository, a per-session Drop Zone, and the session's
read-only runtime tree with distinct area icons. The workspace owner can browse
Session files, including archived history; other project members see Repo and
Drop Zone. People and the AI can exchange files outside the repository through
the Drop Zone. People can upload, drop multiple files, download, edit, rename,
and delete its contents. This temporary exchange is excluded from saved work
and archives and disappears after successful archival; a renewed session
starts with an empty Drop Zone.
Files refreshes after the assistant finishes a turn without discarding the
person's place or unsaved edits. People can download individual files and keep
personal project-wide stars, reachable from chat and the file browser in any session.
Code explanations use the workflow's Economy model and show which AI answered.
A collaborator can ask for explanations when that model or its shared backup is
available, even when the main conversation uses the owner's personal account.
Changing the effective AI connection or user requires a new explanation before
follow-ups can continue. Stop and Close remain available without AI access.
Opening a binary or oversized file from chat or Files keeps its filename visible
and offers Download without placing it in the text editor.
Supported bitmap images open directly in the file pane, scaled to its width
with scrolling for tall images. Download remains available; an image that cannot
load offers Retry.
The file browser keeps starred filenames on one line and starts larger lists
collapsed.
Open file and Find in files use indexes for each project working session,
including ignored files. Indexes live outside the source tree and survive server
restarts. Content indexing reads changed files instead of rebuilding unchanged
content; progress stays visible while results fill in. Editor-created filenames
are discoverable immediately; Refresh picks up outside changes, and subsequent
searches also refresh discovery after a short interval.
On phones and tablets, Files prioritizes the open file. Repository browsing and
search stay hidden until requested, and choosing a file returns to its contents.
A compact toolbar keeps the filename and Save visible, with other actions in a
menu. Drop Zone and Session previews also use a compact file toolbar.
Chat responds to confirmed message acceptance and interruption immediately;
background bookkeeping must not keep Send, Stop, or the saved-commit cleanup
prompt busy after that confirmation.
Send and Steer clear submitted text immediately so people can write their next
message while delivery is pending, with failed messages kept recoverable.
During active work, people can submit further steering before earlier delivery
finishes. Each undelivered bubble is visibly Pending, and messages are delivered
in order. A failed bubble shows its error and Retry, which reuses that message's
identity and preserves the current draft.
An interruption failure stays visible without covering the composer or its retry controls.
Repair conversations keep their input and action buttons visible on small screens.
Long drafts scroll inside the input; repair details start collapsed, and a shared
connection notice replaces repeated reconnection warnings. Failed automatic repair
requests show a short description instead of internal agent instructions.
The main chat composer keeps Add, Settings, Goal, plan allowance, and icon-only
Send together, with Stop beside Send while needed. Goal and available allowance
stay visible when menus are closed. Add holds left-aligned attachment actions.
The Settings cog stays aligned with the neighboring icons, with its assistant
and model named in a small shaded rectangle underneath, readable in light and
dark themes. The label can extend beyond the circle without moving the icon or
increasing the button height, and the button has no tooltip. New replies retain their
answering AI when the selection changes: Codex, Claude Code or OpenCode with its model.
Hovering a reply's name shows its saved model, provider and thinking choice.
Older replies without a saved AI identity simply say "agent".
Main and ordinary temporary chats offer Plan, Code, Economy and Auto from one
compact icon in the composer's bottom toolbar. The icon reflects the selected
mode; its menu shows model assignments, the selected mode and automatic review.
Toggling review keeps a custom model and thinking choice for the current mode.
Unavailable modes explain why and are identified as disabled to screen readers.
Recommendations rank compatible models for each job, favouring Astra for planning
and DeepSeek for economical implementation. They preserve saved choices rather
than silently changing models when the catalogue or recommendation policy changes.
Connecting a newly usable assistant fills missing routing roles with compatible
recommendations and opens them for review. Repeating setup preserves saved
choices, including roles the owner deliberately left empty. New ordinary chats
start in Plan with review off. Creation and renewal share a workflow picker that
previews the user's effective Plan and Code models, including Shared backup.
Creating the first chat explicitly fills missing defaults, so included OpenCode
works without a credential-setup step. Reading those defaults does not save them.
Owners can open Model routing directly over the chat, with its saved workflow
selected, without visiting account settings. The form separates Plan/Code from
independent Router/Economy and Shared backup. It previews what owners and
collaborators will use before Save; a foreign Backup keeps planning and coding
together there, including when review is off. Missing assignments point to this
setup; other users are directed to the owner. Each assistant application has its own saved models for
the explicit modes and Router. Auto asks Router to choose Plan or Code when a
message is sent; discussion, mixed requests and unresolved decisions go to Plan.
Routing is visible before delivery, and each routed exchange retains its mode
and answering model. Plan is instructed not to edit files. Code implements
agreed work and stops for an unresolved architectural or product decision.
Steering stays with the currently working assistant.

People can enable Review after coding. After a normally completed Code turn,
one visible follow-up asks the Plan model to inspect the implementation and fix
in-scope defects. Its findings state what was checked; completion is not a
guarantee of correctness. Hosted AI work rechecks the submitting user's current
access before starting, including automatic review and Retry. Removing that
user blocks further inference without losing completed coding work. Stop
cancels pending review, and an interrupted review
remains incomplete. An unanswered structured question keeps the coding model
selected and skips review so the user can answer first. Goals require a concrete
mode and model, with Auto and automatic review unavailable. In Auto, the goal
menu explains that a concrete
mode must be selected before offering Start or Resume. Background helpers use
the independent Economy role.
AI controls includes a Close button that remains available while the assistant
is working, so dismissing the panel does not require tapping outside it.
The Settings cog opens AI model and access controls directly, with recovery
guidance and pending message requests in the same panel. The chat-mode icon sits
to the right of Settings, followed by optional companion controls and the
starred-files icon. These controls remain accessible
while the menu is closed. Icons sit close together in narrow chat panes, with
spacing increasing gently as the pane widens. Gaps close in narrow panes so
Send and Stop stay alongside the icons, goal and allowance in one row on mobile.
Compact panes reduce horizontal button padding and icon widths while preserving
the existing touch-target height.
The desktop chat pane can shrink to 320 pixels, keeping Send and the working
assistant's Stop button on the same row as the other controls. Narrow screens
use the full-width chat.
Host-provided conversations enter chat only when explicitly opened through the
host's own navigation. Their tab disappears when returning to another chat;
ordinary chat controls do not retain a permanent shortcut.
On narrow screens, swiping left shows the selected Preview or Dashboard and
swiping right returns to chat. The header supports either gesture, including
above an embedded preview; ordinary chat and dashboard areas support them too.
Drafts and the running preview remain intact. Scrolling, text entry, selection,
interactive content and browser edge gestures keep their normal behavior.
The existing pane-switch buttons remain available.
The empty input stays compact and grows with entered text. Recovery guidance
uses a Settings badge and popover with Continue instead of a permanent footer;
Continue preserves existing drafts and attachments for review.
The goal popover keeps its status and Pause/Resume/Cancel controls beside a short
objective preview. People can open the full wording in a scrollable dialog
whose Close action stays visible.
Markdown tables keep words readable and columns sized to their content. Wide
tables scroll within the message on small screens, including with the keyboard.
Numbered chat questions and their suggested choices retain the same inline
Markdown formatting and file links as ordinary assistant messages.
An explanation after a question does not suppress its answer field.
The hints row always reserves its height immediately above the message input,
following the input as it grows without shifting the chat when hints change.
Provider failures reach the conversation even when no assistant answer is created.
Resending after a connection failure shows any new failure beside that attempt.
Confirmed Stop releases chat controls without requiring a final provider message.
Completed assistant replies appear immediately, including answers to steering
questions while a goal continues. Assistant text also appears as it arrives on
phones and desktops, and becomes one saved reply when complete. Reconnecting
restores live text while the observing server is running; Stop removes unfinished
text without recording it as a completed answer. Each reply remains in the conversation;
showing it does not finish the goal or disable further steering.
Reading saved Codex history after live delivery or a restart preserves each
reply once, including when two separate replies contain the same text.
History requests retain messages delivered live while the request was pending.
A delayed partial update cannot remove an already displayed answer or progress.
Deliberate Undo still removes its selected exchange through the saved history.
Consecutive reasoning summaries form one collapsible progress group, regardless
of storage rows or automatic goal turns. The latest group previews current
reasoning while the assistant is working; ordinary messages separate groups.
Reconnecting preserves the selected model and reasoning effort and requests
short reasoning summaries for continuing goals as well as new messages.
Assistant status recovers automatically after a failed connection check, without
requiring a page reload or interrupting the assistant's work.
Failed checks retain their reported reason beside Retry. A server configuration
error that requires repair stops automatic retries, keeps the draft editable,
and clears only after a successful check. Long workspace paths do not prevent
the assistant's local command controls from starting.
An idle assistant whose process has stopped reconnects through the ordinary
connection check, retaining completed replies without asking the person to
resume finished work. Startup and disconnect cleanup cannot block each other.
Connection recovery retains the assistant's exact process ownership even when
another connection has removed its runtime files. Retry verifies that process
has stopped before reconnecting and leaves any replacement assistant intact.
After a confirmed Codex or Claude process replacement, the assistant receives
its complete session instructions before continuing its saved conversation.
Reconnecting to the same running process does not refresh those instructions
or add an opening prompt to the conversation.
Sessions sharing a Codex assistant process wait for the same startup operation.
A busy startup lock keeps them reconnecting and retries automatically without
stopping other sessions' work or goals.
Startup and connection checks automatically release a stale assistant busy
record once the assistant confirms that its conversation is idle and has no
active goal. Save and Update then become available without manual repair;
unknown or active execution stays protected, and recovery does not resume work.
When an AI account is disconnected, the conversation explains that sign-in is
needed and opens AI Accounts directly. It keeps the draft and checks again when
the account changes, without repeatedly presenting sign-in as a connection check.
While the Vibe64 server is running, every executing assistant session must remain
observed by the server and visible in its conversation, including across goal
continuations and connection replacement. Observation belongs to the session's
server lifecycle and does not depend on the person keeping its chat open.
Routine checks of an established assistant connection leave attachment uploads
available. Starting or restoring an assistant still respects session renewal
and cleanup.
Save and Update wait for active assistant preparation to finish. Save can proceed
without assistant naming, using a checkpoint-based version name and a visible
notice when naming is unavailable. Members can Save and create pull requests
when the main chat uses a personal connection. Optional naming uses effective
Economy or its eligible shared Backup; ordinary repository permissions still
apply. A request that
overlaps preparation waits briefly at the server and explains a timeout. Failed
requests remain readable and dismissible even before an operation starts;
their recovery controls fit the chat pane, including on small screens.
Operation cards share a subtle background that separates them from the chat in
light and dark themes. They keep their heading, status, progress text and colors when expanded;
opening details adds output and controls within the same shared presentation.
Copy and Collapse sit beside the progress description, beneath the heading.
People can explore the application through a compact searchable subsystem list
and a focused detail pane in Overview. Each authored subsystem explains a
responsibility and brings together its Program operations and owned or shared
data tables. Map opens the three-dimensional Machine City directly, showing
files, functions, and optional subsystem and implementation layers. There is no
separate Program presentation. A selected subsystem can be located in Machine
when its generated subsystem is available. Operations link to explanations and
source; tables with resolved database references link to the
relationship diagram, with a way back to the selected subsystem. Missing or invalid maps
offer a temporary AI task to generate or repair the subsystem map with the session's
selected model and normal workspace tools. The main draft remains untouched;
map edits stay in the session for review and Save. The subsystem view refreshes
when the task finishes. The task checks the declared format before reporting success.
An unreadable map can
also be opened directly for correction. Unresolved table references remain visible. The database
overview continues to explain the data itself.

People can explore a project's database through a readable relationship diagram,
including persistent SQLite databases as well as MySQL and PostgreSQL. SQLite
uses the project's declared filename, enforces read-only inspection, and supports
deliberate row edits through the same explicit unlock and confirmation controls.
Project members can browse and work with the database regardless of AI access.
Database Copilot uses the workflow's Economy model and checks that destination
for the person asking. A shared Economy model remains usable when the main chat
last used an owner's personal subscription. The Copilot names its effective
model; unavailable AI does not prevent database browsing or editing.
The diagram lets people explore their data,
starting with its keys and expanding detail when needed. Large diagrams load
without blocking typing or navigation while their connections are calculated.
Expanding fields keeps every table in place and preserves the current zoom.
Connections identify
the linked fields and their relationship, remain traceable while tables move,
and avoid covering tables where space permits. People can search fields, focus
on a table's neighbours, arrange or group tables, pin important positions, undo
layout changes, and keep named views. The session's diagram layout is shared
among its users: moving a table updates the other open diagrams automatically.
Data overview is the default database view, followed by the detailed ERD and
the query/data view. The diagram keeps the working space: routine search and Fit
stay visible, while occasional display and arrangement controls live in an
options menu. Overview concepts can be dragged continuously without waiting for
saves or jumping on drop, and retain their positions when reopened. It shows main actors with explicitly assigned supporting tables,
including tables several relationships away. Opening an actor fades the overview
behind the real ERD of just its contained tables, with its main table central and
supporting tables around it. A small loading indicator keeps progress clear
without covering the diagram area in flashing placeholders. Real tables start fully opaque; selecting a table
keeps it and its direct neighbours solid while dimming unrelated tables. Hovering
connections does not change which tables are dimmed. The shared table/field sidebar follows selection.
Scoped tables can be dragged by their headers, with their arrangement retained
while exploring. Closing the detail layer restores the unchanged overview.
Opening Data retains the originating diagram, and a labelled Back action restores
its selection, expanded fields, positions and camera through a short transition.
The data sidebar reveals the selected table. Database Copilot shows its current
table context and captures it with each question, so “this table” refers to the
selection at the time of sending. Project agents can inspect the main ERD’s
table rectangles and routed connections and submit revision-checked table moves
through the existing database command. Changes preserve unrelated layout state
and reach other viewers; returned prior positions allow reversing the batch. Every unassigned table remains available under Other tables. Balanced
generation targets 5–10 business concepts and their main business connections;
Very abstract targets 3–5 broader domains. All connections remain inspectable on
request, retaining actual table endpoints and schema cardinalities. People can edit the
grouping, promote a supporting table, or merge an actor into another. Their
configured assistant can generate an unabstracted, balanced, or very abstract
view and place important actors centrally with supporting actors spreading outward. Collapsed card area reflects table count, with a maximum 2× difference. Generation can replace the whole
grouping or process only previously unreviewed tables, preserving manual choices;
tables deliberately left in Other tables are recorded as reviewed. The definition
lives with project source so it is reviewable, versioned and maintained when the
schema changes; displaying it does not require an AI call. The same grouping,
main connections and actor positions work across session databases with the same
schema. MySQL database names are resolved from the selected session; PostgreSQL
schema distinctions remain explicit. Actual missing tables or connections still
need review.
In mixed-model Codex chats, switching after Astra compacts can recover the saved
readable conversation for DeepSeek or GLM without an extra AI call. Ordinary single-model chats require
no recovery. Unsupported histories, including Undo boundaries, non-text attachments
or excessive size, explain why the handoff cannot proceed rather than silently
dropping context. The saved conversation remains intact.
The first project message carries the relevant Genesis task prompt; later
messages and active-turn steering stay concise instead of rebuilding it. The
project's shorter durable operating guide is loaded when a conversation is
created and refreshed after compaction without becoming a visible message or
extra agent turn. For a new project, the opening conversation first establishes
what the person wants to make, who it is for, and the first useful outcome, then
asks before selecting any technology.
Before starting foreground assistant work in an idle session, Vibe64 refreshes
outdated unmodified Genesis skills through Genesis's own synchronization.
Customized skills are preserved and changes remain visible in the source diff.
Incomplete project setup declarations defer this automatic refresh so people can
continue chatting with the assistant to repair them.
Pending host-managed resources also leave starter selection, project inspection,
and chat available. Starting the application still requires its normal resource
and workspace preparation.
Starter selection waits briefly for session initialization. Once its source is
added, a later setup-check failure is shown as a setup problem with recheck,
without presenting the completed import as a failed action.
Background connection checks and active-turn steering do not perform this write.
Already-loaded guidance becomes current through the assistant's normal context
refresh lifecycle.
An unavailable project skill package leaves chat usable and identifies the
workspace preparation needed to restore the project's declared dependencies.
Update marks preparation as required before replacing session source, even
when its setup commands stay the same. People can also explicitly rerun a
previously successful preparation to repair missing installed dependencies.

People can configure application integrations in the session's Integrations
page. Available services are grouped into collapsible categories with counts.
Search narrows the services within each category and hides empty groups. Small
vendor icons identify services in the catalog, saved configurations and detail.
The form reads and writes the same portable configuration a person or AI
can edit from the command line. Secrets stay in Env. n8n setup can discover the instance’s public OAuth settings
on request, then guide client registration and consent using the application’s
own callback and credentials. Discovery updates the draft without connecting
an account. An explicit n8n registration action can save the new client and
private credentials, then start the application’s consent flow. An uncertain
result asks people to inspect n8n and Env before trying registration again.
Conflicting source edits
preserve the form draft and require a reload before saving.
An explicit assistant setup request appears as a Configure card in the saved
conversation. Opening it selects that session's development integration; a
removed slot is explained instead of opening an unrelated account. The card
survives returning to the conversation and reload. Opening it does not grant
consent, connect an account or automatically resume the assistant. People with
project access can skip a saved request; its Skipped state survives reload.
Connecting or checking an application integration and skipping its request do
not require AI access. Existing owner-only integration operations remain restricted.
Skipping leaves the application account connected and does not automatically
resume the assistant. When the application's setup command confirms the requested
connection, the saved card shows Setup completed. That records the setup decision;
later reconnecting or disconnecting the account does not rewrite the old request.
After setup, continuation uses the actor's effective Code model, including a
configured shared backup, without changing their selected chat mode or adding
automatic review. Uncertain delivery can be checked without sending twice.
If configuration changes while an application connection command runs, its result
is rejected and people are asked to reload and check the account before retrying.
The command is not automatically repeated.
Saving configuration does not claim that an account has connected; the application verifies account
access through its own connection flow. For a shared development account,
people can check that flow, connect, resume pending provider consent, cancel an
attempt, or confirm disconnection from Integrations. Missing application setup
is identified explicitly. Individual users still connect inside the application.
Returning from pending provider consent checks the application's connection
status automatically. A failed check leaves the attempt available to retry.
Connected accounts offer Reconnect for OAuth or Verify again for credentials.
Cancelling replacement consent keeps the previous OAuth grant. Credential checks
use the current Env value; a failed check remains visible without erasing the
last successful verification record.
When the application supplies a verified account label, the connection screen
shows which account is connected. The label is informational and disappears
after disconnection.
Disconnect removes the application's saved connection and pending consent.
Its confirmation explains that provider permissions, configuration and Env
credentials remain, and that provider-side revocation may affect other apps.
Changing the selected account or session dismisses outstanding confirmations.
When a host supplies production integration management, people can switch
between Development and Production. Production shows the published configuration
read-only and labels its release; changes are made in Development and published.
Development drafts survive the switch. The workspace owner can manage production
connections, and a changed release dismisses outstanding confirmations. The
selected environment and connection are restored when returning to the page.
A removed integration cannot trigger connection commands from a stale selection.
When a service needs a document identifier to verify access, people enter it
before connecting. That value survives navigation within the tab and is used
for the connection check without becoming source configuration or an Env value.
OAuth setup can suggest a callback from the host-supplied application address.
People can edit it and open Env with the key and value prefilled, then explicitly
save it. The callback can be copied, and Env explicitly labels replacement when
the key already has a value. The application must implement that route and the provider must register
it; showing a suggestion does not replace existing Env values.
Source-scanning integrations also keep their service credentials and policy
choices in that file. Saving a scanner configuration does not start a scan or
grant access to other projects in the workspace.
Application AI configuration starts with Big Pickle's free public access and
offers searchable models from a bundled, dated catalogue. People can instead
choose an administrator's Env key or individual accounts owned by their app's
users. Changing providers clears the previous key reference. The application's
chosen framework owns inference and personal account screens; this setup is
separate from the editor's coding-assistant accounts.
For integrations with assistant controls, people can disable assistant access,
set a default permission, or choose which actions require a decision. These
choices are saved with the same portable configuration and remain separate from
provider account permissions. The application owns enforcing them when the
assistant uses a connection.

People can choose the name Vibe64 uses in welcomes and collaboration cues.
Project owners can set a shared tone, answer length, assumed experience,
explanation style, and project-specific communication requirements in the
project's portable Genesis
source. Those choices apply when a conversation next establishes stable
context; they do not rewrite past conversation or get repeated with every
message. Personal names and prompt suggestions remain separate Vibe64 conveniences
and are not added to agent prompts.
Members can choose an accessible explicit mode even when the latest answer used
the owner's personal AI. Plan and Code show the actor's effective model and any
Shared backup. Auto remains unavailable when its required roles need personal
access substitution. While a personal turn is active, steering stays with that
turn's connection. Members who cannot send directly can compose messages and
attach files in normal chat using Send for approval. Requests remain visible above
the composer while the owner reviews them, even when the assistant is busy.
Owners see the author, full text and previewable attachments with Approve & send
and Decline actions directly in chat. Members can withdraw pending requests and
see recent decisions. Approval retains the author's attribution and safely
retries a failed delivery.
When the owner switches to a connection available to the workspace, members'
open browsers immediately return to direct AI use without reloading or losing
drafts and attachments. Switching back restores Send for approval in real time.
The suggestion service can use the actor's effective Economy model independently
of the personal connection answering in main chat. Conversation-based suggestions
are also shared without another inference when no helper is available. They
survive reloads, follow the current conversation and Blueprint, and never include
another person's unsent draft. The browser sends a private draft to the helper
only when that purpose is available, independently of the selected chat mode.

Prompt suggestions follow the person's current draft first, then the latest
conversation, grounded in the project's purpose. They help express the current
intent instead of repeating finished work or proposing unrelated generic tasks.
Changing the draft cancels superseded suggestion work without sending a chat
message or stopping the main assistant.

Standalone Vibe64 and hosted Vibe64 use the same AI Accounts screen and provider
configuration. Account settings offers Codex with GPT, DeepSeek and GLM, Claude
Code, and OpenCode's provider catalogue. OpenCode Big Pickle is included without
sign-in. Provider credentials and shared model-routing assignments belong to the
editor's account storage, outside the project. Native Codex and Claude credentials keep
using the host's existing account context, including in a nested development
preview. Hosts supply account storage and management permissions; they do not
maintain a separate provider setup implementation.

The chat selector stays focused on choosing among AIs that are already
configured and connected. With no connected AI, the session picker directs
people to account setup. A host may contribute an always-available built-in
OpenCode connection and identify one connected provider as the preferred
new-session default. Workspace owners manage account credentials and add
further connections in the separate account-management area. A connected
Codex account shows its ChatGPT email when available; API-key access
does not invent an account identity. Connected accounts offer Disconnect.
Account setup keeps its title, connection status and Refresh action in one
wrapping header row.
Codex connections remain usable when a successful native login omits OpenAI's
account identifier. Vibe64 tracks each successful sign-in separately, preserves
that local identity across restarts and token refreshes, and retires earlier
helper work when the person signs in again. It never invents an OpenAI account
identifier or rewrites the native credentials.
Existing installations receive historical metadata repairs through numbered
deployment upgrades with read-only preflight, warnings, backups and a record of
completion. Errors block activation. Ordinary account reads do not repair old
formats, and the Codex identity upgrade does not rewrite project source.
Routing upgrades preserve saved destinations, conversation identities and
delivery evidence, including archived and temporary conversations. Conflicting
old helper choices remain visible for owner review. Interrupted publication
resumes from the same prepared changes and retains the original backups.

Codex code sign-in presents preparation and authorization as two clear steps.
The full one-time code stays on one line beside Copy, with one primary action
to continue to ChatGPT. Reference screenshots open on request, and the flow
remains usable on narrow screens and in either theme. The settings and continue
actions share a row when space permits, Previous step and cancellation sit beside
sign-in status, and the login terminal uses a separate shaded surface. Once the
code is ready, authorization shows no repeated introduction or waiting message.
Each distinct
connected OpenCode provider route remains its own choice, including separate
plans from the same provider. The chat selector shows only models the host
currently permits, while a host model-access policy can expose one recommended
recovery model and give the owner a warned switch for broader access. Starting
a session presents the configured list promptly without waiting for an AI
provider to start or discover models. People can switch the assistant application,
provider or model between turns without replacing the session or its files.
Returning to an application reuses its previous native conversation. OpenCode
creates its own conversation IDs; Vibe64 saves them across restarts and application
switches. The next
ordinary message carries recent history for a new application, or missed and
corrected messages for a returning one, before the person's request. Choosing
an AI alone sends nothing. When the assistant is idle, Undo last turn removes
one prompt and its replies from the conversation, retaining earlier context.
Undo stops at an AI switch: the removed turn and its predecessor must both use
the currently selected assistant application. Files, databases, and external
actions remain unchanged. The removed prompt returns to an empty composer for
editing. An interrupted Undo can be retried without removing another turn. An unavailable old connection does not prevent
choosing a connected replacement. Leaving a model's
thinking choice at its provider default leaves that choice to the provider
instead of silently selecting another listed option. Vibe64 also respects each
AI's declared response capacity rather than assuming every model can produce
the same size answer.
Codex offers GPT, DeepSeek and GLM as named provider choices. GPT retains
ChatGPT device sign-in and OpenAI API-key setup; DeepSeek uses its own API key,
and GLM uses a Z.AI Coding Plan key. Regular Z.AI API connections use OpenCode;
they are not presented as verified Codex connections. Provider URLs and supported models are
curated by Vibe64, with no custom URL field. Each connection has a private key
and uses its provider's name automatically. Connecting or removing one preserves the others.
Routed Codex conversations switch models and providers within the same native
conversation, preserving its history without restarting the shared assistant
service. Older conversations already stored in separate provider homes retain
their history; an unsupported adoption is explained before sending. Switching
between different assistant applications retains the existing changeover behavior.
Routing offers qualified model–orchestrator combinations. Connecting a key does
not prove history can pass safely between models; unverified choices show
Compatibility pending. The Codex runtime preserves native history and translates
recognized foreign reasoning into readable historical context when OpenAI needs
it. Handoffs do not add a summarization call.
Undo cannot cross a Codex provider switch.
Helper work uses the actor's effective Economy model and its connection.
The GPT models and thinking choices come from the connected Codex service,
so newly available GPT models appear without an editor update.
After Codex login or logout, an unfinished account transition automatically
retries on the next ordinary account status check, including after a service
restart. Recovery uses the saved credentials without asking the person to sign
in again. Confirmed recovery clears the earlier login error; unverified runtime
shutdown remains a visible failure.
Completed helper cleanup is acknowledged by its waiting task, so account
switching does not report a second cleanup failure for an already retired thread.
Once the old assistant process is confirmed stopped, unfinished helper-history
cleanup stays recorded for retry without preventing logout or a successful new
login from becoming available. Unverified process shutdown still blocks the
account transition.
AI choices load while the session is open and remain visible during refresh,
so opening the model menu does not restart its loading screen each time.
Codex helper tasks accept the installed stable Codex version when it meets the
minimum requirement, so upgrading Codex does not require an editor update merely
to recognise a newer version. Helper isolation checks still apply.

Renewing a session keeps its current AI by default, while letting the person
choose any other connected assistant application, provider, model, and thinking
option for the fresh session. Vibe64 validates that choice when renewal starts
and records it with the handover, so recovery and retries create the successor
with the same choice. If the old model cannot prepare the draft, the person can
complete the canonical handover template instead. Once the approved handover is
accepted as the first turn in that fresh assistant conversation, renewal
completes even if the model cannot answer it.
The new session and its handover remain available for the person to repair an
expired login, quota, or provider problem and continue. Renewal stops only when
Vibe64 cannot establish the fresh conversation, its handover, or its saved
source safely.
Failed renewals always offer an explicit Retry, including after reopening the
dialog. Save or Update prerequisites can be corrected in the old session;
Retry checks the current conditions before continuing the saved renewal.
Archiving cannot remove the original session while renewal still reserves a
private replacement; the original session and its Retry action remain available.
Renewal takes its source identity from the project's configured authority and
verified Git commit, or the server-resolved PR authority bound to that session.
Renewal preserves a PR session's destination. Arbitrary legacy session metadata
does not redefine authority.
Retries keep the saved handover without asking the AI to write it again. If the
source or conversation changed, the existing text returns for review with
current source details before the person confirms continuation.

File Save writes the session file. The chat and Changes actions instead open
Review changes, naming the session, whole-tree file scope and exact destination.
A local project offers Commit to its branch; a Vibe64-only project offers Save
project version; GitHub offers Create draft PR and an explicit Commit & push
to the named repository and branch. The server rejects an outdated destination
review. Working files, recovery checkpoints, project versions, database rows,
conversation history and application publishing have separate effects.

Every project has exactly one source authority. For a GitHub-connected project,
the configured GitHub branch is authoritative. For a hosted Vibe64-only
project, Vibe64's own repository is authoritative. For a standalone local
project, the folder the person opened is authoritative and Save records the
session's work there as an ordinary local commit. A PR session has an explicit
GitHub branch authority of its own; publishing its work does not change the
project authority or notify sessions that track a different branch. Hosted
session creation also offers an optional existing or new branch. The default
remains the project branch, and database scope still determines session limits.
Explicit branch destinations survive renewal and archive indexing. Choosing a
branch for a new session does not switch another session's files or database.
GitHub project owners can require PR publication in the Vibe64 workflow. This
does not retarget existing sessions or replace GitHub's own branch protection.

Standalone projects expose Fetch, Pull, Push, Switch branch, New branch and
per-branch remote settings. Branch changes require a clean original folder and
no unfinished Git operation. Existing sessions retain their branch binding;
switch the folder back before accepting their work. Branch changes never push.
Their project header keeps the new-session + beside the project name and one
compact Git dropdown. A badge signals incoming/outgoing commits or a failed
check. The dropdown contains sync status, Fetch, Pull/Push with commit counts,
remote destinations, the last check time and settings. Small screens show an
accessible Git icon so the + stays visible. Session limits, creation permissions
and Git review/confirmation remain unchanged.
The original folder's checked-out branch and native Git configuration determine
separate pull and push destinations; Vibe64 never assumes origin or main.
Fetch reports incoming and outgoing commits without changing working files.
Pull updates a clean local baseline, with an explicit merge when histories
have diverged. Push separately publishes saved local commits without force.
Terminal Git remains available. If it rewrites the baseline, a person can
review and reconcile an existing session's changes onto the new history,
keeping its conversation and recoverable work. Hosted source authority and
its Save and Update workflow remain unchanged.

The muted repository action remains clickable to request fresh status from
the server. It shows “Checking…” while waiting, then reflects the latest Save
or Update state without invoking either action. Repeated clicks cannot start
overlapping checks; archived sessions, suspended source access and repository
operations still block the control.

All hosted editing happens in isolated session checkouts. A hosted project's
container is never an application checkout and is never used as a source or
cache. Vibe64 may keep a disposable local mirror of GitHub history solely to
speed transfers, but sessions still clone from GitHub, every successful Save is
verified there before the mirror is refreshed, and a missing or stale mirror
can never change correctness. Vibe64-only projects use their Vibe64 repository
directly and do not retain another project-level checkout. A new hosted project
is not ready until its authority contains its initial Genesis foundation and
can create a session.

Vibe64 preserves the exact output of managed Git commands so file discovery,
binary content, and verification checks see the same data as ordinary Git.
Managed Git and GitHub commands share a thirty-second execution budget with
their credential lookup. A slow command is not reported as a disconnected
assistant. Vibe64 waits for execution cleanup before returning its result,
distinguishes connection failures from timeouts, and never automatically repeats
a write whose result is unknown.
When such work fails, the assistant identifies the affected action, confirmed
completed work, what remains undone or unconfirmed, and the next safe step.
It distinguishes an action that was never attempted from one whose effects
need checking, and does not present an unproven cause as a diagnosis.
It manages project access, credentials, development environments, application processes, previews,
browser identities, and attachments without putting private machine state into
the project. Chat attachments have readable image or file references for every
supported assistant. People can open attached images, download files, and return
to sent attachments throughout the conversation and its archive. Selecting several
files shows the whole queue immediately and uploads them in order without manual
retries for ordinary contention. Brief assistant preparation keeps uploads pending;
typing and cancelling queued files remain available. Removing a
queued upload removes its unchanged reference; editing the message alone does
not remove a file. It shows clear status and failures and lets people retry or ask the
agent for help. When a provider reports exhausted quota or another account
failure, completed project work remains available and the conversation gives a
direct route to the relevant account recovery. Non-urgent background checks
favor useful freshness over constant polling: hidden views stop checks that
serve only that view, returning
to a view refreshes it promptly, and repeated failures slow recovery checks.
Open sessions that choose the same coding-assistant application
share one running assistant service, and that service stops when its final
session is archived. Suggestions and focused helpers use their configured
Economy destination in independent scopes; cleanup ends their native work without
rebinding or stopping the working chat. A helper may use another orchestrator.
Suggestions and tool-free helper conversations can run alongside preview and
foreground work. Only operations that change shared source or prepare its
environment require the source lock. A ready preview replaces any stale error
from an overlapping start request.
People can inspect and explicitly restart the application while the assistant
is working; automatic startup waits until that work is idle. Targets can declare
named text parameters with defaults. Preview options presents those fields,
validates required values, and applies them only on Run or Save and restart.
People can remember values for that project and target in the current browser.
Selecting an application identity returns the assistant's browser to managed
Preview if it has navigated elsewhere, without requiring a manual browser reset.
Identity selection within Preview preserves the current page.
Assistant browser tools consistently identify the managed Preview address for
navigation, keeping direct application addresses in diagnostics. A missing
Preview address is reported as unavailable.
Agents can run a browser suite against a project's declared test Preview target.
Vibe64 starts that target, waits for readiness, uses its application identity,
and restores the previous Preview when the test command finishes. The project
owns disposable test data and suppression of external effects. Competing target
changes are refused while the suite owns Preview, and cleanup failures remain
visible. The same commands and instructions apply to every assistant.
Related checks share one suite startup and one restoration for the whole command.
Cancellation waits for the command and its children to stop before restoring Preview.
Agents can inspect the current run and cancel its exact ID; repeated cancellation
joins the same cleanup. Failed cleanup or restoration retains ownership for an
explicit retry. These controls introduce no background polling or restart loop.
Shared guidance keeps ordinary browser preparation incremental and separates
fresh-database proofs from routine checks.
When the host records a process/thread denial during a failed browser command,
the caller sees the resource diagnostic and incident reference for investigation
before retrying.
If another assistant operation briefly blocks automatic preview startup, Preview
waits and retries without raising an error. Other startup failures appear once
with a retry action.
A prepared preview can start while another assistant operation holds the session
lock. Vibe64 checks the current setup recipe and environment first; preparation
that changes files or resources still requires the lock.
Project-understanding warnings do not replace the application preview. People
can read a persistent warning, recheck setup, and keep using the preview's URL,
reload, and navigation controls. Starting an application still requires valid
launch settings.
Setup help opens a new Temporary AI conversation even while the main assistant
is working. This applies to setup warnings, inspection failures, starting through
conversation and adopting an existing project. The request includes the reported
problem or project purpose and preserves the main conversation and its draft.
Starter installation still waits for active source work to finish.
Commands and background processes started for a session remain owned by that
session and stop with it, even while the assistant service itself is shared.
Assistant terminal commands retain readable shell text through the session
wrapper instead of displaying an encoded payload and an inline reconnect warning.

Temporary repair chats keep progress collapsible inside the conversation and
show one plain working status above the composer. Switching sessions preserves
the selected temporary chat and its reply draft. Closing an incomplete Update
repair warns that partial edits remain, waits for the AI to stop, and keeps the
chat available when stopping or closing fails. A completed Update repair is
verified by Vibe64 running Update, with the actual result shown in that chat.
A request for a decision waits for the person's reply before verification.
Remaining conflicts return to the same repair conversation instead of opening
another task. Automatic repair is bounded and pauses on repeated failure. A
persistent Check Update action lets the person verify prepared edits themselves;
the header's Update action checks the existing repair too. Update progress stays
visible above both main and temporary chats. Conversation tab buttons align above
their scrollbar, and Main chat remains visible while the other tabs scroll.
Only a successful Update is presented as finished; it does not publish work.
When updated source needs workspace preparation, a direct Prepare workspace
action runs the project's declared setup steps. The notice does not claim the
Update is still running or require an AI repair for routine preparation.

Short actions show one compact progress line that a person can dismiss or open
for full history. The browser remembers a dismissal for that exact attempt
across reloads, while a new attempt appears normally. Long-running application
output stays out of the way until opened and remains available after the run
ends. Project agents are instructed to keep full test logs in local artifacts
and return concise results, preserving failure evidence and Preview-restoration errors without
repeatedly loading passing output into the conversation.
Preparing an authenticated test suite obtains temporary cookies without
launching a second browser or rendering the application before the tests.
An interactive AI terminal is launched
explicitly, always matches the kind of assistant chosen when the session began,
and can be closed independently of the conversation. A project that declares
no application output remains idle: Preview says there is nothing to run and
keeps output-status refresh available without offering an empty launch menu.

Genesis remains the portable authority for what a project is, how its Program
is explained, which technologies it uses, its environment/resource
declarations, and its explicit Verification evidence. It also composes and
transports other named Stack sections without interpreting them. Vibe64 owns
the strict mechanical contracts for workspace setup, launch, preview identity,
and application deployment, then executes them under its host policy without
inventing commands from a framework or project shape.
Projects can also declare initial memory estimates for preparation, application
startup and running work. These hints are separate from measured use and host
limits; missing or invalid estimates do not by themselves block a valid
application or require successful preparation to run again.
When a host refuses preparation or Preview for resource reasons, people can
inspect the host's recorded decision and use its recovery controls without
opening another AI chat. Reloading preserves access to that refusal; a healthy
running Preview supersedes it. Accepting recovery follows the original start
instead of launching a duplicate. Rechecking first reads current preview state;
it never force-restarts an app merely because its start response was lost.
Test-specific refusals remain test-specific: inspecting or rechecking one must
not turn it into an ordinary application start.
When the host holds a browser test because resources are unavailable, the normal
Preview remains usable during a five-minute decision window. Chat says it is
waiting for resources. The owner can resume the same test or cancel
it; expiry also ends the request without running tests. Reloading the page does
not discard the wait, but losing the owning assistant does. Retry still
checks current safety and never creates a duplicate test.

Deslop is a deliberate cleanup that preserves behavior, not an automatic extra
agent turn. After Save, Vibe64 may offer Deslop for the exact commit it just
published. Accepting uses the ordinary visible project conversation; declining
has no lasting effect. The offer uses the normal theme surface and a filled
Deslop button so its label stays readable, including while unavailable during
active work. People can also request Deslop for the agent's changes
to the current task, including unsaved work, or explicitly select commits.

People can choose how cautiously the AI engineers a project. The choice follows
the project's source, always keeps ordinary work simple and targeted, and makes
the AI ask before a real requirement forces materially greater complexity.


Integration setup takes people directly to the matching development Env key for
credential entry, with secret values masked and an explicit save.

Returning to Integrations restores the selected service and search for that
project session and checks the application's connection state again.

Unsaved integration configuration stays available when people switch sessions or
visit another project page in the same tab. Returning checks for outside edits;
closing or reloading warns before losing an unsaved draft.
If saving is temporarily blocked by assistant work, people can retry with their
draft intact. Actual outside edits still require reloading before saving.


Stripe and Paddle configuration includes recurring payment plans, feature names,
renewal credits and separate sandbox/live account and Env references. The editor
explains payment events and checkout setup and suggests application URLs from
the host-supplied address. Saving this declaration does not create provider
products, charge customers or certify that the application implements payments.

Paddle payment setup distinguishes its public checkout token from backend
secrets and opens the matching Env entry for each. A public-token entry starts
with its key filled and an empty, unmasked value for the user to supply.

Workspace owners can explicitly preview a development project's payment
catalogue for its configured sandbox or live merchant. The application command
returns proposed changes, provider drift and unfinished requests. Publication
requires reviewing the target account and environment in a confirmation;
configuration edits invalidate the review. Missing application implementation
is explained. Provider records and publication state remain with the app.

For configured Stripe/Paddle payments, the public editor can prepare a reviewable
chat draft covering app billing, signed webhooks, credits and the payment
catalogue command. The draft carries the public operation contract and native
framework guidance, so generated projects need no access to the editor's source
checkout. Preparing the draft does not send it or publish provider changes.
It also includes the portable payment schema, semantics and expected test outcomes
for the chosen framework, without requiring non-JavaScript apps to run JSKIT.

Payment readiness is a separate read-only app report. The editor shows credential,
merchant, charge/payout, catalogue, webhook, checkout, website and deployment
checks individually. Unknown/manual checks remain visible; no single badge
claims provider approval or launch readiness from a valid API key.

An interrupted payment catalogue write can be recovered from the editor by
reviewing the pending operation and confirming a matching provider object ID.
The application verifies the current review and provider object before updating
its own mapping. The editor never clears uncertainty solely on a claim that no
provider object was created.

Payment management also works against a host-selected published release, while
its configuration stays read-only. The owner reviews its catalogue using that
release's environment; a release change discards previous reviews and results.

Payment management includes read-only billing history for an explicitly selected
application billing account. Subscription and invoice/transaction pages retain
provider status, distinguish unknown paid amounts, and offer bounded pagination.
The application authorizes access and resolves its own provider customer mapping.

Dashboard sections use a compact navigation selector on small screens while
keeping the active form mounted across viewport changes. Resizing does not
discard its unsaved values, validation feedback or loaded results.


Amplitude setup can register a new confidential OAuth client at its selected US
or EU authority. The workspace owner explicitly supplies the application callback
and permissions. The existing registration action saves the client secret,
callback and recovery ID in development Env before saving the public client ID
in project configuration, then starts the application’s connection command.
Existing Env values are preserved, and uncertain registration or local-save
failures require inspection before retrying. This does not attach Amplitude
tools to the editor’s coding assistant.

Atlassian uses the same explicit project OAuth registration operation as Amplitude.
Its button uses the fixed Rovo MCP v2 registration authority and selected product
permissions, then saves only references/client ID in configuration and credentials
in development Env. Owner, file-hash, unshared-registration and existing-Env checks
apply before a provider request. Ambiguous results require operator review before
retry. Manual registration remains available. No editor tool attachment is added.

Confidence Flags and Confidence Exp reuse the project OAuth registration action.
The owner registers against the fixed Confidence MCP authority; the client ID
is saved in configuration and the secret/callback/recovery ID in development
Env. Existing values and uncertain-registration safeguards remain enforced.
Consent and callback execution belong to the application; this does not attach
Confidence tools to the Vibe64 coding assistant.

Sanity setup can register a project-owned OAuth client explicitly, save its
credentials in development Env, and start the application's consent flow.
Existing Env values remain protected. People may instead supply a Sanity API
token. Saving either connection does not attach tools to the coding assistant.

Google Ads shared-account owners can prepare an existing-account Search campaign
in Integrations, create it paused and separately review launch, pause and reports.
The application owns credentials, Google calls and advertiser authorization; the
editor saves a portable campaign plan and invokes its declared command. Google
bills the selected account directly. Tracking/billing readiness is confirmed by
the operator; account provisioning and other campaign types remain outside this
first Search path.

When Codex uses a ChatGPT plan or Claude uses a subscription, authorized account users can see the remaining
weekly allowance as a single percentage on the bottom chat row, with its
label, known reset times, and the five-hour allowance in the hover/tap details. Allowance is account-wide, distinct
from conversation context usage. API-key connections and unsupported assistants do
not show a plan meter; unavailable readings never imply unused allowance.

For Codex, the bottom chat row exposes goal controls with a flashing red light for a running goal and a steady
muted warning light for a paused goal. Elapsed running time appears beside the light
when the chat pane has room and remains available in its details. Paused time
does not accumulate. Reduced-motion settings keep the running light steady.
Goal controls are optional; OpenCode does not expose them.
People can set an objective with an optional token budget, including before the
first chat message. They can open its details and pause or resume an unfinished goal without
losing its objective or usage history. Pause prevents further automatic turns;
the current turn continues until it finishes or the person presses Stop.
Cancel removes an unfinished goal, including a blocked or budget-limited one,
so another goal can be set. It preserves the conversation and project work;
an already running turn still uses Stop for interruption.
Goal controls are separate from plan allowance. Starting or resuming checks the
goal's effective model access. Reading and stopping remain available after
personal access is lost, using the saved goal's connection. An unavailable goal
read never marks it complete or permits Auto or automatic review.
Automatic Codex goal turns retain managed command access after the assistant
process restarts.
Browser reconnects preserve healthy server-side work. When managed tool connections
become stale, Vibe64 repairs the same conversation and checks its tools before
continuing. Recovery preserves project edits, history and goal accounting, respects
an explicit Pause, and never repeats a submitted command. If recovery cannot be
verified, work stays stopped with a recoverable explanation.

Claude Code uses the same chat, model selector, Send, Steer, Stop and native
terminal surfaces. The owner signs in to their Claude subscription through a
guided browser-and-code flow in AI Accounts. The official CLI owns credentials,
and Vibe64 confirms the connected account automatically. Native Claude goals
appear in the chat toolbar: Pause stops the current turn and preserves the goal,
Resume continues it, and Cancel clears it. Claude goals have no token-budget
field. Tool-free helpers use the workflow's independent Economy role. New tasks
capture that choice without changing main chat or tasks already running.

Main conversation, temporary assistance, and database copilot share the same
conversation presentation. User-facing temporary chats have main chat's tools,
capabilities and project access in Codex, Claude Code and OpenCode, without separate permission
modes.
Temporary model and thinking choices come from the connected service's current
catalogue, including new Codex models and OpenCode models. Each chat retains its own workflow and selected model without changing Main chat.
An Economy or shared Backup turn can use another assistant application; returning
to Plan or Code retains the conversation already held by its effective assistant.
The server keeps their conversations, settings, drafts and sent attachments
until explicit Close. Reloading or navigating away does not stop their work;
returning restores the same chats. A server restart retains their history and
stops any work whose observation was lost until an explicit Send or Resume.
People can keep typing and use Steer during active temporary work, with Stop
still available. Guidance reaches the current native conversation; it does not
switch its model, re-prepare project source or add messages to main History.
A composing host may contribute a distinctly coloured workspace conversation
beside Main and temporary chats, including before a project session is open.
The host owns that conversation's permissions, persistence and actions.
Their messages stay out of main History. Close stops the conversation and any
active goal, confirms cleanup, and deletes its conversation data and attachments
while preserving project edits. Failed cleanup remains visible and retryable.
Successful Close removes that chat from other connected browsers; reconnecting
reconciles missed closures. Draft saves wait for brief assistant-operation
contention and retry automatically when it remains busy.
Opening a new session keeps main chat visible while the assistant prepares.
Temporary-chat restoration waits for confirmed assistant readiness on startup
and reconnect, then retries any remaining assistant-operation contention
automatically. This expected wait shows no error and needs no Try again.
Genuine load failures remain visible and retryable.
Sending a temporary message shows it immediately, including while its conversation
is being created. Sending and assistant work have distinct status labels. Failed
messages retain Resend, Edit and Cancel; retry preserves the original request
and leaves a newer draft and its attachments intact.
Temporary chats show who is typing in that same conversation, using the main
chat's indicator. Switching chats, sending, or leaving clears that presence.
New Temporary AI replies received while that conversation is hidden mark its
tab and the top incognito icon, or the session-actions menu when collapsed.
The indicator clears for each conversation when it is viewed; opening the menu
alone does not clear it or any session-renewal reminder.
Internal helpers retain their deliberate execution restrictions.

If Codex or OpenCode loses its server-side observation of a conversation, Vibe64
stops native work and verifies the stop. When the individual conversation cannot
be stopped through its control connection, Vibe64 uses the existing process
owner; stopping a shared process can affect its other conversations. An
unverified stop retains active ownership and keeps Stop available. Verified
stops remain stopped until an explicit Resume or Send. Drafts remain editable
during recovery. Connection checks retry an unconfirmed stop through its retained
owner before reconnecting; a transient stop failure does not require restarting
the editor or replacing the conversation. Recovery never repeats a sent message.
The composer updates from external state without losing
focus or selection.

People configure Router and Economy independently in Model routing. Hints,
commit naming and other bounded helpers capture the actor's effective Economy
choice, which may use another orchestrator, without retargeting the working chat.
The old per-account Helper model preference is retired. Existing choices are
backed up and incorporated or presented for review by the state upgrade.
OpenCode's native Economy subagent is available only when the resolved choice
uses the same OpenCode account; it inherits its parent's command controls.
Compact progress summaries use isolated, tool-free Economy tasks. Incomplete
fragments do not suppress later reasoning, and finishing the main answer never
waits for a summary model. Cancellation suppresses late results. Failed cleanup
retains its exact reference for retry, including after a service restart.
A project-guidance hook failure reports its timing, exit or signal and bounded
diagnostic output when available, with a retry instruction and preserved project
changes. Older hooks explicitly report when the cause is unknown.

When declared environment resources are missing, the project shows a setup
explanation and a direct route to Env, with missing variable names available on
demand. This works even when the project declares no runnable outputs.
Rechecking setup clears the notice once the requirements are satisfied.
Vibe64 never invents resource values or provisions standalone infrastructure.
Projects with only terminal or downloadable outputs explain how to run them
without displaying unavailable browser controls. Projects with no runnable
output remain usable through the conversation.

Project code indexing automatically prepares the language parsers it needs without
changing project dependencies. Hosts can provide a complete prepared parser set
for offline use. Indexing releases its native parser memory when it finishes,
while parser downloads remain cached for later work.

People install a compact built editor through npm while retaining the frontend,
terminal, repository and project-understanding features. Maintainers can build
and test the exact distributable before publishing it; release preparation does
not remove their installed development tools. The installed editor includes the
database drivers required by its Database view.
