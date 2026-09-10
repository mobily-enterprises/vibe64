# Blueprint

Vibe64 is the visual, managed shell around Genesis for people building software
with an AI coding agent.

People can open or create a project, work in isolated sessions, and have a
direct conversation with the agent while seeing the source, changes, running
application, environment, and the system's explained structure in one place.
Each session keeps valuable work recoverable and separate from unrelated work.
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
Files refreshes after the assistant finishes a turn without discarding the
person's place or unsaved edits. People can download individual files and keep
personal project-wide stars, reachable from chat and the file browser in any session.
Opening a binary or oversized file from chat or Files keeps its filename visible
and offers Download without placing it in the text editor.
The file browser keeps starred filenames on one line and starts larger lists
collapsed.
Chat responds to confirmed message acceptance and interruption immediately;
background bookkeeping must not keep Send, Stop, or the saved-commit cleanup
prompt busy after that confirmation.
Send and Steer clear submitted text immediately so people can write their next
message while delivery is pending, with failed messages kept recoverable.
An interruption failure stays visible without covering the composer or its retry controls.
Markdown tables keep words readable and columns sized to their content. Wide
tables scroll within the message on small screens, including with the keyboard.
Numbered chat questions and their suggested choices retain the same inline
Markdown formatting and file links as ordinary assistant messages.
An explanation after a question does not suppress its answer field.
The hints row always reserves its height immediately above the message input,
following the input as it grows without shifting the chat when hints change.
Provider failures reach the conversation even when no assistant answer is created.
Confirmed Stop releases chat controls without requiring a final provider message.
Assistant status recovers automatically after a failed connection check, without
requiring a page reload or interrupting the assistant's work.
Routine checks of an established assistant connection leave attachment uploads
available. Starting or restoring an assistant still respects session renewal
and cleanup.
Save and Update wait for the assistant connection to be ready. A request that
overlaps preparation waits briefly at the server and explains a timeout. Failed
requests remain readable and dismissible even before an operation starts;
their recovery controls fit the chat pane, including on small screens.
People can explore a project's database through a readable relationship diagram,
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
Scoped tables cannot be dragged; closing the detail layer restores the unchanged
overview. Every unassigned table remains available under Other tables. Balanced
generation targets 5–10 business concepts and their main business connections;
Very abstract targets 3–5 broader domains. All connections remain inspectable on
request, retaining actual table endpoints and schema cardinalities. People can edit the
grouping, promote a supporting table, or merge an actor into another. Their
configured assistant can generate an unabstracted, balanced, or very abstract
view and place important actors centrally with supporting actors spreading outward. Collapsed card area reflects table count, with a maximum 2× difference. Generation can replace the whole
grouping or process only previously unreviewed tables, preserving manual choices;
tables deliberately left in Other tables are recorded as reviewed. The definition
lives with project source so it is reviewable, versioned and maintained when the
schema changes; displaying it does not require an AI call.
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
Background connection checks and active-turn steering do not perform this write.
Already-loaded guidance becomes current through the assistant's normal context
refresh lifecycle.
An unavailable project skill package leaves chat usable and identifies the
workspace preparation needed to restore the project's declared dependencies.
Update marks preparation as required before replacing session source, even
when its setup commands stay the same. People can also explicitly rerun a
previously successful preparation to repair missing installed dependencies.

People can choose the name Vibe64 uses in welcomes and collaboration cues.
Project owners can set a shared tone, answer length, assumed experience,
explanation style, and project-specific communication requirements in the
project's portable Genesis
source. Those choices apply when a conversation next establishes stable
context; they do not rewrite past conversation or get repeated with every
message. Personal names and prompt suggestions remain separate Vibe64 conveniences
and are not added to agent prompts.
Prompt suggestions follow the person's current draft first, then the latest
conversation, grounded in the project's purpose. They help express the current
intent instead of repeating finished work or proposing unrelated generic tasks.

The chat selector stays focused on choosing among AIs that are already
configured and connected. A host may contribute an always-available built-in
OpenCode connection and identify one connected provider as the preferred
new-session default. Workspace owners manage account credentials and add
further connections in the separate account-management area. Each distinct
connected OpenCode provider route remains its own choice, including separate
plans from the same provider. The chat selector shows only models the host
currently permits, while a host model-access policy can expose one recommended
recovery model and give the owner a warned switch for broader access. Starting
a session presents the configured list promptly without waiting for an AI
provider to start or discover models. A session stays within
the assistant application that owns its conversation. Leaving a model's
thinking choice at its provider default leaves that choice to the provider
instead of silently selecting another listed option. Vibe64 also respects each
AI's declared response capacity rather than assuming every model can produce
the same size answer.
The chat's Codex models and thinking choices come from the connected Codex
service, so newly available models appear without an editor update.
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

Every project has exactly one source authority. For a GitHub-connected project,
the configured GitHub branch is authoritative. For a hosted Vibe64-only
project, Vibe64's own repository is authoritative. For a standalone local
project, the folder the person opened is authoritative and Save records the
session's work there as an ordinary local commit.

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
It manages project access, credentials, development environments, application processes, previews,
browser identities, and attachments without putting private machine state into
the project. Chat attachments have readable image or file references for every
supported assistant. People can open attached images, download files, and return
to sent attachments throughout the conversation and its archive. Removing a
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
session is archived. Short-lived suggestions and focused helper tasks reuse the
session's chosen service instead of keeping another assistant service running.
Suggestions and tool-free helper conversations can run alongside preview and
foreground work. Only operations that change shared source or prepare its
environment require the source lock. A ready preview replaces any stale error
from an overlapping start request.
People can inspect and explicitly restart the application while the assistant
is working; automatic startup waits until that work is idle.
Agents can run a browser suite against a project's declared test Preview target.
Vibe64 starts that target, waits for readiness, uses its application identity,
and restores the previous Preview when the test command finishes. The project
owns disposable test data and suppression of external effects. Competing target
changes are refused while the suite owns Preview, and cleanup failures remain
visible. The same commands and instructions apply to every assistant.
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
Commands and background processes started for a session remain owned by that
session and stop with it, even while the assistant service itself is shared.

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
visible above both main and temporary chats, and conversation tabs never overlap.
Only a successful Update is presented as finished; it does not publish work.
When updated source needs workspace preparation, a direct Prepare workspace
action runs the project's declared setup steps. The notice does not claim the
Update is still running or require an AI repair for routine preparation.

Short actions show one compact progress line that a person can dismiss or open
for full history. The browser remembers a dismissal for that exact attempt
across reloads, while a new attempt appears normally. Long-running application
output stays out of the way until opened and remains available after the run
ends. An interactive AI terminal is launched
explicitly, always matches the kind of assistant chosen when the session began,
and can be closed independently of the conversation. A project that declares
no application output remains idle: Preview says there is nothing to run and
keeps its browser controls available without offering an empty launch menu.

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
When the host offers memory approval for a marginal browser test, the normal
Preview remains usable during a five-minute decision window. Chat says it is
waiting for approval, not working. The owner can resume the same test or cancel
it; expiry also ends the request without running tests. Reloading the page does
not discard the wait, but losing the owning assistant does. Approval still
checks current safety and never creates a duplicate test.

Deslop is a deliberate cleanup that preserves behavior, not an automatic extra
agent turn. After Save, Vibe64 may offer Deslop for the exact commit it just
published. Accepting uses the ordinary visible project conversation; declining
has no lasting effect. People can also request Deslop for the agent's changes
to the current task, including unsaved work, or explicitly select commits.

People can choose how cautiously the AI engineers a project. The choice follows
the project's source, always keeps ordinary work simple and targeted, and makes
the AI ask before a real requirement forces materially greater complexity.
