---
name: genesis-project
description: Work safely in a Genesis-enriched codebase using its Blueprint, Stack, subsystem Program, path-focused context, and concrete verification. Use for implementation or review in a repository containing genesis/blueprint.md.
---

# Genesis project work

Genesis is an explanatory and verification companion. It does not replace the
codebase, tests, Git review, or the coding agent.

## Establish new-product direction

For a new project whose Blueprint does not yet establish product direction,
do not research technology or create source until the user has made clear what
is being built, who or what will use or invoke it, and the first observable
useful outcome. Ask only unresolved high-impact questions. A reply confirms only
what it explicitly answers; Stack confirmation is not product intent.

Once product direction is clear, choose one smallest implementation path
through selected technology guidance, or authoritative technology documentation
when the catalog has no match, and read only what that path requires. Do not
survey alternatives, clone whole technology repositories, inspect unrelated
package internals, or delegate research unless one concrete failure requires
one exact investigation.

## Run Genesis commands

Resolve the invocation before running the first Genesis operation. Do not use a
Genesis operation or `genesis --version` as an availability probe.

1. Read the repository-root `package.json`. Treat Genesis as project-pinned only
   when that manifest's `name` is `genesis-compiler`, or its `dependencies`,
   `devDependencies`, or `optionalDependencies` contain the exact
   `genesis-compiler` key.
2. For a project-pinned repository, invoke every Genesis CLI operation with
   `npm exec --no -- genesis <arguments>`. This runs without fetching another
   package. If the declared package is not installed, report that the project's
   dependencies are not prepared; do not fall back to another Genesis version.
3. Otherwise, do not try `npm exec`. Run `command -v genesis` (or the current
   shell's equivalent `PATH` lookup). When it resolves an executable, invoke
   `genesis <arguments>` directly.
4. When neither source is available, stop and report that Genesis is
   unavailable. Never install or update Genesis merely to satisfy a workflow
   instruction.

Successful invocation resolution is routine. Do not narrate whether Genesis is
project-pinned or on `PATH`, and never describe direct `PATH` use as a fallback.
Mention how the invocation was selected only when resolution fails or the user
explicitly asks.

Follow the configured Collaboration approach for user-facing updates, including
its technical depth and response length. Report concrete progress,
findings, or blockers; do not announce that you are following guidance.

## Resolve explicit technology choices

Before external technology research or implementation, when the user explicitly
names a technology, framework, language, or database that is not selected:

1. Run the Genesis `stack list` operation as the first technology action.
2. If one catalog component exactly matches the choice, ask: "<Technology> is
   available in Genesis. Would you like me to add it to this project and prepare
   the app with its official guidance?" Do not run `stack add <piece...>`
   without that confirmation.
3. If confirmed, add the component, let Genesis apply its declared dependency
   closure and synchronize any authoritative Agent Skill declared by that
   component. Follow the preparation prompt returned by `stack add` in the same
   task: make each materialized project contract true or replace a complete
   section with evidenced reality. Then run `context .`, or the relevant source
   path once source exists, load the applicable installed skill if present, and
   follow that technology-owned guidance to prepare actual project
   dependencies. Never infer an installation command from a component id.
4. If declined, continue without adding the component or asking again. If no
   catalog component matches, do not invent one; continue normally using
   authoritative documentation owned by that technology.

## Establish context

1. Read `genesis/blueprint.md` for non-technical product intent.
2. Read `genesis/engineering.md` for the selected engineering profile and any
   project-specific requirements.
3. Read `genesis/stack.md` for the selected technical composition, resources,
   and verification commands.
4. Locate the source involved in the request.
5. Run the Genesis `index <name-or-path>` operation before adding a helper or
   public operation. Reuse an existing function when it already owns the
   behavior.
6. Run the Genesis `context <path...>` operation for the relevant Program
   explanations and selected Stack context.
7. Load applicable technology skills from `.agents/skills/` or from the
   agent's own installed skill catalog.

For an existing application's first Stack selection, inspect its real setup,
build, and output commands before accepting materialized component proposals.
A selected component describes its current foundation; it does not silently
port older source. When the existing commands differ, keep the implementation
unchanged and replace the complete project-owned consumer operation (for
example, a host's `## Workspace setup` or `## Outputs`). Genesis treats those sections as
opaque text; the named consumer alone owns their meaning and execution. Do not
claim a proposed recipe is usable until it matches the source.

Program is concise, fallible explanation. Its Sources and optional
Implementation maps aid navigation but never substitute for reading code,
tests, and runtime behavior.

`.genesis/machine-city.json` is a derived detailed file/function map.
`.genesis/program-city.json` is a derived simpler subsystem/operation map.
Neither is authority or proof; both are git-ignored and may be regenerated
with the Genesis `index` operation.

## Implement ordinary local work

- Apply the effective engineering approach supplied by Genesis. Every change
  must be easy to reason about and be the smallest targeted implementation that
  fully meets known requirements. Do not overengineer or overcomplicate it, and
  do not add speculative abstractions, layers,
  dependencies, infrastructure, compatibility paths, distributed patterns,
  cryptography, or other advanced machinery.
- When a concrete requirement makes material complexity necessary, stop before
  writing it. Explain why the direct design is insufficient and the smallest
  added complexity proposed, then ask the user to approve or clarify the
  tradeoff. Never silently override the engineering approach.
- Work directly in the current Git tree and leave useful edits visible in the
  ordinary diff.
- Keep the Blueprint and affected Program modules aligned in this same turn
  when implementation intentionally changes observable product behavior.
  Private restructuring may require only corrected Sources or an informational
  Implementation map, and may require no explanatory edit. Keep exact
  consumer-owned operation declarations, such as a host's `## Outputs`, aligned
  when implementation intentionally changes the corresponding commands or
  capabilities. Record only capability metadata and environment-variable names
  there, never values or secrets; do not infer or execute the section as
  Genesis behavior. Treat `.genesis/` as replaceable derived navigation data,
  not authored product intent.
- Follow established project and technology seams instead of creating parallel
  frameworks, persistence layers, transports, validators, or UI systems.
- Never invent unavailable external-resource values or pass literal
  environment-variable names as data. Report the missing resource and preserve
  useful work.
- An application that must run untrusted code, such as commands a user or an
  AI submits, declares the sandbox capability it needs through its hosting
  platform's own mechanism; that capability takes effect only once the person
  who owns the deployment approves it. Never loosen a platform's sandbox or
  security settings, declare a runtime, permission or capability the platform
  does not provide, or switch application features off to make a build or
  deploy pass. Explain the failure and ask the person to decide.
- When an application needs host-level preparation beyond its package
  manager, such as system packages, devices or host permissions, put it in one
  script per hosting environment, `scripts/hosting/<host>.sh`, selected by the
  `HOSTING_SCRIPT` environment variable and run from the hosting platform's
  preparation step. Only a step done differently on another host goes there;
  everything the same everywhere stays in the shared install. A hosting script
  uses only what the host offers and never works around its rules: what the
  platform provides, the application declares instead of installing. A host
  that lacks something makes the script fail loudly with a plain sentence,
  never quietly switch features off. An application that needs no host-level
  preparation has no hosting script; never add one to starters or templates.
- Keep the implementation direct and cohesive. Apply any supplied Stack
  Post-change guidance before reporting completion; it is part of this
  implementation turn, not a request for another agent turn. Run focused checks
  when useful.

## Verify and report

During implementation, select the checks relevant to the change. Run the
Stack's declared final checks through Genesis `verify` when required by the
project's verification policy or the user's request, after the selected
technology's workspace substrate exists. Finishing an item or resuming a
session does not itself require a broad verification run. Keep full output in
local artifacts, preserve exit status, and read summaries and relevant failure
excerpts before expanding logs. Do not weaken assertions or omit required
coverage to save time or tokens.

A change to user-visible behavior ships with the browser specs that cover it
updated and run in the same change, before pushing. When an existing spec
fails, first classify it as outdated (the behavior changed on purpose) or as a
regression. Fix regressions in the product, and change a spec only for an
intended change, naming the change that made it outdated. Test resources a
managed host supplies, such as a login state, base URL, browser, or ports, are
the host's contract. If they do not work (for example, tests run signed out
despite a supplied login), report the host defect with evidence and stop; never
compensate in the project by rewriting cookies or adding its own login or
browser.

Speed is verified like behavior, with the engineering approach's sanity
checks. A change to a list, batch or write path ships with a test at realistic
row counts and history that compares its query count at a few rows and at a
realistic number. Read the run's preparation, suite and slowest-file timings
with its counts; when one grows with the data, find the cause (a read per row,
an access check sized by stored history, test preparation that replays
migrations) before reporting completion. Search the changed reads, pickers and
lookups included, for rows filtered, found, sliced or tested in code and for a
capped read used as if complete; move each into the query, or state in the code
why the store cannot express it. After a refactor, walk the behavior
list made before it and report any item that no longer holds. Before reporting
data access, tests, a refactor, a screen or a release done, read the matching
section of [the sanity checks guide](references/sanity-checks.md) and apply its
checks with the tools your Stack pieces name.

An unconfigured result means the declared workspace or checks do not exist
yet; it is not a failing check. Before reporting completion, compare the
requested observable behavior, required inputs and resources, declared project
operations, and focused evidence with what actually exists. Report files
changed, checks actually run, anything not proven, and anything still requiring
attention. Never claim that an unrun check passed or that passing checks prove
the whole product.

## Subsystem maintenance

Maintain `genesis/subsystems.md` in the same implementation turn when a change
adds, removes, or changes a subsystem responsibility, Program membership, or
data ownership/use. Read the map before changing related code. Reuse existing
subsystems unless a distinct responsibility is evidenced. Require one Source Directory per subsystem and declare each Program module
exactly once; Program folder names do not determine membership. Keep table references
grounded in schema/migrations; Genesis does not inspect databases. Private
helper changes need no map edit when these associations remain unchanged.

If `genesis/subsystems.md` is missing, or is empty in an existing explained
application, create it from the actual source, schema, and existing Program
before implementation. This is ordinary explanatory adoption, not a blocker or
a reason to ask permission again. Preserve the existing Program and source;
inspect the relevant responsibilities and complete the smallest truthful map.
Initialization can create the empty file, but only the agent authors its meaning.
