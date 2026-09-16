# Genesis project context

Vibe64 presents and refreshes the portable project understanding maintained by
Genesis without creating another interpretation of the application.

## Sources

- `packages/studio-terminal-core/src/server/codexRuntimeContext.js`
- `packages/vibe64-terminals/src/server/agentCommandEnvironment.js`
- `packages/vibe64-terminals/src/server/agentSessionCommand.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-genesis/src/server/promptContext.js`
- `packages/vibe64-system-graph/src/server/service.js`
- `packages/vibe64-system-graph/src/client/components/Vibe64SystemWorldView.vue`
- `packages/vibe64-system-graph/src/client/components/Vibe64SubsystemsView.vue`
- `packages/vibe64-system-graph/src/client/subsystemsModel.js`
- `src/composables/useVibe64AutopilotView.js`
- `packages/vibe64-system-graph/src/client/composables/useVibe64SystemGraph.js`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`

## Public contract

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
session-change event.
If Genesis reports a selected skill package unavailable, Vibe64 records a
visible preparation-required diagnostic and lets provider delivery proceed.
It preserves the installed project skills, leaves the declared package version
authoritative, and neither substitutes the host package nor installs dependencies
as part of sending a message. Incomplete project-owned Stack contracts defer
automatic skill refresh without invalidating successful setup or changing source,
so the conversation can repair them. Setup and launch retain their contract
validation. Other inspection errors still propagate.
An active main or temporary turn skips this preparation. Routine connection
verification and read-only temporary conversations remain read-only. Project
format migration remains a separate operation, and skill maintenance does not
initialize source, run setup, or build indexes. Existing assistant context is
refreshed only through its native lifecycle; file synchronization alone does not
claim that loaded instructions have changed.

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
that stable contribution rather than being appended to each user message. The
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

People can
refresh and explore the detailed Machine City and explanatory Program City,
navigate subsystems and operations to their participating files, and open those
files for editing or discussion. Task guidance names Genesis operations without
assuming a machine-global executable. Automatic City reads follow the visible
Cities pane; retaining another session keeps its view mounted without admitting
those hidden reads. A requested refresh may finish while hidden, but does not
start subsequent status or City reads until normal activation. Hiding during a
status read also prevents its result from starting hidden City reads.
Managed agent command environments expose
Vibe64's bundled, pinned Genesis command and Stack catalog; projects that pin
their own Genesis compiler continue to invoke that local version explicitly. A
person's first City visit in a browser gives
dismissible guidance for trackpad, mouse, and keyboard movement, rotation, and
zoom. Exploring the City does not create or submit an assistant prompt. Routine
automatic follow-ups that produce no result remain hidden, but an explicitly
requested final user-facing summary is preserved even though it changes no
files. Vibe64 displays only Genesis documents and does not infer a parallel
architecture.

The Subsystems destination reads the selected session's `genesis/subsystems.md`
through Genesis's version-zero inspection API. The default overview uses a compact searchable list and one detail pane. The list
shows names and counts; the selected responsibility, expandable Program operations,
and owned/used data live in the detail pane. Operations and Data have separate tabs.
Descriptions render paragraphs, wrapped list items, code and links with the
existing safe Markdown renderer; long descriptions
expand on request. Narrow panes show either the list or the detail with a Back
action. Links on used tables navigate to their owning subsystem. It does not infer
ownership from directories or create operation-to-table dependency edges.
Program contracts and source links use the generated Program City when available;
the authored Program files remain directly accessible before generation.

The optional City presents operations as tall buildings and owned tables as low
teal buildings in their declared subsystem districts. It opens at full width without a selected responsibility panel. Selecting a
subsystem or operation opens the same detail content in a closable inspector;
Escape dismisses it. Switching presentations closes the inspector. Machine City
remains accessible. Projects without a
map can still explore existing Cities; their operations are explicitly unassigned.
The empty overview starts a temporary workspace-writing task to generate the
map using the session's selected model and normal tools. It reuses the existing
temporary task lifecycle and deduplication, leaves the main composer untouched,
and keeps source edits for ordinary review and Save. Completion notifications
carry the task's existing deduplication key so only the matching session reloads
its subsystem data. A hidden retained subsystem view reloads when next active.
Invalid declarations show the inspection error with Retry, Open declaration, and
Repair map with AI through the same temporary task. Generation and repair require
the installed Genesis Program skill's exact grammar and a successful
`inspect subsystems --json` result.

Database inspection is admitted when declared data exists. Table links require
an exact Stack resource, schema and table match; `default` resolves only against
a known resource default. Unresolved or missing tables remain visible without a
working link. Schema tables without a resolved declared owner are listed separately.
A failed database inspection does not prevent reading the map. Opening a table
selects the existing ERD without querying records. Source and ERD navigation carry
the selected subsystem and presentation so Back returns to that context.
