---
name: genesis-program
description: Create, reconcile, or review the explanatory Blueprint and subsystem-oriented Program of a Genesis project. Use when adopting a codebase, documenting public operations, or updating explanations after implementation changes.
---

# Genesis Blueprint and Program

Blueprint and Program are maintained explanations, not proof, ownership, or an
exhaustive semantic model.

## Blueprint

`genesis/blueprint.md` is a short, cohesive, non-technical description of what
the product should do. Prefer explicit user intent. Do not mention frameworks,
packages, route spellings, schemas, source files, implementation plans, tests,
or private architecture.

Update Blueprint after implementation only when the change intentionally adds,
removes, or alters observable product behavior. Never turn an accident, bug,
private design choice, or ambiguity into product intent.

## Program

Organize Program in readable directories; membership is declared only in
`genesis/subsystems.md`, independently of directory names:

```text
genesis/program/billing/invoices.md
genesis/program/authentication/sessions.md
```

Create one module for each meaningful public operation provided by a subsystem,
regardless of language or source layout. Public operations include exported
functions or methods, API actions, commands, UI operations, and other observable
entry points. Do not mirror source files or document every helper.

Each module contains:

```markdown
# Human-readable boundary name

One short explanation of why the boundary exists.

## Sources

- Main: `exact/authored/main/source/path`
- `exact/authored/supporting/source/path`

## Public contract

Meaningful inputs, outputs, effects, failures, and guarantees.
```

Every module requires exactly one `- Main:` source bullet. Choose the main
source explicitly as the place to start reading the implementation; it need not
be an executable entry point. It must belong to the module's owning subsystem,
respecting more specific nested directory owners. Other Sources may cite shared
libraries in other subsystems. Never infer the main file from source-list order,
imports or file naming. When reconciling older modules, inspect the source and
mark the anchor explicitly; indexing does not assign one for you.

An optional `## Implementation map` may name only private helpers or seams that
materially help a future agent change, trace, or debug the operation. It is
informational, not a public guarantee. Tests are evidence and never
implementation Sources.

Prefer fewer, clearer modules. Remove stale and duplicate explanations. A
source may support several operations; helper and glue files may appear in no
Program module.

## Task boundaries

The caller determines whether this is initial description, complete Program
refresh, focused post-change reconciliation, Blueprint-only work, or read-only
review. Respect the caller's edit boundary. Report ambiguity rather than
inventing intent.

## Subsystems

Maintain `genesis/subsystems.md` alongside Program in description and refresh
work. Blueprint-only work does not change the map; review remains read-only.
The map is the authored association authority, but responsibilities and table
references remain fallible explanations of application source and schema.

Use this exact version-zero grammar:

```markdown
# Subsystems

## `forms` Forms

Owns reusable form rendering, validation, and submission capture.

### Source
- Directory `packages/forms`

### Program
- `genesis/program/forms/render.md`

### Data owned
- Table `database` `default` `form_definitions`

### Data used
- Nothing.
```

Use one stable lowercase hyphenated id and a human title per subsystem. Each
entry needs responsibility prose and the Program, Data owned and Data used sections.
Responsibility prose is the subsystem's full explanation, not a map caption.
Explain its purpose, scope, important parts and collaboration with other owners.
Preserve substantive existing descriptions; do not replace them with one-line
labels to suit a visualisation. A consumer can shorten the displayed preview.
Simple support directories may need only a short explanation.
The required Source section contains exactly one `- Directory` entry with a backticked path: a
canonical project-relative directory, with `.` allowed for the project root.
Every subsystem has one directory root; never declare dispersed or multiple
roots. Stack parent-directory rules discover default subsystem roots but are not
exhaustive. An agent may recognise and declare another root elsewhere from
actual responsibility and source evidence. The authored declaration persists
through ordinary indexing. The authored map is the canonical owner list once ready; Stack roots are adoption
hints and never create additional owners or split an authored boundary. Cover every
indexed source, using a project-root owner for remaining support files if needed. UI components and Engine code may
share one root; UI projection does not change ownership. Empty
sections say `- Nothing.`; a new empty map contains only `# Subsystems` and
`- Nothing.`. Every Program module belongs to exactly one subsystem. Program directory names do not assign ownership. Sources may cite another
subsystem’s libraries without giving the operation or implementation two owners.
Do not use globs, duplicate operations or duplicate table owners.

When regenerating or deliberately splitting the map, reconcile the explanations
with the new directory owners. Transfer the applicable responsibility prose and
explicit Program assignments together, preserving stable ids where the boundary
is unchanged. Recheck every Program's required main source against its current
owner, including nested owners; library references retain their own ownership.
Use the current declarations rather than an earlier consumer's hardcoded names,
directory layout or cached list. Inspect subsystems and Program and resolve
missing/duplicate membership and invalid main anchors before claiming completion.

A table identity is three separate exact backticked values: the declared Stack
resource id, schema, and table. `default` means the resource's default schema;
use an explicit schema where applicable. Never record a host database name,
credential, SQL expression, or environment value. Data used references a table
owned by another declared subsystem. A subsystem may own data without Program
operations, or operations without data. Read the real schema/migrations before
assigning ownership; report uncertainty instead of inventing associations.

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
