# Genesis project context

Vibe64 presents and refreshes the portable project understanding maintained by
Genesis without creating another interpretation of the application.

## Sources

- `packages/studio-terminal-core/src/server/codexRuntimeContext.js`
- `packages/vibe64-terminals/src/server/agentCommandEnvironment.js`
- `packages/vibe64-terminals/src/server/agentSessionCommand.js`
- `packages/vibe64-terminals/src/server/mainConversationBinding.js`
- `packages/vibe64-terminals/src/server/codexConversationPreparation.js`
- `packages/vibe64-terminals/src/server/codexSessionEnvironment.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-genesis/src/server/promptContext.js`
- Main: `packages/vibe64-system-graph/src/server/service.js`
- `packages/vibe64-system-graph/src/server/genesisCities.js`
- `packages/vibe64-system-graph/src/server/actions.js`
- `packages/vibe64-system-graph/src/server/registerRoutes.js`
- `tests/server/vibe64SystemGraphRoutes.unit.test.js`
- `packages/vibe64-system-graph/src/client/components/Vibe64UiStoryboardView.vue`
- `packages/vibe64-system-graph/src/client/architectureModel.js`
- `packages/vibe64-system-graph/src/client/components/Vibe64SubsystemInspector.vue`
- `packages/vibe64-system-graph/src/client/components/Vibe64ProgramInspector.vue`
- `packages/vibe64-system-graph/src/client/components/Vibe64SubsystemTreeBranch.vue`
- `packages/vibe64-system-graph/src/client/layeredGraph.js`
- `packages/vibe64-genesis/src/server/architectureInspection.js`
- `packages/vibe64-genesis/src/server/architectureLayout.js`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64TemporaryAiRepairs.js`
- `src/composables/useVibe64SessionToolPane.js`
- `packages/vibe64-system-graph/src/client/composables/useVibe64SystemGraph.js`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`

## Public contract

The System Graph operations (Architecture, status, refresh, refresh status and
refresh cancellation) run through named `vibe64.system-graph.*` actions. The
Architecture read is the only projection of the Machine City; there are no raw
City, subsystem-map or retained-prototype reads. HTTP and direct
callers share required session inputs and fresh actor/project authorization.
The existing service remains responsible for resolving the selected source and
validating Genesis results. These engineering views are not direct Colleague
tools; investigation belongs to a coding conversation.

The existing source-keyed scan owner retains one current/last small status per
source for its process lifetime: original start, stage, terminal outcome and
bounded failure diagnostics. It retains no City result or separate job runner.
Duplicate admission returns the running scan, while cancellation waits for its
existing managed cleanup. Session-change notifications use `architecture-refresh`
through runtime events; the client filters project/session identity and rereads
status. Mount, reactivation and socket reconnect reconcile independently of the
view which submitted the request. A local timer advances elapsed display from
the server start; inactive/disposed views release timers and listeners. Terminal
status refreshes the status and Architecture readers. No persisted state format changes or
restart replay are introduced.

`inspectGenesisStackComponents` validates the current project format and requires
an explicitly saved Stack before returning normalized components and its hash.
The pinned Genesis parser and installed catalog own interpretation; callers do
not infer technologies from package files or treat a missing Stack as an empty
successful selection. This read-only API does not migrate source or execute
consumer operations.


Code indexing uses Genesis's parser management interface. Standalone first use
prepares only missing parsers needed by the source, outside project dependencies.
The Genesis command exposes `parsers list`, `parsers install`, and `parsers verify`.
Agent command and OpenCode environments preserve Genesis's parser directory and
automatic-installation policy through the public integration boundary. Hosts can
prepare all parsers in advance and prohibit runtime downloads with the same API.
Genesis runs native indexing in a finite child; the persistent Vibe64 process
retains no language parser mappings after indexing. Installation and verification
failures remain actionable Genesis diagnostics.

The library integration explicitly trusts only the validated source worktree
passed to each Genesis operation. That grant stays within the operation's
async context, so shared Unix ownership does not prevent inspection and
concurrent projects cannot inherit each other's trust. Git configuration,
repository ownership, and filesystem permissions remain unchanged.

Before a foreground message, conversation turn allowed to edit source, or
interactive agent terminal starts in an idle session, the terminal service asks
Genesis to inspect selected skills. Missing or outdated unmodified copies are
synchronized through the same public operation as `genesis skills sync`, inside
the existing agent-write and project-source mutation boundaries. Genesis chooses
the source version, validates ownership, and preserves customized or unmanaged
skills. Changed files are ordinary session work and trigger the normal
session-change event, except in a practice project (its context root is named
by the reserved `training-<id>` slug): there `practiceAgentGuidance.js` first
lists `.agents/`, `.claude/`, `.codex/` and `.opencode/` in the session clone's
`.git/info/exclude`, so Vibe64's guidance stays out of the learner's Current
changes and saved commits for every lesson; tracked files stay tracked.
If Genesis reports a selected skill package unavailable, Vibe64 records a
visible preparation-required diagnostic and lets provider delivery proceed.
It preserves the installed project skills, leaves the declared package version
authoritative, and neither substitutes the host package nor installs dependencies
as part of sending a message. Incomplete project-owned Stack contracts and
undecided competing section proposals (`STACK_SECTION_AMBIGUOUS`), recognized by
the boundary's shared `genesisProjectContractNeedsAttention()` predicate, defer
automatic skill refresh without invalidating successful setup or changing source,
so the conversation can repair or decide them; Vibe64 never picks a proposal.
Setup and launch retain their contract validation: workspace preparation records
an undecided section as `ambiguous` with Genesis's message, and the agent status
command reports it as a blocked inspection. Other inspection errors still propagate.
An active main or temporary turn skips this preparation. Routine connection
verification and read-only temporary conversations remain read-only. Project
format migration remains a separate operation, and skill maintenance does not
initialize source, run setup, or build indexes. Existing assistant context is
refreshed only through its native lifecycle; file synchronization alone does not
claim that loaded instructions have changed.

Before discovering Codex project hooks, Vibe64 trusts the exact managed worktree
through Codex's native configuration API. Thread-only overrides arrive too late
for native hook discovery. Already-trusted worktrees are read without rewriting
configuration; a failed trust write stops startup. This does not grant trust to
parent directories or replace Genesis's hook delivery.

Genesis's Claude adapter divides session guidance into numbered native hook
outputs to stay below Claude's per-output truncation limit. The composer and
host bridge remain shared with the other agents. Genesis reports guidance above
its 36,000-character Claude capacity explicitly instead of delivering a partial
guide; Claude does not enforce startup-hook stop requests.
The packaged host resolver keeps its instruction-generation import behind the
existing external Genesis package boundary. Ownership-only hooks validate the
native conversation and workdir without loading the compiler again; explicit
instruction generation still loads the same implementation on demand.
Claude session inspection binds its account and reconciles already-owned
processes, but defers a new native process until Send. This lets the existing
source-write preparation refresh project hooks before native startup reads them.
Opening a conversation does not synchronize files or load stale startup hooks.

New projects begin with Genesis and existing repositories can be adopted without
moving their source. Agent turns receive Genesis task guidance, while new and
compacted conversations receive the shorter portable Genesis session context.
For persistent conversations, Genesis composes Engineering and Collaboration
guidance with one provider-neutral Vibe64 session contribution. Vibe64's
progress updates and final answers use Genesis's configured tone, response
length, experience level, and explanation style. The host does not impose a
separate brevity rule. Bare Deslop requests use the agent's own task changes,
committed or uncommitted; explicit commits or ranges retain their chosen scope.
Vibe64's numbered-question presentation and managed-session operating rules live in
that stable contribution rather than being appended to each user message. Each
question’s answer list immediately follows that question, with one distinct answer
per bullet; a shared trailing list and slash-combined alternatives are forbidden. The
contribution points agents to `vibe64-helper spec` for exact Vibe64-owned
contracts instead of restating their grammar. Framework conventions, such as
JSKIT's test-database names, belong to the Stack piece that owns them; Vibe64
keeps only host rules, such as the `PLAYWRIGHT_BASE_URL` its managed Playwright
supplies. The
Vibe64 driver has no turn form and Vibe64 adds nothing to ordinary user turns.
Genesis still offers a generic bounded turn-context capability, but Vibe64 does
not use it. Genesis supports the one host driver and process bridge, not a
general prompt-plugin system.
For a new project, Genesis's opening task establishes product intent, presents
only relevant installed Stack choices, and waits for explicit confirmation
before selecting a technology. Vibe64 supplies the pinned catalog and its
conversation presentation contract but does not replace those onboarding rules
or choose a technology itself.
For an existing initialized project, the opening carries the full Blueprint,
bounded selected-Stack and Program summaries, and complete selected guidance
under its owning component headings. Exact Program modules, indexed source,
operations, verification commands, and applicable skills are loaded only after
the relevant path is known through `genesis context <path...>`.

People can refresh the project descriptions, explore subsystems and operations,
and open their participating files. Automatic reads follow the visible tool;
retained inactive sessions do not admit hidden reads. An explicit refresh can
finish while hidden, while subsequent reads wait for activation. Managed commands
retain the bundled, pinned Genesis invocation and selected Stack catalog.
The three-dimensional City presentation, its camera controls and the earlier
subsystem-list and layer-diagram prototype have been removed.

Architecture is the sole subsystem and Program presentation. It reuses the
canonical directory-bound owners and descriptions from `genesis/subsystems.md`.
Each Program operation belongs to one owner. The subsystem lists its capabilities;
selecting one opens its preview and cited files in a dedicated Program reader.
Read full explanation opens the complete authored text in a separate scrollable
dialog, full-screen on phones; closing it preserves the Program and source list. Each module explicitly
names a reading anchor in its owning subsystem, exposed by Genesis as mainSource.
File icons distinguish it with a gold border, star and Main label. Other files
show only Part of links to the Program reader; cross-subsystem library citations remain
visible without changing ownership. The former list-and-detail screen is retired.
Program is fallible authored explanation, not proof of a function's behavior or
of current source freshness. Missing Program facts remain explicit.

The useful native Machine and Program facts remain available for source
navigation. No Map action or restored camera state opens a City renderer.

Database inspection is admitted when declared data exists. Table links require
an exact Stack resource, schema and table match; `default` resolves only against
a known resource default. Unresolved or missing tables remain visible without a
working link. Schema tables without a resolved declared owner are listed separately.
A failed database inspection does not prevent reading the map. Opening a table
selects the existing ERD without querying records. Source and ERD navigation carry
the selected subsystem and presentation so Back returns to that context.


Architecture opens the spatial UI/Engine sheet through the existing async
loader. `pageStoryboard` uses explicit parents and registrations; parents centre
over child subtrees, siblings never wrap into descendants and roots remain
independent. `architectureOverview` places UI above Engine on the existing
Vue Flow canvas. Fit/UI/Engine and a compact options menu share host navigation.

`engineOverview` shows every native source owner as a circle. Genesis supplies readable names/descriptions. Architecture
layout supplies only explicit library/support roles
through the public Genesis boundary. Exact roots identify placements; missing
roots produce a diagnostic, not invented owners. Authored member order and role
guide arrangement; import rank does not define visible layers. Entry circles
are larger and say Start here, support circles are subdued, and measured size
growth is bounded. The grip/arrow keys change only local position. Libraries
form a fixed right-hand stack; observed opaque packages form the farther-right
alphabetical list without source trees, invented volume or arrows. Underlying
`architectureGraph` retains import/cycle and boundary evidence.

`subsystemOutline` consumes common owner/file/symbol/package/UI-operation facts.
Declared symbols flatten into a signature-first interface. Original source
path/hash/name/range joins resolve aliases to one native declaration. Stale,
ambiguous and opaque targets have no guessed source link. Other public exports
in externally used files remain review candidates; internal exports remain in
the file viewer. Kinds/recorded returns require no language renderer branches.
Import paths are secondary. Each signature can disclose its importing file paths
and follow them inside Architecture. Local imports remain visible for other
available exports; file-level evidence is labelled separately from specific
declaration imports, and no recorded imports never proves an unused export.
Generic group definitions belong on hover. Directory ownership supplies the file icon tree;
bars/heights compare measured source within the owner.

Semantic zoom changes a circle into one square on the same sheet, retaining a
faint circular backdrop. The square/skeleton paint before its detail prepares.
Explanation, Programs, Interface and Files shortcuts jump within the retained subsystem
document; empty Program sections are omitted. Compact signatures precede
grouped file icons with search, disclosures,
name/type/size sorting, single-click/tap and keyboard access. Direct files
precede folders at every level. Inspector and
file browser stay mounted behind a file interface; the latest single-file
viewer stays mounted but inactive on its enclosing views within that owner.
Map node IDs/types stay
mounted but hidden in detail. Camera frames do not recompute the overview or
change label font sizes.
Canvas resize adapts the open square's camera and retained file-history cameras
without changing magnification or remounting the scrollable content.

Wheel and two-touch pinch share one animation-frame camera path. The initial
element owns a gesture; neighbours cannot take over. Scale and centre interpolate
together on entry. Outward motion anchors the pointer/midpoint without aggressive
recentering. The enclosing presentation first matches the outgoing square's
screen position. Navigation cancels obsolete work instead of awaiting interrupted
animated D3 promises. Hidden/session cleanup cancels pending frames. Breadcrumbs
give explicit returns. Ordinary mouse/touchpad wheel scrolling and one-touch
swipes belong to the open square, including scroll boundaries. Its bounded
body scrolls long subsystem interfaces and file lists beneath a fixed breadcrumb.
Ctrl-scroll, pinch or a wheel over uncovered canvas zooms back. A single click/tap
or Enter opens a file icon. The fixed top-right close control and Esc return one
level without disturbing the enclosing state. Opening a file requires a click
or tap; outward movement cannot re-enter it. The enclosing reading camera is captured before a target grows, so return
does not restore oversized icons that cover the surrounding canvas.

The Back control retraces followed file links, retaining the previous exact
declaration and its enclosing camera/owner. The single-file host reports its
current selected declaration and presentation; this is navigation state, not
source analysis. Close and Esc use that same history for one-level returns. Engine and subsystem
breadcrumbs jump directly to their enclosing view and clear nested history.

The host's `file-interface` slot embeds the existing
`Vibe64SessionSourceEditor` in single-file mode with the requested path/native
symbol ID/original name. The host supplies the already loaded common architecture
facts, avoiding another whole-index read for
each file; standalone Files retains its existing graph resource. Hash checks
still compare those facts against the freshly read source. Public signatures reach implementation declarations
rather than the Files workspace. Existing hash checks, Helper admission and
explanation caches supply the document’s Explanation and Pseudocode fields,
Generate/Update controls and exact Code. No chat transcript or composer appears
in the file interface; discussion remains in the agent’s conversation. File
overviews are on-demand, informational and hashed against the whole saved file;
they do not require an index or replace authored Program text. Authored Program
context appears in its dedicated Program reader; main and supporting source files
link there without repeating it. Whole-file Code uses the shared editable Files
implementation, including save/conflict coordination, Undo/Redo and download. Missing return/parser/Helper evidence stays explicit. Selected declarations expand inline under their signature, avoiding a duplicate
heading and detached detail card.
The subsystem square shows its authored Genesis responsibility in an Explanation
field, followed by links to associated capability readers. Invalid Program evidence
keeps that responsibility visible and exposes the source-citation diagnostic in
Analysis details, without raw-document navigation. Its text and signatures can be selected without activating
the signature. The file view explains common definition kinds and distinguishes a file export
from the subsystem's intended API. Missing-Helper status appears before selection,
with disabled English modes and available whole-file Code stated directly.

`pageConnections` preserves component-mediated uses, protocol/scope and exact
controller joins. Separate receiving-file ports and purple labelled bridges
remain hidden initially; page selection shows its calls, while the menu can show
all. Unresolved counts never create guessed targets. Receives UI calls opens a
controller file and selects a declaration only when supplied by the inspector.
The browser owns presentation, not framework/transport discovery.

The obsolete layer prototype and subsystem list screen are removed. Their
reviewable implementations remain in the local checkpoint. Existing backend
ownership, subsystem, package, symbol and controller facts remain available.
The compact Architecture read joins existing hash-matched Machine source metrics
without rereading project files. Optional Entry files in the existing Vibe64-owned
Architecture inspection grammar supply stack-neutral application entry identities.
Reading those declarations executes no inspector; canonical paths are matched
to indexed file/directory owners. Missing or malformed entry declarations are
visible and do not replace the dependency map. No persisted application state
format or upgrade is introduced.
`layeredGraph` and `architectureGraph` retain source dependency and cycle
evidence; their ranks are not visible layers. The preview configuration deduplicates Vue
across linked packages and includes Vue Flow in initial dependency optimization
to prevent mixed Vue runtimes during lazy diagram loading.

Page observations and registrations come from the compiler's neutral validated
contract. The client performs no source extraction and requires neither URLs,
JavaScript nor filesystem routing. Explicit Re-scan project uses the existing per-request HTTP timeout facility
with a ten-minute budget, rather than the ordinary short mutation deadline.
The existing separate cancellation operation remains available, and failure
notices are small, dismissible overlays with bounded inspector command output.
The same admitted refresh tracks its actual stage and elapsed time in memory;
a lightweight authenticated status query polls only while this client is
refreshing, without reading either native artifact. Re-scan project and its
status belong to the Architecture toolbar, not the file viewer. File and
function explanations reuse the existing Helper stream and show its user-visible
progress messages; scanning never invokes that service.
Declared Required files and runtime/workdir prerequisites fail before scanning.
Re-scan reads existing Program text; it neither rewrites it nor calls a Helper. Refresh holds the original
source-work admission and invokes Stack's Vibe64-owned Architecture inspection
recipe through managed finite commands. Hashed inputs, UI discovery and package
boundary identity are passed on stdin; stdout is bounded observation JSON.
The inspector runs in Genesis's async observation callback after one source
extraction. Genesis joins its output to that scan, then rechecks the original
inputs before publication rather than extracting the whole project a second time.
Invalid output, cancellation or changed source retains the previous native
artifact. Opening is read-only. Original artifact paths and APIs remain
available to other callers. The Files manager retains its public interface,
English explanation, ordered steps and original source-editor presentation.

Genesis owns the Machine and Program City formats and their validator; Vibe64
calls it for saved and freshly refreshed Cities and reports a rejection as
`vibe64_invalid_genesis_city` with the City kind and path, keeping no copy of
the schema. Architecture status and view reads share at most two immutable
validated city snapshots. Filesystem identity/revision changes invalidate reuse; failed or
in-flight replacement reads cannot publish stale facts. Interface preparation
uses loaded common facts and only the selected owner rather than rebuilding its
layered file graph or the mounted overview.

Subsystem descriptions are substantive authored responsibilities, rendered inline.
Each subsystem lists its Programs; a selected Program has its own Architecture
view with its explanation, required main source and supporting file icons.
Source links use the existing Files viewer and editor inside Architecture.
Back, Escape and close return through the retained view history. File membership
links open the Program view, never its Markdown source or an inferred entry file.
Regenerated canonical directory owners and Program assignments replace the shown
facts; no consumer-owned subsystem catalogue or explanation store is introduced.
