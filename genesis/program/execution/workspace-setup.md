# Workspace preparation

Vibe64 can prepare a fresh session source using its exact Workspace setup
contract transported by the project's Stack.

## Sources

- Main: `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-terminals/src/server/resourceWorkflow.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-runtime/src/server/workspaceSetupState.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-genesis/bin/genesis`
- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-genesis/src/server/workspaceSetup.js`
- `packages/vibe64-genesis/src/server/connectedDevelopment.js`
- `packages/vibe64-genesis/src/server/stackOperation.js`
- `packages/vibe64-genesis/src/server/agentSpecs.js`
- `src/components/studio/Vibe64TemporaryActionTerminal.vue`
- `src/components/studio/Vibe64TerminalSurface.vue`
- `src/components/studio/Vibe64TemporaryAiFixAction.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64TemporaryAi.js`

## Public contract

Agents read the exact Workspace setup, Outputs, Connected development and other
section grammars with `vibe64-helper spec <name>`. Every Vibe64 section parser
error ends with `Exact grammar: vibe64-helper spec <name>.`, added from one map
in `stackOperation.js`; an unknown entry also lists the valid entry forms from the
same tables the spec prints.

The Genesis boundary also inspects `## Connected development` as
`vibe64.connected-development.v1`. This is a separate development recipe, not
an alternative connection list. Repository identities belong only in the
project's `vibe64.connections.json`; Stack owns generic treatment. Optional
`Default package type` declares one type from the shared connected-project
vocabulary (`npm`, `composer`, `pip`, `bundler`, `gomod`, `cargo`, `maven`,
`gradle`, `nuget` or `custom`), independently of command runtimes or the
project's other technologies; a multi-language project declares one default. A connection's explicit type
wins; an omitted type requires this declared default. The resulting source map
contains the effective type for each repository, and changing that selection
invalidates preparation. A default-only section is unconfigured: it supplies
metadata but cannot certify source consumption. A custom connection supplies a
safe project-relative `script`; `Custom runner` declares the interpreter argv
and runtimes using the existing setup grammar. The runner appends the resolved
script and `--phase`, `--source-root`, `--project-root`, `--sources-file` and
`--repository` arguments. Prepare runs before Verify; both phases must succeed.
The script receives `prepare` or `verify` as its phase. Missing runners or
scripts, symbolic-link escapes, and non-custom connections carrying a script fail.
Custom source checks do not replace Verify commands when non-custom types exist.
One `Sources file`
declares the project-relative input location. Ordered `Prepare` and `Verify`
entries reuse the Workspace setup argv, runtime and working-directory grammar.
Prepare entries precede verification. Every non-custom source type requires a
Verify entry (`vibe64_connected_verification_required`), because Vibe64 runs no
ecosystem command of its own; custom-only recipes may use the Custom runner's
verification phase.
Conditions are rejected so missing files cannot silently skip a consumption
check. Exactly `- Nothing.` or an absent section is unconfigured. Invalid or
blocked sections cannot yield a ready recipe identity.

Inspection preserves the selected toolchain's commands without language or
repository switches. Its identity covers the source-map location, steps and
runtimes. Genesis transports the opaque section; inspection neither creates
that file nor runs commands. A ready inspection only means the declaration is
valid. Explicit connected-source preparation now asks Project to write the
declared input map from authorized receiving sessions. That owner reports
`inputs-prepared`; it does not run the recipe. Normal workspace preparation uses
the same allocation owner, then executes ordinary setup followed by connected
Prepare and Verify commands through the existing managed runner. Project's
combined inspection includes both recipe identities and the exact source map.
Sessions reauthorizes the receiving sources before each command and before
accepting a cached success. Those authorized roots enter the existing execution
request; the map itself grants no filesystem authority. Node.js consumption
has a focused real npm/import proof; other toolchains remain unproven.

A requested run (session creation, Prepare or Retry) with connected development
first saves a running `Preparing connected projects` state and returns; the
allocation and the rest of the recipe continue in the observed background run,
so creating a session no longer waits for every connected checkout. Sessions
reports which connected projects remain through that running label and publishes
each change. An unrequested start keeps cached-success reuse and runs the same
preparation inline.

Working-session preparation and explicit Prepare/Retry consume the existing
project connection file. They never create that file or import connections from
Stack. Settings or ordinary source editing owns changes to the connection list.

Required workspace preparation is a neutral, dismissible action notice. The
existing terminal summary shows the declared setup diagnostic once and keeps
Prepare workspace available without error styling or a duplicate error panel.
Earlier setup output remains in the expandable log, not the required notice's summary.
Failed/ambiguous preparation and failures to start it retain error diagnostics,
retry and repair controls. Running output and terminal expansion are unchanged.
The session header and compact Session actions menu retain Prepare workspace
after success or notice dismissal. An explicit request reruns the complete current
recipe through the same managed runner and admission, including an unchanged
successful recipe; running or archived sessions remain unavailable. Cached success
records earlier execution, not freshness of custom build outputs after source or
script edits. Those changes can use this explicit rerun without a separate cache
ledger or automatic custom rebuild watcher.

`vibe64.workspace-setup.v1` is the only accepted schema. Its source is strict,
readable Markdown: each `Prepare` entry declares a label, runtimes, optional
working directory and path condition, then separate backticked argv values.
Vibe64 parses that opaque Stack section mechanically and runs the normalized
argv with the project's resolved environment. It runs once for a fresh recipe,
records progress and exact recipe identity, waits before dependent work, and
exposes explicit rerun after success or failure. Missing or ambiguous declarations remain explicit;
Vibe64 never guesses an installer or reads a retired grammar.

When managed workflow accounting is available, the full declared preparation
sequence shares one accounting group. The runner supplies its exact runtime
and dependency identity plus optional normalized Stack resource estimates.
Success and failure both finalize that workflow through the provider; missing
optional estimates do not block old projects. This adds no commands and does
not reorder setup, database seeding, imports or migrations. Shared environment
provisioning remains separately owned.

After environment preparation, the runner re-inspects the current setup before
requesting admission. Changed or removed steps fail with a direct Retry message
before any setup command or workflow is started. Estimate-only changes use the
fresh optional hints, including their missing/invalid fallback, without repeating
environment provisioning. After admission returns, another inspection verifies
the recipe and Stack still match the admitted snapshot. A change while waiting
releases the unused workflow through ordinary finalization and runs no command.
Explicit Retry reads the new recipe; the runner never silently switches commands
inside an already-started preparation attempt.

Before Update or its interrupted-operation recovery replaces session source,
the terminal service invalidates preparation durably. The `required` state
clears the successful recipe identity and retains the earlier transcript with
the reason for invalidation. An unchanged installer command cannot certify
dependencies for updated source. A no-op Update retains preparation. The next
preparation uses the existing managed execution and admission path; Update
does not run installers itself. The required-state banner offers Prepare
workspace directly, without requiring AI. Its message remains accurate after
Update finishes instead of claiming source is still changing. The server accepts
that explicit request in the required state and runs the full declared recipe,
not merely an inferred package install. A command run independently in chat
cannot certify that recipe. An explicit preparation retry at the runner seam
reruns even a previously successful recipe, allowing repair of removed installed
files. The public Prepare workspace action also permits this explicit rerun
after success, including when the prior success notice was dismissed.

Preview can inspect whether the current recipe already succeeded without taking
assistant-write admission. If preparation is needed, it rereads the session under
that admission and holds it until the preparation command finishes. A busy
admission result prevents the preview from continuing with an unprepared recipe.

If an explicit retry finds that Genesis recognizes the project as unversioned
or outdated and prescribes migration, Vibe64 runs its bundled `genesis migrate`
command through the same locked managed-source execution boundary. That command
declares both its Node and Git runtimes and receives the exact session source as
a Git-safe directory, so the managed daemon identity can inspect the
session-owned worktree without weakening Git policy elsewhere. Vibe64 records
the bounded output, re-inspects the resulting Stack contract, and then runs the
declared preparation recipe. It does not migrate a current, newer, invalid, or
otherwise unrecognized project merely because setup inspection failed.

Preparation uses the shared terminal surface's subtle theme-aware background in
both compact and expanded states, separating the operation from the conversation.
During preparation, the workspace shows one compact progress line. Opening its
details keeps the same card, heading, status and progress line, with controls
beside the description, and reveals
the bounded transcript; while work is active, Collapse returns
to the compact line and Dismiss is unavailable. After the operation finishes,
Dismiss removes it. An opened transcript remains available after completion
until dismissed. The browser remembers that dismissal across reloads for the
exact preparation attempt without changing its result; a new attempt is visible
again. A successful preparation left compact disappears when it finishes; a
failure remains visible with direct Retry and Fix it with AI actions until
dismissed, without requiring the person to expand terminal details. Fix it
opens a workspace-writing Temporary AI task with the current diagnostic and
bounded transcript, selects and focuses that separate chat, and presents a
concise visible request instead of the complete operational prompt. A compact
heading shows repair status while the AI works; the result appears afterward. Every
product surface that offers this ephemeral repair path uses the same Fix it with
AI control and handoff presentation.
The shared action banner fits its containing pane, wraps failure messages, and
keeps Retry, details, Dismiss and Fix it with AI independently usable. Narrow
panes give actions their own wrapping row; the repair control can wrap its label
when magnification leaves less room than its usual width.

After an accepted repair turn completes or fails, Vibe64—not the assistant—runs
the deterministic preparation retry and records its result. This includes a
provider timeout after edits may already have landed; an explicit user stop is
not treated as permission to retry. A repair that changed nothing simply
returns to the same authoritative setup failure. If the assistant needs human
input, that question remains in the temporary conversation instead of being
mistaken for a completed repair.


Successful setup may record the resource provider's opaque identity in its existing
`workspace_setup` metadata. Only the completed command recipe establishes that
identity; failed or historical states do not. After a daemon restart, an unchanged
successful recipe can use the existing project environment preparation owner to
restore readiness. Reuse requires matching recorded/current/prepared identities,
verified preservation of existing databases, and fresh unchanged recipe/readiness
checks. Created, changed or unknown resources run the full recipe using the already
prepared environment. Missing historical identity runs setup once; explicit Retry
always runs it. Providers without this optional evidence retain ordinary readiness
checks and gain no cold-recovery reuse. The prospective numbered state upgrade
records this new-write boundary without inferring any historical resource identity.
