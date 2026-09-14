# Blueprint

Vibe64 is the visual, managed shell around Genesis for people building software
with an AI coding agent.

People can open or create a project, work in isolated sessions, and have a
direct conversation with the agent while seeing the source, changes, running
application, environment, and the system's explained structure in one place.
Each session keeps valuable work recoverable and separate from unrelated work.
Opening a project shows loading while its sessions are being fetched, including
when restoring the last selected session. It does not imply creation is blocked.
Dashboard page titles share one Material typography style. Session history keeps
its refresh action beside the heading, including on small screens.
Archiving immediately makes a session inactive and selects the previous available
session. Its gray tab remains while Preview, AI work, and other tools stop and
its workspace is archived in the background. Success removes the tab; failure
restores its availability with a warning. All open tabs observe the transition.
After a server restart, admitted archives resume from durable progress. Failed
recovery preserves the evidence and requires an explicit retry.
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
Opening a binary or oversized file from chat or Files keeps its filename visible
and offers Download without placing it in the text editor.
The file browser keeps starred filenames on one line and starts larger lists
collapsed.
On phones and tablets, Files prioritizes the open file. Repository browsing and
search stay hidden until requested, and choosing a file returns to its contents.
A compact toolbar keeps the filename and Save visible, with other actions in a
menu. Drop Zone and Session previews also use a compact file toolbar.
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
Save and Update wait for active assistant preparation to finish. Save can proceed
without assistant naming, using a checkpoint-based version name and a visible
notice when naming is unavailable. A request that
overlaps preparation waits briefly at the server and explains a timeout. Failed
requests remain readable and dismissible even before an operation starts;
their recovery controls fit the chat pane, including on small screens.
People can explore the application through a compact searchable subsystem list
and a focused detail pane. City opens unobstructed and shows a closable inspector
only after selection. Each authored subsystem explains
a responsibility and brings together its Program operations and owned or shared
data tables. A searchable overview and an optional three-dimensional City share
the same details. Operations link to explanations and source; tables link to the
relationship diagram, with a way back to the selected subsystem. Missing or invalid maps
offer a temporary AI task to generate or repair the subsystem map with the session's
selected model and normal workspace tools. The main draft remains untouched;
map edits stay in the session for review and Save. The subsystem view refreshes
when the task finishes. The task checks the declared format before reporting success.
An unreadable map can
also be opened directly for correction. Unresolved table references remain visible. The database
overview continues to explain the data itself.

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
Incomplete project setup declarations defer this automatic refresh so people can
continue chatting with the assistant to repair them.
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
assistant access can skip a saved request; its Skipped state survives reload.
Skipping leaves the application account connected and does not automatically
resume the assistant. When the application's setup command confirms the requested
connection, the saved card shows Setup completed. That records the setup decision;
later reconnecting or disconnecting the account does not rewrite the old request.
Completion does not yet automatically resume the assistant.
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
After Codex login succeeds, temporary assistant cleanup can recover through
ordinary account status retries without restarting Vibe64 or asking the person
to sign in again. Confirmed recovery clears the earlier login error; unverified
runtime shutdown remains a visible failure.
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
When the host holds a browser test because resources are unavailable, the normal
Preview remains usable during a five-minute decision window. Chat says it is
waiting for resources. The owner can resume the same test or cancel
it; expiry also ends the request without running tests. Reloading the page does
not discard the wait, but losing the owning assistant does. Retry still
checks current safety and never creates a duplicate test.

Deslop is a deliberate cleanup that preserves behavior, not an automatic extra
agent turn. After Save, Vibe64 may offer Deslop for the exact commit it just
published. Accepting uses the ordinary visible project conversation; declining
has no lasting effect. People can also request Deslop for the agent's changes
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

When Codex uses a ChatGPT plan, authorized account users can see the remaining
weekly allowance as a single percentage beside the chat controls, with its
label, known reset times, and the five-hour allowance in the hover/tap details. Allowance is account-wide, distinct
from conversation context usage. API-key connections and other assistants do
not show a plan meter; unavailable readings never imply unused allowance.

The Codex chat indicator also shows the current conversation goal status.
People can open its objective and pause or resume an unfinished goal without
losing its objective or usage history. Pause also interrupts the current turn.
Goal controls are separate from plan allowance and are available to authorized
Codex users even when no weekly allowance is reported.
