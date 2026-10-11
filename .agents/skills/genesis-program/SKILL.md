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
