# Subsystems

## `bin` Launcher

Starts Vibe64 from the command line.

### Source
- Directory `bin`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `application-root` Application root

Hosts the main server and application configuration.

### Source
- Directory `.`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `server` HTTP host

Registers server routes and request handling.

### Source
- Directory `server`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `config` Configuration

Declares application bindings and configuration.

### Source
- Directory `config`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-main` Composition

Connects the application to its framework.

### Source
- Directory `packages/main`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `src` UI composition

Composes the editor application, router and selected project/session views. It connects package-provided features and host facilities to the shared application shell, preserving the existing source and conversation identities.

More specific declared roots such as Components, UI behaviour, Pages and Editor support own their files. This owner covers the remaining UI composition files; it does not absorb those nested directories or create a second subsystem map.

### Source
- Directory `src`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `src-pages` Pages

Defines the editor’s registered application routes and page entry points, including project selection, dashboard tools and session/history views. Pages connect URL parameters and navigation to the corresponding views and existing controllers.

They are route composition rather than independent copies of the file, database or conversation services. Architecture’s UI projection uses evidenced registrations and controller connections, independently of this directory’s source ownership.

### Source
- Directory `src/pages`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `src-components` Components

Owns the reusable editor views and controls that present project selection, session workspaces, conversations, files, plans and settings. These components render the current state supplied by their existing composables and product services, and emit explicit user intent through those owners.

The same source viewer and editor serves Files and Architecture: opening a source from a subsystem or Program does not create another editing, saving or explanation implementation. Conversation, account, execution and project permissions remain with their services; a component’s placement here does not make those business operations part of this directory’s API.

This is a broad presentation boundary. The directory contains several UI features rather than one executable entry point. Other subsystems may consume its components individually; currently observed imports and available exports must be reviewed separately from an explicitly intended public interface.

### Source
- Directory `src/components`

### Program
- `genesis/program/editor/project-workspace.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `src-composables` UI behaviour

Coordinates reactive editor state and user workflows for project/session selection, conversations, file editing, previews, routing and settings. Composables connect the reusable views to existing product operations and shared HTTP, realtime and conversation facilities.

File edits, navigation and source explanations share their existing lifecycle and save/conflict coordination. Session and conversation composables preserve selected identity, asynchronous request guards, retained drafts and current authority instead of owning parallel server state. Each returned state object or operation is a file-level interface; cross-directory imports identify actual consumers without declaring every export part of an intended directory API.

### Source
- Directory `src/composables`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `src-views` View shells

Provides application view shells, including the route fallback shown when no registered page matches. The shell delegates product workflows to their views and services instead of defining another navigation or conversation owner.

### Source
- Directory `src/views`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-colleague` Colleague

Host-owned workspace conversations can register an authorized observation source
with the existing watch scheduler. Colleague owns the subscription and delivery;
the host retains its conversation, permissions, diagnosis and repair operations.

Owns each person's independent conversation for discussing ideas and operating
Vibe64 across projects, including focused targets, conversation watches,
bounded implementation assignments
and bounded Helper summaries. JSKIT owns its model/tool loop, native bindings,
replacement and canonical transcript transactions. The product stores those
transactions with its policy state in one private record; its numbered upgrade
retires the former native binding without replay. Spoken requests use ordinary message admission;
JSKIT owns local turn detection and speech controls through the shared root host.
The supplied JSKIT browser binding owns retained drafts, delivery, transcript
streaming and shared-socket subscriptions; Colleague retains its product toolbar,
model selection, focus and navigation receipts.
Conversation owns the shared hosting provider; Colleague contributes only its
optional product facade and schemas, without changing its IDs or routes.
The model picker uses the same shared HTTP facade and the original authorized
product selection action; catalogue and access policy remain application-owned.
Transient actor-private reply and user-transcript projections reconcile to the
canonical chat. Assignment records retain user intent, exact participants,
turn allowances, authorized communication links, dependency waits and evidence;
existing conversation owners still execute work. It also
owns acknowledged project/session and global Management navigation commands.
Plan-viewer requests reuse that navigation contract. Conversation owns the native
viewer and its read-only opener; the host reveals Main chat and acknowledges its
actual open tab. Colleague receives no second plan state or lifecycle authority.
It owns bounded discovery and lookup of the release's task-oriented usage guides,
used to explain UI steps and offer authorized assistance. Hosts compose their
additional guides into the same released documentation; other subsystems retain
their operation authority and human-completion requirements.
The Integrations panel owns its actual slot selection and publishes bounded view
state for Colleague's acknowledged navigation and captured request focus.
The existing project layout owner supplies actual pane visibility and reveal
operations; the integration owner refreshes status through its current command.
Code subscribes to session events and reconciles watched conversations through
their existing authorized actions. Colleague owns that ordinary conversation and
assignment watch scheduler; the numbered practice-sessions upgrade removes saved
Learning watches. Colleague teaches lessons from their steps through Training's lesson and step
operations and its own acknowledged navigation and guides. Shared Core predicates
normalize watch observations and cursors. Browser and navigation IDs are transient and must be rebound through a fresh access check after restart;
queued or running notifications are suppressed when the watch is paused, stopped
or leaves its exact target.
It consumes existing native conversation, the JSKIT instruction lifecycle runtime,
transcript policy and action catalogues. Coding work and ordinary product operations retain their
existing subsystem owners. State is private application filesystem data.

### Source
- Directory `packages/vibe64-colleague`

### Program
- `genesis/program/colleague/product-conversation.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-training` Learning

Owns versioned local topic/lesson/visual validation and reproducible authoring
bundles, verified server-only installation from admitted owner-selected local
sources, and read-only validation of pinned topic snapshots. Consumes the existing
CLI entry point without changing editor launch. Owns private server-only pinned
learner reservations outside projects, reusing Core atomic writes and Kernel locks,
and each learner's private teacher notes (Colleague's short summary of that person,
read and rewritten for them only; never step results or completion).
Owns installed immutable course definitions/locks and revisioned enablement, and
declared visual asset reads from exact installed lesson pins. These are internal
server facilities without source access for Colleague. The presentational lesson
picker (the Learning **Courses** pane) displays parent-supplied installed courses,
read-only per-lesson progress and the owner's custom-course form, and emits
explicit start/resume/create intent through the original Training operations. It owns
neither API reads, permission/pin/progress rules nor writes. One shared client
Learning UI adapter supplies actor-scoped original Training reads and captured
Start/Resume coordination for the Learning environment (L); server owners retain
admission and progress. Live learner acceptance remains a separate gate.
Owns the shared fresh-actor lesson operations (course list/create/install,
learning read, start, resume, end and retained-pin continuation) and the step
operations (lesson read, step observe/check/answer/done, reader position and
practice deletion). A step result is recorded only for the learner's own action;
a check Colleague runs reports its finding and saves nothing. Colleague teaches
every lesson from its steps. Owns bounded durable assessment receipts and lesson
resume state from version 1 lessons, checked against the installed pin and kept
readable. Internal declared exercise checks reuse the
original project/App/managed-command owners and confirm server observations, not
learner passes. A host composes the shared preparation coordinator with the
original project/repository, session and Workspace setup facilities. Without an
exercise provisioner, exercise start/resume reports unavailable before practice
effects. This subsystem owns start/resume/end/retained-pin continuation policy
while hosts supply concrete resources and provisioning; ending a lesson stops no
agent work, because a practice project and its sessions are ordinary. The
explicit numbered practice-history operation separately adopts only an exact
preparation-owned initial session under its saved learner/pin and immutable
project marker. Training owns authority/retry validation, Runtime owns offline
metadata/archive staging, Core owns verified file publication and the ledger;
A host retains stopped-service activation. Progress/source/native histories and
unreferenced Working sessions remain unchanged. The read-only lesson visual
resource serves the pinned diagram bytes of any of the learner's retained attempts.
The Training Feature supplies
canonical Training HTTP/action composition in Public and consumes an optional
host's exact existing services without duplicating hosted authority or writers.
Standalone learning-only admission uses the actual OS owner through the original
trusted local transport; Working/Colleague identity stays unchanged. Original
preparation reports missing exercise provisioning before project effects. JSKIT and
Genesis do not own teaching semantics. Topic source
and generated bundles are author-controlled files, rather than database tables.

Explicit local operator CLI commands install exact committed topics, read the
fresh installed catalogue and enable/disable exact course releases using its
current revision. They reuse the original installer/catalogue owners and unchanged
formats, with no browser/model paths or automatic seeding. Publication,
installation and learner admission remain separate operations.

Owns code checks: their `code` evidence/check schema, the per-step starting-file
baseline and the private server-side save ledger beside learner state, the
ordinary Files editor's save owner for practice projects, and the code check that
runs a pinned check on a private overlay copy through the existing execution
owner. The generic source-editor save and its baseHash check remain their
original owners.

Release-matched lesson-authoring guidance connects existing Colleague assignments
and same-session review to requested native Save/PR publication, while retaining
the coding/CLI and operator boundaries. Teaching usage is split into bounded
authoring, learner and pinned-recovery topics through the original usage reader.

### Source
- Directory `packages/vibe64-training`

### Program
- `genesis/program/training/content.md`
- `genesis/program/training/learning-ui.md`
- `genesis/program/training/teaching.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-source-editor` Source & interfaces

Owns the project-shared Backups area in Files, reusing ordinary file operations;
the runtime supplies its project path and retention operation, and the host
schedules cleanup. It is separate from private workspace upgrade recovery data.

Owns editing and reviewing project source changes, including derived
filename and content indexes for each working session.
Its ordinary source-editor operations share named action contracts and current
actor/project authorization across HTTP and automation. Colleague receives bounded
integration slot metadata, provider discovery, requested Development configuration
changes and bounded application setup results through those actions. The same
save owner validates provider configuration under the source/revision lock and
preserves unrequested records and extensions. The existing setup owner retains connection,
payment and advertising authorization and revision checks. Source tools remain
with coding conversations; Colleague delegates source investigation.

A practice lesson's Files tab mounts the same editor through lesson-scoped routes
(tree, file, find, search, path resolve, download and stars read with observe
access; file create and star set with write access) for the saved attempt; its
save is Training's ledgered action. File areas, uploads, integrations, the
Interface view and explanations stay unavailable there.

Provides the shared file viewer and editor used by Files and Architecture, including saved-source reads, edits, conflict checks, downloads and source references. File overviews and per-function pseudocode are generated only on request through the configured Helper. Informational answers are cached against source and guidance identity; they remain separate from authored subsystem and Program explanations. Terminal orchestration owns publishing session source through Save work.

### Source
- Directory `packages/vibe64-source-editor`

### Program
- `genesis/program/source/edit-and-review.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-system-graph` Architecture

Owns presenting Genesis explanations, authored subsystems and indexed source relationships.
System Graph reads and refresh share named actions and actor/project authority
across HTTP and direct callers; coding conversations own engineering investigation.
Its existing scan owner exposes process-local progress and last outcome, with
session notifications and remount/reconnect reconciliation for all viewers.

The Architecture canvas combines registered UI pages with directory-bound subsystems. It reads the same authored responsibilities and Program membership as Genesis. A Program opens as a capability explanation inside the canvas, with its explicitly designated main source and supporting files. Source links use the same file viewer and editor as Files, preserving navigation back to the Program or subsystem. It does not generate a competing owner list or treat every file export as an intended subsystem API.

### Source
- Directory `packages/vibe64-system-graph`

### Program
- `genesis/program/understanding/genesis-context.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-database-tools` Database workspace

Owns inspection, diagram exploration, agent-assisted layout changes and query execution for a selected project database.
Its transient copilot consumes the supplied JSKIT bounded-task browser binding,
shared conversation UI and central Helper resolution. JSKIT owns its original
browser-local draft/request history and final-command lifecycle; this subsystem
supplies endpoint/input/result mappings and SQL placement through the existing
HTTP command, without a second transcript or fabricated native receipts.
JSKIT also owns the original bounded response coordinator and the generalized
structured reply/tool schema, parser, action selection and next-result prompt.
This subsystem supplies database instructions, the final answer schema and
schema/read-query actions, retaining permissions, result presentation and durable
helper-cleanup references. Copilot uses the same common runtime's scoped Helper
coordinator and shared application-tool executor. Calls are explicitly transient
and never resume after restart; native cleanup remains in the existing parent
artifact. The action callbacks retain the original reader, data bounds and host
errors, without exposing database operations to native tools or general automation.
Its fourteen ordinary HTTP operations share their named action contracts and
trusted actor/project context; the database services own query and mutation safety.
Colleague uses bounded presentations of the existing status, schema refresh and
exact-query cancellation actions. The Database workspace owns URL-backed view
selection, exact table opening through its native controls, and publishes its
visible semantic state and selected Data table identity to the Colleague host.
Runtime activity comes from the executor's
existing project/session query reservations, without a separate persisted tracker.

### Source
- Directory `packages/vibe64-database-tools`

### Program
- `genesis/program/database/diagram-exploration.md`
- `genesis/program/database/query-execution.md`

### Data owned
- Session artifacts `database/schema.json`, `database/erd-layout.json` and
  `database/workspace-<actorKey>.json` (owned by `server/sessionState.js`).
- Session artifacts `database/assistant-tasks/<actorKey>.json`: copilot helper
  cleanup references (owned by `server/service.js`).
- Project source `data-overview.json`, written through the source editor
  (path and format owned by `shared/dataOverview.js`).

### Data used
- Nothing.

## `packages-vibe64-voice` Voice

Connects authorized speech to the selected conversation through the existing shared voice facilities. The server provider checks current actor/project access and exposes the product’s voice endpoints; the client entry supplies the corresponding UI integration.

Conversation identity, message admission and native inference stay with the conversation owners. JSKIT owns shared voice transport and turn detection; a host supplies its audio and credential facilities.

### Source
- Directory `packages/vibe64-voice`

### Program
- `genesis/program/conversation/voice-chat.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-publishing` Publishing

Provides the local publishing experience: the project's Publish page, release
orchestration (prepare a version change for Save, plan, preflight, dry run,
the person's own confirmation, tag the saved commit, build once, fan out, read
back), publishing targets and release history kept as local project state, and
the person's publishing keys, recovery kit and toolchain licence acceptance in
their own Vibe64 folder. Assistants may read, prepare, plan, dry-run and ask;
only the person's page request confirms. It composes the host-neutral building
blocks in `packages/vibe64-packaging` (including the passphrase key store and
recovery kit) and
the Packaging contract owned by the Genesis boundary.

### Source
- Directory `packages/vibe64-publishing`

### Program
- Nothing.

### Data owned
- Project runtime `publishing/`: targets, release history,
  confirmations, verification results and build results.
- Personal `publishing/` folder: the age-encrypted keys file and its index,
  and licence acceptances.

### Data used
- The project's saved Git commit and Packaging section; session source through
  the source editor for prepared version changes.

## `packages-vibe64-packaging` Packaging building blocks

Provides host-neutral application distribution primitives: deterministic
publish plans and their hash, the credential-free build stage that snapshots
checksummed artifacts, sign and upload with credentials supplied by the caller
and always removed afterwards, read-back proof, release tags on the saved
commit under the project source lock, one-shot person-only confirmation
tokens, preflight checks, the packer and destination registries, the
passphrase-locked publishing key store (an age file in a private folder its
caller chooses, unlocked only in memory, and its recovery kit: every key in one
file under a second passphrase), and the standalone `vibe64-publish`
command. It holds no state, history, custody policy or UI of its own; its
callers own those and choose where the keys live.

### Source
- Directory `packages/vibe64-packaging`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-project` Projects

Owns project discovery, the portable collaboration, engineering and deployment
settings, and the project-wide GitHub issue and pull request workflows.
Owns the portable connected-project list and its Settings editor,
repository-access checks and source-write coordination. Stack supplies generic
source treatment and never initializes the connection list.
Checks fresh receiving-repository write access and publication policy for Incoming
integration. Terminals retains the Git operation and source admission owners.
Resolves portable connection repositories to registered project identities and
supplies the receiving contribution's exact integration source after checking
repository write access. This lookup grants no cross-project access itself.
Projects projects authorized task source bindings into the Stack-declared,
locally ignored source-map file using its existing file projection and source
lock owners. The map does not grant access or certify command execution.
Its read-only input inspection compares the same projection without repairing it.
Its workspace inspection combines ordinary and connected recipe identities
with the exact task source selection.
Its ordinary HTTP operations dispatch canonical project actions with fresh actor
and project authority. Existing services retain source/repository review checks,
GitHub credentials and locks; secret reveal and owner settings enforce the same
permissions for direct callers.
Colleague shares these actions for collaboration preferences, engineering
profiles, prompt suggestions, pull-request policy and development database scope
through bounded settings results.

Owns the shared project archive lifecycle (`@local/vibe64-project/server/project-archive`):
archiving a project into a bundle without rebuildable dependencies, and the
light delete, for normal projects and, inside a practice scope, for practice
projects in the learning space. Hosts add their own managed resources (for
example databases, resource profiles); Learning and ownership checks stay with Training.

Owns project values supplied to managed application work.
Colleague uses the canonical Project Env read/save actions through a bounded
metadata presentation and explicit user-value patches. Shared service guards
protect host-owned values; stored-value inspection and secret reveal stay in Env.

### Source
- Directory `packages/vibe64-project`

### Program
- `genesis/program/environment/project-values.md`
- `genesis/program/preview/application-identities.md`
- `genesis/program/projects/catalog.md`
- `genesis/program/projects/collaboration-approach.md`
- `genesis/program/projects/connected-projects.md`
- `genesis/program/projects/engineering-approach.md`
- `genesis/program/projects/github-issues.md`
- `genesis/program/projects/github-pull-requests.md`
- `genesis/program/projects/project-archives.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-sessions` Sessions

Coordinates the selected project’s working conversations through the original session services and actions. It exposes creation, selection, renewal, archive discovery and the shared browser transport, preserving conversation identity and current actor/project authority.

Sessions exposes explicit source pinning and its lifecycle guards. Browsing another session does not change a pinned server selection.

Runtime owns the stored session descriptors and source workspaces. Sessions owns the session metadata records it writes through Runtime's session store (`main_chat_approvals`, `connected_sources`, `connected_submissions`, `connected_session_name`, `session_archive_operation`, `repository_update_check`) and the session renewal state record. Terminals owns native conversation admission, provider preparation and execution. Training may supply an admitted immutable learning scope; that does not give the session UI authority to change lesson content, access or grading.
Sessions coordinates explicit and workspace-driven connected-source preparation through receiving
project actions and the existing session creation owner. It retains reserved
source bindings in the originating session before creating receiving source,
so retries reuse the same identity. Terminals owns origin write admission.
After all receiving sources are ready, Sessions asks Projects to materialize
their exact source-map inputs; failed projection retains the receiving work.
Internal input inspection reauthorizes receiving project access and exact source
bindings before Project compares the generated map, without allocating sources.
The existing workspace runner invokes this inspection before commands and cached
readiness. Allocated contribution sessions do not automatically prepare their
own connections; the originating Stack treats its finite direct source list.
Sessions also coordinates connected-first Save through native receiving Save
actions. Each confirmed commit becomes an exact integration requirement in the
origin session before continuing; Git and the receiving Save owner determine
publication and recovery, without a separate completion ledger. Main Save
rechecks connected work through those same authorized receiving actions.
Sessions also reviews and reserves explicit discarded-contribution replacements
through the same source owner. It preserves old sources and submitted requirements;
Core validates the predecessor identity and Terminals freezes source at its reviewed
discarded commit. There is no second queue or replacement transaction store.

### Source
- Directory `packages/vibe64-sessions`

### Program
- `genesis/program/sessions/workspaces.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-accounts` Accounts

Owns AI account setup, provider-key storage and validation, connection selection,
per-orchestrator model routing and recommendations,
and connection health. Workspace Studio health also resolves current actor access
independently of any selected project. Standalone and hosted editors
share these operations; hosts supply credential context and access policy.
JSKIT interprets Claude's native account status and owns its metadata-invalidated
cache; this subsystem supplies managed execution and the actor's credential home.
Workspace account actions resolve the actor independently of project selection.
Shared provider-connection actions enforce owner and host management policy;
HTTP and machine callers retain the same credential/revision service checks.
The same routing owner supplies bounded Colleague read/preview/save presentations
and paged role choices; there is no second routing store or permission policy.
The existing connection list supplies an owner-only, bounded Colleague projection
of regular Z.AI saved setup facts. Account writes and paid consent remain excluded.

### Source
- Directory `packages/vibe64-accounts`

### Program
- `genesis/program/accounts/connections-and-health.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-terminals` Terminals & outputs

Owns the Main cross-provider history allowance and the shared reader/writer of
native Codex context-usage metadata. Sessions' renewal advice consumes that same
reader; persisted session metadata remains in Session runtime. Native usage comes
from JSKIT's existing provider owners. The transfer changes neither saved history
nor process sharing and allocates no new persistence.

Owns direct conversations and temporary assistance with connected coding agents,
including retained text/voice admission and bindings to the shared JSKIT voice host.
Preserves the three native interactive terminals alongside chat: their authorized
launch/access and presentation remain application-owned, while JSKIT owns native
arguments, attach/resume and shared engine identity. Terminal presentation reads
managed execution's existing PTY owner; it creates no second lifecycle registry. The
Codex terminal-access facility also owns managed PTY request and startup-shell
preparation. Its private interactive-terminal workflow owns the original authorized
session/global launch, input and access sequence, using those same helpers and the
same native owner at the original preparation phases. Its startup-health module projects the existing background-task
receipts, retaining attempt guards and publication order without owning a native
process. Claude's named environment facility supplies the original managed command,
project environment, selected configuration and Genesis registry facts without
native lifecycle state. Its explicit native-state acquisition belongs to the shared
driver; application projection appends PTY status and historical metadata, leaving
passive initialization free of native identity allocation. All three renewal
proof-release paths use the configured common runtime and original native owners;
authorization and successful binding retirement remain application-owned.
Its existing Main binding module now constructs the application conversation
contract once, using the manager's registered provider and that provider's native
host/history facts. The same binding module owns original context validation,
runtime/session snapshots and workspace/selection gates, retaining each engine's
established snapshot and scoped-context policy. Before a native ID exists, the
manager's admitted Create enters the common runtime through its configured host;
the selected native owner returns the identity before the parent records it and
starts a turn. Selection policy uses the saved-binding retirement owner.
Explicit Codex, OpenCode and Claude readiness enters the common runtime API, whose
drivers and original native owners decide inspection, recovery and acquisition.
Application preparation retains current-record/context policy, source-write leases,
account/configuration, health/result projection and guarded store effects. Codex
uses the same managed-provider registry for passive verification and keeps
write-admitted preparation separate. Session/scope close now enters
the same runtime for retained, unready and uncached owners; its configured host
prepares application policy while the native owner performs cleanup. Codex and
OpenCode project cleanup likewise uses the common runtime without opening a
conversation, preserving the project action authority and shared peer retention.
All three engines' account cleanup now follows the same configured-owner route.
Claude's retained native owner groups contexts and drains account queries;
Codex keeps its shared shutdown/drain operation; OpenCode keeps its pending-start,
target-release and failed-start cleanup sequence. Their native owners retain the
original closing fences. Application storage and terminal facilities retain
their original read/effect positions. Startup reconciliation now uses the same
configured runtime route for all three engines. The manager retains inventory,
engine grouping and permissions; each native owner retains its original loop
and failure behavior. The common application binding owns original actor, Genesis opening/explicit
rendering and authored-message admission policy, with each native owner retaining
its Send/steering phase order. Actor receipts, checkpoint projection, renewal
completion and context-renewal advice use their existing focused application owners.
Terminal closure retains its distinct
host contract. These staged moves do not finish the entire lifecycle.


Owns shared or session-scoped warm supporting services through the existing managed
execution owner, including exact-session and project cleanup. Also owns running
project applications, their preview identities and declared
project services shared across sessions. Project Close drains those services
through the existing execution owner after stopping individual outputs.
Output lifecycle, status, logs and result access share canonical terminal
actions with current actor/project authority and existing service admission.
Colleague uses bounded output status and terminal lifecycle presentations of
those actions and the canonical Project actions for its named application
identity list. Browser identity exchange and downloads remain UI operations.
Current-app output discovery uses the same fresh project authority before
inspecting the selected project or session declaration.

Owns assistant messages to exact or selected sessions in open projects through Main admission, with source attribution, self-delivery rejection and existing access checks.

Coordinates workspace preparation and Save work using the existing project, session, execution and source owners. Working-session preparation consumes the project-owned connection file under existing source admission; Stack supplies generic development treatment. It retains actor/project admission, provider selection, native conversation bindings, checkpoints, output lifecycle and recovery. JSKIT owns shared native-engine and conversation-runtime behavior; Runtime owns the session store and Git workspace records. Voice transport is a separate subsystem.
Owns Git-derived Incoming inspection and ancestry-preserving Merge/Discard under
the existing managed Git boundary. Sessions exposes the authorized actions;
Projects retains receiving access and publication-policy decisions.
Incoming conflict repair reuses the existing checkpoint, Temporary AI and
conflict-path tree owners. Its transient review binds both remote heads and
receiving source state; only a separately reviewed native Merge publishes.
The same Save owner verifies exact retained connected submissions against fresh
receiving Git ancestry before publication; Core validates their metadata shape,
and Runtime preserves the bindings across renewal.

### Source
- Directory `packages/vibe64-terminals`

### Program
- `genesis/program/conversation/direct-chat.md`
- `genesis/program/conversation/temporary-assistance.md`
- `genesis/program/execution/workspace-setup.md`
- `genesis/program/preview/managed-application.md`
- `genesis/program/source/save-work.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-current-app` Project outputs

Discovers the selected project’s declared output targets through the existing project and Genesis boundaries. It supplies output metadata used by the editor’s App presentation without starting those targets merely to inspect them.

Terminals and managed execution own launch, status, logs and shutdown. Current project authority and declared output identity determine which source and target may be inspected.

### Source
- Directory `packages/current-app`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-studio-health` Host health

Reports read-only platform health using the current account and workspace services. Checks expose runtime, managed-execution and account readiness to the UI through the same authorized actions.

Reading health does not create an account, repair a project, launch a native conversation or run application setup. Connection and execution owners retain those effects and their recovery controls.

### Source
- Directory `packages/studio-health`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-runtime` Session runtime

Owns isolated working sessions, their lifecycle and recoverable workspace history.
Its explicit offline-copy operation prepares saved session work through JSKIT;
the invoking host owns isolated file transfer and native goal pause.
Owns the selected source alias and optional pinned source alias; pinning keeps that
selection fixed and protects the session and project until explicitly unpinned.
The same Runtime/Store accepts constructor-authorized learning scopes and
atomically retains their immutable owner/attempt/pin/conversation binding.
No-exercise scopes retain private native identity; explicit practice scopes reuse
the original actual-source creator, descriptor, Genesis environment and Git owner.
It preserves the existing supported storage format, archive history and native
state readers; it does not authorize Training content or create a parallel
runtime. Historical learning reads cannot acquire an executable root; no browser
selects a Learning session.
Sessions exposes the open/archive actions and bounded discovery; Runtime retains the stored descriptors, archival history, Git workspaces and native state readers. It does not own teaching content or UI presentation.

### Source
- Directory `packages/vibe64-runtime`

### Program
- `genesis/program/runtime/development-copy.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `src-lib` Editor support

Provides browser-side support for editor presentation and exact source navigation: reference parsing, display policy, shared constants and focused utilities used by views and composables. It also holds the shared Learning environment (L) controller, which owns only what L displays (open or minimised, surface, selected lesson step and its read results) and calls the Training actions for every change. These helpers operate within the editor and do not own server storage, provider lifetimes or project authority.

### Source
- Directory `src/lib`

### Program
- `genesis/program/training/learning-environment.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `tooling` Development tools

Owns the shared compact runtime builder, npm artifact preparation, isolated
installation proof, and the complete development preview with its bundled
example project. It also owns development source selection and disposable dependency
composition shared with hosted consumers; production package pins stay separate. Core owns the numbered persisted-state upgrade runner and its completion ledger. Hosted consumers supply their private runtime requirements and coordinate stopped-service upgrades before activation.

### Source
- Directory `tooling`

### Program
- `genesis/program/operations/runtime-release.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `scripts` Maintenance scripts

Performs build, release and maintenance operations.

### Source
- Directory `scripts`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `docs` Documentation

Explains how to operate and extend Vibe64.

### Source
- Directory `docs`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `examples` Examples

Demonstrates supported projects and workflows.

### Source
- Directory `examples`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `src-assets` Assets

Provides images and other UI resources.

### Source
- Directory `src/assets`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `claude` Claude guidance

Stores project-specific agent guidance.

### Source
- Directory `.claude`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `github` GitHub workflows

Defines repository automation.

### Source
- Directory `.github`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `opencode` OpenCode guidance

Stores project-specific agent configuration.

### Source
- Directory `.opencode`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-core` Core primitives

Provides the shared paths, errors, request/context helpers, atomic file publication and state-upgrade facilities used by Vibe64’s product packages. It defines common mechanics without owning project, session, teaching or conversation policy.

The shared upload byte policy keeps Files, chat HTTP admission and browser validation aligned; each product service retains authorization, streaming storage and cleanup.

Persisted-state upgrades use the existing numbered registry, preflight, backups and retry rules. Product services supply the data and admission boundary; normal reads do not silently repair historical state.

Owns the learning space (`learningSpace.js` with the Project context): practice projects live only in their learner's namespace `<root>/<learnerKey>/<practiceId>/<slug>`, apart from the catalogue, on both hosts, with their runtime roots in the shared `<systemRoot>/projects` inventory. It owns the practice slug and ID, the immutable schema-2 training marker, the one practice scope, the learning-space listing and the one admission rule: a person opens only their own practice project, and work without a person is admitted as the marker's learner. A catalogue entry with a retired training marker is skipped with a one-time warning and never fails the normal projects' listing. The host supplies only the space root; Training owns lessons, attempts and the Practice list.

### Source
- Directory `packages/vibe64-core`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-execution` Command execution

Owns the bounded workspace cache-maintenance command purpose and its daemon-only scratch-path admission.
Owns managed command execution and its native stdio
transport, PTY admission/I/O/subscription/cleanup and workflow accounting. Conversation
engines consume this host facility; JSKIT owns their command/protocol setup.
The existing runtime registry owns language-toolchain paths, managed command
guards and dependency fingerprints. Hosts install the packs; project operations
declare their commands and required tools.

Terminal orchestration supplies workspace preparation policy; Genesis supplies declared operation recipes. This subsystem runs admitted finite or managed commands and owns their process, PTY and resource lifetime. It reports execution evidence without interpreting Program descriptions or admitting application work.

### Source
- Directory `packages/vibe64-execution`

### Program
- `genesis/program/execution/workflow-accounting.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-genesis` Genesis boundary

Provides the sole Vibe64 boundary to Genesis’s project contracts, prompts and inspection results. It transports the canonical subsystem and Program facts and interprets Vibe64-owned operation sections such as workspace preparation, outputs, deployment and packaging.

Genesis owns the portable explanation grammar, explicit directory ownership, Program membership and required main source. This package does not generate a competing subsystem list. Execution and application services implement the operation recipes; Genesis descriptions are explanatory evidence rather than runtime instructions.
Its agent specs (`./server/agentSpecs`) print each section's grammar from the
parsers' own entry tables for `vibe64 spec`.
The boundary validates Connected development declarations with the existing
Workspace setup command grammar. It returns an exact recipe identity; it does
not allocate source, run treatment commands or certify source consumption.

### Source
- Directory `packages/vibe64-genesis`

### Program
- `genesis/program/execution/resource-estimates.md`
- `genesis/program/projects/application-deployment.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-studio-terminal-core` Terminal primitives

Supplies common terminal paths, runtime identity and credential-home facilities for the terminal and native provider consumers. It supports shared account/runtime isolation without owning a separate conversation or process registry.

Execution retains process and PTY lifetime; Terminals supplies product admission and provider preparation. Consumers use these common facilities to address the same existing resources.

### Source
- Directory `packages/studio-terminal-core`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `vibe64-pre-restore-20260517-161105` Restore archive

Preserves the tracked historical source snapshot; it is not active application code.

### Source
- Directory `.vibe64.pre-restore.20260517-161105`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.
