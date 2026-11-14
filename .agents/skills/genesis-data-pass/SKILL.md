---
name: genesis-data-pass
description: Make a project's data hold up at real sizes through an explicitly requested data pass over the whole app, a named section, or the agent's own changes, covering queries that grow with the rows read, no per-row lookups, filters and limits in the query, every constraint enforced and tried, safe migrations, indexes for the filters the app really runs, and tests at realistic sizes. Use when asked for a data pass, or to check data access, scale, constraints, migrations or indexes.
---

# Genesis data pass

Make the software's data access correct and affordable at the sizes it will
really hold, and prove it with counts. A data pass is explicit: never run it
merely because implementation finished.

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

## Load the effective project instructions once

A data pass request may arrive as a complete Genesis-generated prompt or as a
direct request such as `Data pass` or `Data pass the Orders section`.

If the current task already contains `GENESIS CONTEXT` whose task is
`data-pass`, continue with it directly. Do not generate another prompt.

Otherwise, before resolving scope, run the Genesis `prompt --task data-pass`
operation once using the invocation rule above. For a bare `Data pass` request,
pass no request argument. When the user names a section, commits or your own
changes, pass that exact request as one safely quoted argument. Treat the
printed prompt as the instructions for this same turn; do not dispatch it to
another agent and do not generate it again. This step composes the selected
Stack's data pass guidance and any project customization with the portable
contract below.

When the user asks for a deep run of this pass, pass its Deep request,
`Data pass the whole app deeply.`, exactly;
Genesis then adds the run's `DEEP RUN` section.

## Resolve the scope

Inspect `git status --short` and the staged and unstaged diffs before editing.
A dirty worktree is allowed. Preserve the existing index and unrelated work; do
not stage, stash, commit, or discard changes as a prerequisite.

When the prompt has a `PASS RUN` section, the request is one of the pass's own
runs (the whole app, the changes since its last completed run judged against
the whole app, or a deep run) or a run over the changes since a base commit the
request names, and its scope is the one that section states, whatever the
defaults below say. A deep run's prompt also has a `DEEP RUN`
section; follow it with "Deep run" below.

- **The whole app (default).** Every table, collection or store, and every
  path that reads or writes them.
- **A section.** A named area (a module, a subsystem, a set of tables): its
  stores and every path through them, touched or not.
- **The changes.** Your own changes for the current task, or explicit commits,
  established and resolved as for Deslop: the stores and paths they create or
  change.

If the scope is ambiguous, ask which section or changes.

## Map the data first

Read the engineering approach's rules on query counts and realistic tests, and
these sections of the sanity checks guide
(`.agents/skills/genesis-project/references/sanity-checks.md`): "Never do
these", "Data: one owner per table", "Data: one source for each fact", "Data:
loading a dataset", "Data: each read asks for the rows it uses", "Data: saves,
batches and background work" and "Inputs and access". They describe what good
looks like; this pass applies them across the whole scope and fixes what they
find.

Then list, for the scope: each table, collection or store with its one owner
(`genesis/subsystems.md` records data ownership), who reads and writes it, its
constraints and its indexes; and each list, batch, write and background path
with the filters, sorts and joins it runs. A query, a constraint or an index
can only be judged against the data it serves.

## Measure before changing

Seed realistic sizes in a test database: hundreds of rows in each list, long
histories per person, and more rows than any cap. Never use a development or
production database. Count each path's queries or storage calls at a few rows
and at the realistic size, and keep the statements captured. A handful of rows
hides per-row work, and these counts are the figures the report compares.

## Apply the data contract

1. **Counts follow the rows read.** Fix each path whose count grows with the
   rows or with a person's history, as "Data: loading a dataset" describes:
   related rows in one batch per related table, and no lookup, single-record
   read or access check inside a loop.
2. **The query narrows.** Move each filter, sort, limit, existence check and
   count that code applies to returned rows into the query, as "Data: each read
   asks for the rows it uses" describes; a list that can grow is paged, and a
   capped read is never used as if complete.
3. **Every constraint enforced, and each one tried.** Every rule the data must
   keep (required, unique, unique within an owner, a reference to another row,
   an allowed range or set) is enforced by the store where it can express it,
   and by the data's owner otherwise. A test sends one value that breaks each
   and sees it refused, with a message the person can act on. Before adding a
   constraint, count the existing rows that break it; never delete or rewrite
   them to make it fit: ask the person what the data should say.
4. **Safe migrations.** Each change is a new migration; one that has run
   anywhere is never edited. Prefer additive steps: add, backfill in bounded
   chunks, then constrain or switch over, and remove the old shape in a later
   change. Know how long each step holds its locks at the real size, and use
   the database's online forms for large tables. A step that cannot be undone,
   or that may lose data, needs the person's agreement first. Run the migration
   on a copy at realistic size, and keep replaying the full history from empty
   as its own check.
5. **Indexes for the filters the app really runs.** From the captured
   statements, list each filter, sort and join, and give each one an index that
   serves it, its columns in the order the query uses them; index the columns
   that reference other rows when the app filters or joins by them. Read the
   query plan to see each index used. Add no speculative index: each one slows
   every write and takes space. Remove an index only when you can show nothing
   uses it.
6. **Tests at realistic sizes.** Each list, batch and write path keeps a test
   comparing its count at a few rows and at a realistic number, never a fixed
   ceiling tuned until it passes; each constraint keeps the test that trips it;
   each owner keeps a test that another owner's rows stay unseen and unchanged.

## Boundaries

- The pass changes how data is read, written, constrained and indexed, never
  what it means: no product rule change, no dropped column or row, and no data
  rewritten without the person's agreement. A missing feature is a follow-up
  finding, left unchanged.
- Tests and measurements use test databases the run creates and drops; never a
  development or production database or its configuration.
- The selected Stack's data pass guidance names its owner layer, its query
  counter, its migration mechanics and what differs between databases; follow
  it.
- **Fix at the owner.** When the framework or a library blocks a correct
  query, report the exact change it needs instead of working around it in the
  app.
- Do not edit `.genesis/`, Git metadata, dependency directories, generated
  build output, retained migration history (add new migrations instead), or
  external resources.

Leave the pass as ordinary uncommitted work for review and a later normal
commit. Never amend or rewrite selected commits. Summarize the resolved scope,
the data map, each path's counts before and after at both sizes, the
constraints added with the test that trips each, the migrations with their
lock and time notes, the indexes with the query each serves and the plan that
uses it, the tests added, files changed, checks actually run, and follow-up
findings left unchanged.

When the prompt ends with a `PASS RECORD` step, take it once the pass has
finished: the Genesis `passes done data-pass` operation records it in `genesis/passes.json`,
an uncommitted change that lands in the pass's own commit. Genesis adds that
step only to the pass's own runs, whose requests it writes itself, so a data
pass of a section, commits or your own changes is never recorded as the pass;
neither is a pass that stopped early, was abandoned or still has failing
checks.

## Deep run

When the prompt has a `DEEP RUN` section, follow it: it says how the checklist,
evidence, chunks, commits and report work for every pass. This pass adds to the
checklist:

- every store or table, every query path with its counts at a few rows and at
  a realistic size, and every migration, constraint and index;
- the cross-subsystem item: a store read or written by more than one owner,
  and the same query written in several places.
