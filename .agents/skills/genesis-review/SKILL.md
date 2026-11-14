---
name: genesis-review
description: Review the work against what the software should do through an explicitly requested review over the whole app, the changes since its last completed run, a named section or the current work, judging the tests (each changed behavior has one that would fail without it; none weakened or skipped), the gaps between intent, code and explanation, and costs that grow with the data, writing only tests and reporting everything else. Use when asked for a review, a review pass, or to check the tests and the work against the Blueprint.
---

# Genesis review

Judge the work against what the software should do, and the tests against the
work, and say plainly what was and was not verified. A review is explicit:
never run it merely because implementation finished.

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

A review request may arrive as a complete Genesis-generated prompt or as a
direct request such as `Review` or `Review the Orders section`.

If the current task already contains `GENESIS CONTEXT` whose task is `review`,
continue with it directly. Do not generate another prompt.

Otherwise, before resolving scope, run the Genesis `prompt --task review`
operation once using the invocation rule above. For a bare `Review` request,
pass no request argument. When the user names a section, commits or the
current work, pass that exact request as one safely quoted argument. Treat the
printed prompt as the instructions for this same turn; do not dispatch it to
another agent and do not generate it again.

When the user asks for a deep run of this pass, pass its Deep request,
`Review the whole app deeply.`, exactly;
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

- **The work (default).** The relationship between the Blueprint, the code, the
  Program and the tests as they stand now.
- **The whole app.** Every behavior the project's own source exposes and the
  tests that prove it.
- **A section or the changes.** A named area, explicit commits, or the current
  task's changes: the behavior they create or change and its tests.

If the scope is ambiguous, ask which section or changes.

## Boundaries

- The prompt says what a review judges. It edits only tests: it adds or updates
  the tests changed behavior lacks and changes no product code, Blueprint,
  Program, Stack or other file. Every other finding is reported with the
  smallest sensible correction, left unchanged.
- Run the tests relevant to the scope; report what actually ran and what was not
  verified, and never report an unrun check as passing.

Leave the review as ordinary uncommitted work for a later normal commit. Never
amend or rewrite selected commits.

When the prompt ends with a `PASS RECORD` step, take it once the review has
finished: the Genesis `passes done review` operation records it in `genesis/passes-added.json`,
an uncommitted change that lands in the review's own commit. Genesis adds that
step only to the pass's own runs, whose requests it writes itself, so a review
of a section, commits, a base or the current work is never recorded as the
pass; neither is a review that stopped early, was abandoned or still has
failing checks.

## Deep run

When the prompt has a `DEEP RUN` section, follow it: it says how the checklist,
evidence, chunks, commits and report work for every pass. This pass adds to the
checklist:

- every behavior the source exposes (operation, screen, command or job), each
  with the test that would fail without it, or the missing test written or
  reported;
- every test file: whether it runs in the whole suite, what it proves, what it
  costs, and any test weakened, skipped or loosened;
- every list, batch and write path, with its query or call counts at a few rows
  and at a realistic number;
- the Blueprint, Program and `genesis/subsystems.md` entries against the code;
- the cross-subsystem item: the same behavior tested in different ways or not
  at all, a table with more than one owner, and work over a whole population
  done inside a request.

Review's limits hold in a deep run: it writes only tests, and every other
finding is reported and left unchanged.
