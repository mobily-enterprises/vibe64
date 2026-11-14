---
name: genesis-ui-pass
description: Make a project's UI exact to its selected Stack's UI guidance (for example Material 3) through a behavior-preserving UI pass over the agent's own task changes, explicitly selected commits, a named section, or the whole app. Use when asked for a UI pass, to make screens follow the design system exactly, or when a host runs its automatic UI pass after a plan.
---

# Genesis UI pass

Make the selected UI exact to the project's design rules without changing what
the product does. A UI pass is explicit: never run it merely because
implementation finished, unless the host's automatic UI pass asked for it.

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

A UI pass request may arrive as a complete Genesis-generated prompt or as a
direct request such as `UI pass` or `UI pass the Suppliers section`.

If the current task already contains `GENESIS CONTEXT` whose task is
`ui-pass`, continue with it directly. Do not generate another prompt.

Otherwise, before resolving scope, run the Genesis `prompt --task ui-pass`
operation once using the invocation rule above. For a bare `UI pass` request,
pass no request argument. When the user names commits or a section, pass that
exact request as one safely quoted argument. When the user asks for the UI pass
of the whole app, pass its own pass request, `UI pass the whole app.`, exactly;
Genesis then adds the pass's `PASS RUN` and `PASS RECORD` steps. Treat the printed
prompt as the instructions for this same turn; do not dispatch it to another
agent and do not generate it again. This step composes the selected Stack's UI
pass guidance and any project customization with the portable contract below.

When the user asks for a deep run of this pass, pass its Deep request,
`UI pass the whole app deeply.`, exactly;
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

- **The changes (default).** With no stated scope, select only your own changes
  for the current task, including preceding turns: staged, unstaged, untracked
  and already-committed task changes, identified from task and edit history and
  confirmed against the current source. Neither the dirty diff, the latest
  commit, nor a Git author proves ownership. An explicit commit, first-parent
  count, or range takes precedence, with the same meaning as for Deslop ("the
  last commit" is `HEAD` against its first parent; "the last N commits" is the
  net change across them). In scope: every screen, component and style those
  changes created or edited, and the screens that render them. If you made no
  UI changes, report that there is nothing to pass.
- **A section.** A named area (a module, a route subtree, a set of screens, or
  a shared component family): every screen in it, touched or not.
- **The whole app.** The UI pass's own pass request, `UI pass the whole app.`:
  every screen of the project's own source, the shell and navigation included,
  whoever changed it and whenever. It never includes generated output, vendored
  or copied third-party UI, or dependency directories.

If the scope is ambiguous, ask which changes or which section.

## Apply the UI pass contract

The SELECTED STACK UI PASS GUIDANCE is the design authority: read every
document it names completely before editing, and follow its method for the
resolved scope. Without Stack UI pass guidance, follow the project's own
established design system and the official documentation of its UI framework;
do not invent a new one.

- **Behavior stays as it is.** Change how the UI looks and is laid out, never
  what it does: no feature, field, action, permission, validation, data or
  copy change beyond what the design rules require. A defect, missing behavior,
  contract mismatch or test gap you notice is a follow-up finding, left
  unchanged. Rules the Stack guidance marks as must-fix (such as navigation
  rules) are fixed at every scope, never only reported.
- **Fix at the owner.** When the framework itself blocks an exact result,
  report the exact framework change instead of compensating with app CSS,
  `!important`, or a copied framework file.
- **Prove it.** Run the conformance checks the Stack guidance names on the
  scope until they pass. Take screenshots of every affected screen at 390, 768
  and 1280 pixels wide, in light and dark, through the host's managed browser
  or a temporary browser test: after the pass for the changes, and before and
  after for a section or the whole app. Look at every screenshot. Keep them out
  of the repository's tracked files and delete temporary test files. Close
  every browser you start. Run the focused tests of the affected screens.
- **Edits.** You may edit UI source, styles and tests whose markup changed;
  every behavior assertion stays. Do not edit `.genesis/`, Git metadata,
  dependency directories, generated build output, retained migration history,
  or external resources. Update an affected Program citation only when a move
  makes it stale.

Leave the pass as ordinary uncommitted work for review and a later normal
commit. Never amend or rewrite the selected commits. Summarize the resolved
scope and any commit identities, what changed, files changed, the checks and
screenshots actually taken (with their paths), and follow-up findings left
unchanged.

When the prompt ends with a `PASS RECORD` step, take it once the pass has
finished: the Genesis `passes done ui-pass` operation records it in `genesis/passes.json`,
an uncommitted change that lands in the pass's own commit. Genesis adds that
step only to the pass's own runs, whose requests it writes itself, so a UI pass
of your own changes, a section or commits is never recorded as the pass;
neither is a pass that stopped early, was abandoned or still has failing
checks.

## Deep run

When the prompt has a `DEEP RUN` section, follow it: it says how the checklist,
evidence, chunks, commits and report work for every pass. This pass adds to the
checklist:

- every screen (page, view, dialog or panel) and every shared interface
  component, each checked against the Stack's design rules, with a screenshot
  after any change;
- the cross-subsystem item: the same control, layout or pattern built or
  styled differently on different screens.
