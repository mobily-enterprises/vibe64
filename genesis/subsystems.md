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
assignment watch scheduler. It also exposes the Learning watch controls and hosts
their persisted records, but delegates Learning observation, lifecycle, cursor,
deduplication and bounded delivery to Training's separate watcher. Shared Core
predicates normalize watch observations and cursors without knowing either host.
Training remains the fresh task/pin/progress and trusted-observation authority and
delivers accepted evidence to the existing Learning Main teacher, which still owns
guidance and assessment and never polls learner behavior. Browser and presentation
IDs are transient and must be rebound through a fresh access check after restart;
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
learner reservations outside projects, reusing Core atomic writes and Kernel locks.
Owns installed immutable course definitions/locks and revisioned enablement, and
declared visual asset reads from exact installed lesson pins. These are internal
server facilities without source access for Colleague. The presentational lesson
picker displays parent-supplied installed choices and saved progress, and emits
explicit start/resume intent through the original Training operations. It owns
neither API reads, permission/pin/progress rules nor writes. One shared client
Learning UI adapter supplies actor-scoped original Training reads and captured
Start/Resume/Open coordination; server owners retain admission and progress.
The same original Panel retains Learning Main and Preview views; the host supplies
actual viewer, layout and selected saved-session context. Live learner acceptance
remains a separate gate.
Owns the original canonical delivered-question and completed-practical proof
readers plus delivery promotion, staging, accepted-answer correlation and
delivered-question capture, originally reused by Colleague and now composed by
the admitted Main teacher. The shared teacher role set excludes
these teaching effects from Colleague's common discovery/contract/execute policy;
the original action boundaries also authenticate and require Main authority.
Colleague retains lifecycle, progress and authoring coordination. Its private
compatibility producer remains source-preserved until the corresponding Main
producer and original assertions are proved; it grants no supervisor tool access.
Owns the original native practical transaction, strict gesture/reference schemas
and bounded partial/completed facts moved once from Colleague, which immediately
reuses them with its unchanged connection and admission lifetime. Main uses the
same collector with its saved practice authority, current delivered question and
accepted browser identity; assessment retains the original Helper and sole
learner writer. Training also owns the original browser person-event collector and workspace
settler, moved once with immediate Colleague/Online consumer reuse. The selected
Main supplies its exact delivered question and captured saved practice target;
hosts supply real drawer/view and actual local or authenticated actor facts. Native question-to-
gesture-to-answer, acoustic and whole-lesson acceptance remain open.
For every selected Learning Main, including source-less lessons, Training also
owns the exact polling-task descriptor and validation of its attempt, immutable
pin, delivered question or bounded criterion, project/session and current progress.
Its separate watcher owns the active/paused/unavailable lifecycle, timer, stable
cursor, idempotent event identities and one pending guidance receipt. It emits only
allowlisted settled control/view facts through the existing gesture owner, then
revalidates and notifies the exact Main teacher. Colleague starts and controls the
watch through its existing UI and stores the record, but neither its model nor Main
polls learner behavior. Source-less attempts keep their actual saved session
identity. Training defers delivery while Main is busy and sends application-origin
context only; Colleague's model is not awakened.
Duplicate evidence, inactivity, Pause, Stop, target departure and restart cannot
create repeated guidance. Existing assessment/Helper/progress owners alone decide
and persist a pass.
Owns the original ephemeral browser presentation transaction and cue/receipt
predicates, immediately consumed by Colleague using its unchanged connection
objects. One original pending slot, deadlines, output binding and terminal ACK
rules are shared; consumers retain maps, fresh authority, native turn admission,
general navigation grammar and Stop/focus/replacement call sites. The shared
client dispatch returns the original player promise and projects its bounded
receipt only after the host's existing fresh actor/view/handle fence. No new
Main client identity, persisted format or player is introduced. The same
transaction now validates exact Learning mode/view/content/attempt receipts.
Colleague extends its existing navigation action, while Training owns one
Main-only bound view action for Workspace Preview, Workspace ERD and retained
Learning content. Both consume the host's single browser navigator; these
display receipts are demonstrations and cannot satisfy learner evidence.
Owns bounded durable assessment receipts and lesson resume state, checked against
the installed pin, plus a read-only teaching brief without executable assets or
source paths. Owns internal pinned-rubric grading through the existing retained
tool-free Helper; admission, serialized lifetime and progress writes stay with
their original owners. The answer-assessment action requires Main's accepted
native message and the original retained Helper; it cannot accept model-supplied
answers or outcomes. Internal
declared exercise checks reuse the original project/App/managed-command owners and
confirm server observations, not learner passes. Provides shared fresh-actor
course/read/start/resume and current interactive question-preparation actions; a host
composes the shared preparation coordinator with the original project/repository,
session and Workspace setup facilities. Without an exercise provisioner,
exercise start/resume reports unavailable before practice effects.
This subsystem owns start/resume/end/retained-pin continuation policy while hosts
supply concrete resources and provisioning. Reserved
no-exercise quizzes reuse these pins and answer owners without project effects;
practical and visual operations retain their preparation gates. Its read-only
learning-scope owners derive the actual learner, saved attempt and exact installed
pin without repair. No-exercise attempts use a private server namespace; explicit
configured practice admission reuses the saved actual Project and initial session,
including its original source, Git and Workspace setup owners. The same internal
learning-session coordinator derives fresh authenticated authority and pinned
teaching instructions. Preparation reuses its already-held original barrier;
subsequent effects reenter the original saved-attempt admission. Captured
observation/control cannot admit new work or change project selection. Runtime
construction, immutable session binding and native providers remain with their
existing owners; no historical session is silently adopted or replaced. The
explicit numbered practice-history operation separately adopts only an exact
preparation-owned initial session under its saved learner/pin and immutable
project marker. Training owns authority/retry validation, Runtime owns offline
metadata/archive staging, Core owns verified file publication and the ledger;
Online retains stopped-service activation. Progress/source/native histories and
unreferenced Working sessions remain unchanged. Main
teaching coordinator supplies its original nine learning, question, assessment
and declared visual actions plus the two practical read/evaluate operations to the original Codex/OpenCode Main native host for no-exercise
and authorized prepared practice attempts. Source-bearing validation precedes
the fresh authority grant, retaining the actual source/Genesis/Env/Git owners.
The captured Main browser uses the existing subscriber to refresh one
presentation resource and the original navigation/cue/player and speech owners.
Three browser-only presentation read/focus/acknowledgement actions remain outside
the model tool catalogue. Codex narrated cues require the original final-result
owner and exact canonical output. OpenCode narrated cues use the same original published final-result owner;
progress alone cannot authorize them and actual native/browser cue acceptance
remains open. Fresh originating-request WRITE authority and
accepted thread/turn/message guards fence every effect and final progress save;
the original retained Helper, transcript transaction and native checkpoint remain
the execution, receipt and delivery owners. Practice presentation retains its
actual captured initial session and display-only source slug. Terminals supplies
the closed false-scope App/output route and stream adapter through its existing
actions, process and proxy owners; Project supplies only its original onboarding
read. The same client App uses captured Learning transport identity while source
and manual-terminal controls remain absent. Main practical observations reuse the same server producer, declared checks,
Helper and progress writer. Actual provider, installed/browser/device and whole-
lesson acceptance remain open.
The Training Feature supplies
canonical Training HTTP/action composition in Public and consumes an optional
host's exact existing services without duplicating hosted authority or writers.
Standalone learning-only admission uses the actual OS owner through the original
trusted local transport; Working/Colleague identity stays unchanged. Original
preparation reports missing exercise provisioning before project effects. Teaching
delivery, public standalone provisioning and installation controls remain incomplete. JSKIT and
Genesis do not own teaching semantics. Topic source
and generated bundles are author-controlled files, rather than database tables.

Explicit local operator CLI commands install exact committed topics, read the
fresh installed catalogue and enable/disable exact course releases using its
current revision. They reuse the original installer/catalogue owners and unchanged
formats, with no browser/model paths or automatic seeding. Publication,
installation and learner admission remain separate operations.

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
Its thirteen ordinary HTTP operations share their named action contracts and
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
- Nothing.

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

## `packages-vibe64-project` Projects

Owns project discovery, the portable collaboration, engineering and deployment
settings, and the project-wide GitHub issue and pull request workflows.
Owns the portable connected-project list and its Settings editor, explicit
one-time Stack import, repository-access checks and source-write coordination.
Checks fresh receiving-repository write access and publication policy for Incoming
integration. Terminals retains the Git operation and source admission owners.
Resolves portable connection repositories to registered project identities and
supplies the receiving contribution's exact integration source after checking
repository write access. This lookup grants no cross-project access itself.
Its ordinary HTTP operations dispatch canonical project actions with fresh actor
and project authority. Existing services retain source/repository review checks,
GitHub credentials and locks; secret reveal and owner settings enforce the same
permissions for direct callers.
Colleague shares these actions for collaboration preferences, engineering
profiles, prompt suggestions, pull-request policy and development database scope
through bounded settings results.

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

### Data owned
- Nothing.

### Data used
- Nothing.

## `packages-vibe64-sessions` Sessions

Coordinates the selected project’s working conversations through the original session services and actions. It exposes creation, selection, renewal, archive discovery and the shared browser transport, preserving conversation identity and current actor/project authority.

Sessions exposes explicit source pinning and its lifecycle guards. Browsing another session does not change a pinned server selection.

Runtime owns the stored session descriptors and source workspaces. Terminals owns native conversation admission, provider preparation and execution. Training may supply an admitted immutable learning scope; that does not give the session UI authority to change lesson content, access or grading.
Sessions coordinates explicit connected-source preparation through receiving
project actions and the existing session creation owner. It retains reserved
source bindings in the originating session before creating receiving source,
so retries reuse the same identity. Terminals owns origin write admission.

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


Owns running project applications, their preview identities and declared
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

Coordinates workspace preparation and Save work using the existing project, session, execution and source owners. Explicit working-session preparation delegates initial connected-project import to Projects under the existing source admission. It retains actor/project admission, provider selection, native conversation bindings, checkpoints, output lifecycle and recovery. JSKIT owns shared native-engine and conversation-runtime behavior; Runtime owns the session store and Git workspace records. Voice transport is a separate subsystem.
Owns Git-derived Incoming inspection and ancestry-preserving Merge/Discard under
the existing managed Git boundary. Sessions exposes the authorized actions;
Projects retains receiving access and publication-policy decisions.
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
Owns the selected source alias and optional pinned source alias; pinning keeps that
selection fixed and protects the session and project until explicitly unpinned.
The same Runtime/Store accepts constructor-authorized learning scopes and
atomically retains their immutable owner/attempt/pin/conversation binding.
No-exercise scopes retain private native identity; explicit practice scopes reuse
the original actual-source creator, descriptor, Genesis environment and Git owner.
It preserves the existing supported storage format, archive history and native
state readers; it does not authorize Training content or create a parallel
runtime. Historical learning reads cannot acquire an executable root. Main
Learning mode creation/selection/renewal and browser adoption remain incomplete.
Sessions exposes the open/archive actions and bounded discovery; Runtime retains the stored descriptors, archival history, Git workspaces and native state readers. It does not own teaching content or UI presentation.

### Source
- Directory `packages/vibe64-runtime`

### Program
- Nothing.

### Data owned
- Nothing.

### Data used
- Nothing.

## `src-lib` Editor support

Provides browser-side support for editor presentation and exact source navigation: reference parsing, display policy, shared constants and focused utilities used by views and composables. These helpers operate within the editor and do not own server storage, provider lifetimes or project authority.

### Source
- Directory `src/lib`

### Program
- Nothing.

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

Persisted-state upgrades use the existing numbered registry, preflight, backups and retry rules. Product services supply the data and admission boundary; normal reads do not silently repair historical state.

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

Provides the sole Vibe64 boundary to Genesis’s project contracts, prompts and inspection results. It transports the canonical subsystem and Program facts and interprets Vibe64-owned operation sections such as workspace preparation, outputs and deployment.

Genesis owns the portable explanation grammar, explicit directory ownership, Program membership and required main source. This package does not generate a competing subsystem list. Execution and application services implement the operation recipes; Genesis descriptions are explanatory evidence rather than runtime instructions.
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
