---
name: genesis-quality-pass
description: Make software hold up in real use through an explicitly requested quality pass over the whole app, a named section, or the agent's own changes, covering loading, empty and error states, nothing jumping, edge cases, every refusal explained to the person, and accessibility basics, verified by actually using it. Use when asked for a quality pass, polish, robustness, or to check every state and edge case.
---

# Genesis quality pass

Make the software behave well in the situations people really meet, and prove
it by using it. A quality pass is explicit: never run it merely because
implementation finished.

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

A quality pass request may arrive as a complete Genesis-generated prompt or as
a direct request such as `Quality pass` or `Quality pass the Orders section`.

If the current task already contains `GENESIS CONTEXT` whose task is
`quality-pass`, continue with it directly. Do not generate another prompt.

Otherwise, before resolving scope, run the Genesis `prompt --task quality-pass`
operation once using the invocation rule above. For a bare `Quality pass`
request, pass no request argument. When the user names a section, commits or
your own changes, pass that exact request as one safely quoted argument. Treat
the printed prompt as the instructions for this same turn; do not dispatch it
to another agent and do not generate it again. This step composes the selected
Stack's quality pass guidance and any project customization with the portable
contract below.

When the user asks for a deep run of this pass, pass its Deep request,
`Quality pass the whole app deeply.`, exactly;
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

- **The whole app (default).** Every screen, command and flow a person uses.
- **A section.** A named area (a module, a route subtree, a set of screens or
  commands): every screen and flow in it, touched or not.
- **The changes.** Your own changes for the current task, or explicit commits,
  established and resolved as for Deslop: the screens and flows they create or
  change.

If the scope is ambiguous, ask which section or changes.

## List the states before changing anything

For each screen, command or flow in scope, write down what it shows or does,
where its data comes from, and each state it can be in: loading, empty, partial,
full, failed, refused, slow or offline, and first use. Mark which states exist
and which are missing or wrong. A missing state stays invisible in a demonstration
with good data and is often the first thing a real person meets.

## Apply the quality contract

The sanity checks guide
(`.agents/skills/genesis-project/references/sanity-checks.md`) sections
"Screens in use", "The wait a person sees", "Inputs and access" and "Tests that
prove behavior" describe what good looks like. This pass works through the
whole scope with them and fixes what it finds:

- **Loading.** A wait shows a stable placeholder in the shape of what arrives,
  never a blank screen, so nothing jumps when the data does. An action shows
  that it is working and cannot be sent twice. Long work in a command-line
  program reports progress.
- **Empty.** An empty view says what would be there and offers the next useful
  action. A first-use empty state differs from "nothing matches this filter",
  which offers clearing the filter.
- **Errors.** A failure says what happened, in the person's words, and what
  they can do; it offers a retry where retrying can help, keeps what the person
  typed, appears where the failure happened (beside the field, in the panel
  that failed) and never covers the next action. A failure is never silent and
  never a raw code or stack trace.
- **Nothing jumps.** Layout keeps its place through loading, arriving data,
  feedback and errors, and feedback never covers the control the person reaches
  for next.
- **Edge cases.** Try the ones that apply: very long and very short text,
  missing optional values, zero, one and many items, large numbers, dates near
  midnight and in another time zone, duplicates, a double click or double
  submit, refresh or back in the middle of an action, two tabs, an expired
  session, a slow or dropped connection. Fix what breaks, or report it.
- **Every refusal explained.** When the software refuses (invalid input, a
  missing permission, a limit, a conflict, missing setup), the person sees what
  was refused, why, and what they can do about it, in words they understand.
  The server keeps the refusal's status, code and message to the client, and
  the client shows that message rather than a generic failure. A refusal stays
  a refusal: this pass explains it and never loosens it.
- **Accessibility basics.** Every control can be reached and used from the
  keyboard in a sensible order, with visible focus; every field and icon-only
  control has a name; status, selection and errors are never shown by colour
  alone; contrast is at least WCAG AA in every scheme; text still works at 200%
  zoom; motion stops when reduced motion is asked for; touch targets are about
  48 pixels; meaningful images have text alternatives and decorative ones are
  hidden. A command-line program uses meaningful exit codes, writes errors to
  standard error, has `--help` and honours `NO_COLOR`; a game offers
  remappable controls and subtitles for its speech where it has them.

## Use it

Verification is using the software as a person does, through its real
interface (a browser, a terminal, a device), not reading its code:

- use it as a new person (first run, no data) and as a returning one with
  realistic data (hundreds of items, long names, a long history);
- walk each flow in scope to its end, then force each state: slow the network
  or the server, go offline, make the server fail, empty the list, enter wrong
  input, act without permission;
- go through each flow once with the keyboard only;
- take screenshots of each state you changed at phone and desktop widths (390
  and 1280 pixels on the web), in light and dark, and look at every one. Keep
  them out of the repository's tracked files, delete temporary test files, and
  close every browser and process you start;
- lock in each fix with a test at the cheapest level that proves it, as the
  sanity checks guide's "Tests: time" describes, and run the focused tests of
  the affected areas and the checks the Stack guidance names.

## Boundaries

- The pass changes behavior only to handle a state or an edge case and to
  explain a refusal. It adds no feature and changes no permission, product rule
  or stored data; a larger gap is a follow-up finding, left unchanged.
- The selected Stack's quality pass guidance names where states, errors and
  refusals live in its technology; follow it.
- **Fix at the owner.** When the framework itself blocks a result, report the
  exact framework change instead of working around it in the app.
- You may edit source, styles, messages and tests in scope; every existing
  behavior assertion stays. Do not edit `.genesis/`, Git metadata, dependency
  directories, generated build output, retained migration history, or external
  resources.

Leave the pass as ordinary uncommitted work for review and a later normal
commit. Never amend or rewrite selected commits. Summarize the resolved scope,
the states listed for each screen or flow with what was missing and what
changed, the edge cases tried and their results, the refusals reworded, the
accessibility checks, the screenshots and tests actually taken and run (with
their paths), files changed, and follow-up findings left unchanged.

When the prompt ends with a `PASS RECORD` step, take it once the pass has
finished: the Genesis `passes done quality-pass` operation records it in `genesis/passes.json`,
an uncommitted change that lands in the pass's own commit. Genesis adds that
step only to the pass's own runs, whose requests it writes itself, so a quality
pass of a section, commits or your own changes is never recorded as the pass;
neither is a pass that stopped early, was abandoned or still has failing
checks.

## Deep run

When the prompt has a `DEEP RUN` section, follow it: it says how the checklist,
evidence, chunks, commits and report work for every pass. This pass adds to the
checklist:

- every screen and flow, with each of its states (loading, empty, partial,
  failed, refused, offline, first use) as an item of its own, and every
  refusal message;
- the cross-subsystem item: the same state or refusal handled or worded
  differently in different places.
