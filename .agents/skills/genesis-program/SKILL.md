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

- `exact/authored/source/path`

## Public contract

Meaningful inputs, outputs, effects, failures, and guarantees.
```

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

### Program
- `genesis/program/forms/render.md`

### Data owned
- Table `database` `default` `form_definitions`

### Data used
- Nothing.
```

Use one stable lowercase hyphenated id and a human title per subsystem. Each
entry needs responsibility prose and exactly the three sections shown. Empty
sections say `- Nothing.`; a new empty map contains only `# Subsystems` and
`- Nothing.`. Every Program module belongs to exactly one subsystem. No folder
inference, globs, duplicated operations, or duplicated table owners.

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
