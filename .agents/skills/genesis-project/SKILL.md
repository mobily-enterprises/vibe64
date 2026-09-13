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
Vibe64, `## Workspace setup` or `## Outputs`). Genesis treats those sections as
opaque text; the named consumer alone owns their meaning and execution. Do not
claim a proposed recipe is usable until it matches the source.

Program is concise, fallible explanation. Its Sources and optional
Implementation maps aid navigation but never substitute for reading code,
tests, and runtime behavior.

`.genesis/machine-city.json` is a derived detailed file/function map.
`.genesis/program-city.json` is a derived simpler subsystem/operation map.
Neither is authority or proof; both may be regenerated with the Genesis
`index` operation.

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
  consumer-owned operation declarations, such as Vibe64 `## Outputs`, aligned
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
- Keep the implementation direct and cohesive. Apply any supplied Stack
  Post-change guidance before reporting completion; it is part of this
  implementation turn, not a request for another agent turn. Run focused checks
  when useful.

## Verify and report

After the selected technology's workspace substrate exists, use the Genesis
`verify` operation for the Stack's declared final checks. An unconfigured result
means the declared workspace or checks do not exist yet; it is not a failing
check. Before reporting completion, compare the requested observable behavior,
required inputs and resources, declared project operations, and focused evidence
with what actually exists. Report files changed, checks actually run,
anything not proven, and anything still requiring attention. Never claim that
an unrun check passed or that passing checks prove the whole product.

## Subsystem maintenance

Maintain `genesis/subsystems.md` in the same implementation turn when a change
adds, removes, or changes a subsystem responsibility, Program membership, or
data ownership/use. Read the map before changing related code. Reuse existing
subsystems unless a distinct responsibility is evidenced. Declare each Program
module exactly once; folders do not determine membership. Keep table references
grounded in schema/migrations; Genesis does not inspect databases. Private
helper changes need no map edit when these associations remain unchanged.

If `genesis/subsystems.md` is missing, or is empty in an existing explained
application, create it from the actual source, schema, and existing Program
before implementation. This is ordinary explanatory adoption, not a blocker or
a reason to ask permission again. Preserve the existing Program and source;
inspect the relevant responsibilities and complete the smallest truthful map.
Initialization can create the empty file, but only the agent authors its meaning.
