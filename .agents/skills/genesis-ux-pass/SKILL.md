---
name: genesis-ux-pass
description: Make software easy to use for what people come to do through an explicitly requested user experience pass over the whole app, a named section, or the agent's own changes, covering each main task's steps, navigation and findability, the words people read, defaults, first use, feedback and forgiving actions, verified by walking each task before and after. Use when asked for a UX pass, a user experience review that fixes what it finds, or to make the app simpler or clearer to use.
---

# Genesis user experience pass

Make the main things people do with the software short, clear and hard to get
wrong, and prove it by walking each one. A user experience pass is explicit:
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

A user experience pass request may arrive as a complete Genesis-generated
prompt or as a direct request such as `User experience pass`, `UX pass` or
`UX pass the checkout`.

If the current task already contains `GENESIS CONTEXT` whose task is
`ux-pass`, continue with it directly. Do not generate another prompt.

Otherwise, before resolving scope, run the Genesis `prompt --task ux-pass`
operation once using the invocation rule above. For a bare `User experience
pass` or `UX pass` request, pass no request argument. When the user names a
section, commits or your own changes, pass that exact request as one safely
quoted argument. Treat the printed prompt as the instructions for this same
turn; do not dispatch it to another agent and do not generate it again. This
step composes the selected Stack's user experience pass guidance and any
project customization with the portable contract below.

When the user asks for a deep run of this pass, pass its Deep request,
`User experience pass the whole app deeply.`, exactly;
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

- **The whole app (default).** Every main task a person comes to do, from
  where they start to where it is done.
- **A section.** A named area (a module, a set of screens or commands, a game
  mode): every task that runs through it, touched or not.
- **The changes.** Your own changes for the current task, or explicit commits,
  established and resolved as for Deslop: the tasks they create or change,
  each walked from its start.

If the scope is ambiguous, ask which section or changes.

## Know who it is for and what they come to do

Read the Blueprint first: who uses the software, what they come to do, and the
first useful outcome it promises. From it and from the software itself, list
the main tasks in scope: the few things people do most often or care about
most, such as placing an order, answering a message, running a build from the
command line or starting a match. For each, note who does it (a first-time
visitor, a regular, an occasional administrator), how often, and what done
looks like to them. A pass that polishes screens nobody reaches while the main
task stays long has missed its point.

The sanity checks guide
(`.agents/skills/genesis-project/references/sanity-checks.md`) sections
"Screens in use", "The wait a person sees" and "State and workflow" describe
what good looks like; read them before walking.

## Walk each task before changing anything

Walk each main task through the real interface (a browser, a terminal, a
device, the game itself), twice when possible: once as a new person with no
data and no knowledge of the code, once as a returning person with realistic
data. Start where that person starts: the address they were given, a link in an
email, the installed command, the title screen. For each walk, write down:

- each step (a screen, a field, a click, a command, a menu) and each decision
  the person must make to reach done;
- each place where they must know something the software doesn't tell them:
  an internal name, an id, where a feature hides, what to type;
- each wait and each moment where nothing says what happened;
- each dead end, each detour back to the start, and each place where a mistake
  costs work.

These notes are what the pass is measured against; keep them for the report.
Reading code shows what the software can do; only walking it shows what a
person has to do.

## Fewer steps and decisions

- **Ask only what is needed now.** A field, question or setting the task can
  do without moves later or out of the way, with a default when possible.
  Every extra field is a chance to stop, so each one earns its place.
- **Good defaults.** Pre-fill what the software knows or can reasonably guess:
  today's date, the person's own details, the last choice they made, the only
  option there is. When one choice is clearly sensible, take it and let the
  person change it, rather than asking.
- **Remember where they were.** Return a person to the place, filters and
  choices they left when possible, so coming back doesn't start over.
- **The next step is obvious.** After each step, the most likely next action is
  the most visible one, near where the person's attention already is. A
  finished task leads somewhere useful, not to a blank page.
- **Do the work for them.** When the software can compute, look up or fill in
  something (a total, an address from a postcode, a name from an id), it does,
  and the person confirms instead of typing.
- **Keep related steps together.** What belongs together happens in one place,
  instead of a trip across several screens or commands.

## Easy to find

- **Where people look.** Each main task is reachable from where its people
  start, in one or two steps when possible, and named in the main navigation,
  the command's help or the game's main menu. A frequent task is never buried
  in settings or an overflow menu.
- **Names people use.** Navigation, labels and commands use the words people
  use for things, the ones the Blueprint uses, not the code's internal names.
- **Search where lists grow.** A list that can grow past a screenful can be
  searched or filtered by what people remember about an item.
- **Every place has an address.** A page or record people share or come back
  to opens directly from its link, and going back returns them where they came
  from.
- **Beyond screens.** A command-line program lists its commands and options
  with examples in `--help`, suggests the closest command for a typo and keeps
  the common case short; a game shows its controls when they are needed and
  lets the player reach each mode from the main menu.

## Words

- **Say what happens.** A button or command says what it does to what: "Send
  invoice", not "Submit" or "OK". People decide from the label, so it carries
  the consequence.
- **One name for each thing.** The same thing has the same name everywhere:
  navigation, titles, buttons, messages, help and emails. Two names make people
  wonder whether they are two things.
- **Plain and short.** Everyday words and the person's own terms, never
  jargon, internal codes or ids; the important word comes first.
- **Say what happened and what's next.** After an action, the software says
  what changed and, when there is one, what the person can do next.
- **Translated text stays translatable.** In translated software, changed
  words go through its translation keys, not stored or hard-coded text.

## First use

- **To the first useful outcome.** A new person reaches the first outcome the
  Blueprint promises in as few steps and with as little setup as possible,
  without reading instructions when possible. Setup that can wait, waits.
- **Show by example.** Where a blank start would leave people guessing, offer
  an example, a template or sample content they can try and remove.
- **One way to learn.** What a new person learns works the same way for a
  returning one, and first-use help gets out of the way once it has done its
  job.

## Forgiving

- **Undo over confirm.** When an action can be undone (archive, move, remove
  from a list), do it at once and offer Undo, rather than asking first; people
  click through confirmations they see too often. Confirmation stays for what
  cannot be undone, and names the thing and what will be lost: "Delete the
  project Spring launch and its 40 tasks?".
- **Keep the person's work.** Typed input survives a refused save, going back
  or an expired session when possible, and leaving unsaved work asks first or
  keeps a draft.
- **A way out of every step.** Each step can be cancelled, and leaving a flow
  returns to where it began. A long task can be paused and resumed.
- **Hard to get wrong.** Offer choices instead of free text where the set is
  known, show the expected format before the person types, and accept the
  common ways of writing a value (spaces in a phone number, a date written
  several ways) when possible.

## Consistent

- **Same thing, same place.** Similar screens put their main action, their
  search and their way out in the same place, so learning one teaches the
  rest.
- **The platform's conventions.** Follow what people already know from their
  platform: links, Back and new tabs on the web; exit codes, standard input
  and `--yes` or `--dry-run` on a command line; a pause menu and a way back to
  the title screen in a game. Where the selected Stack's design guidance
  decides, it comes first.

## Walk again and prove it

- Walk each main task again exactly as before, as the new and the returning
  person, and compare: steps, decisions, things they had to know unprompted,
  waits without feedback, dead ends. The report gives each task's counts
  before and after.
- Where the project's tests can drive a flow (a browser test, a command-line
  test, a scripted playthrough), lock the changed path in at the cheapest level
  that proves it, and watch the test fail once against the old path. Run the
  focused tests of the affected areas and the checks the Stack guidance names.
- Take screenshots, terminal transcripts or recordings of each changed step,
  at phone and desktop widths on the web, and look at every one. Keep them out
  of the repository's tracked files, delete temporary test files, and close
  every browser and process you start.

## Boundaries

- **The path changes, the product doesn't.** The pass changes the steps,
  words, defaults, order and placement a task takes. It adds no feature and
  changes no permission, product rule, price, limit or stored data. A missing
  feature, a rule that makes a task long, or a choice only the person can make
  is a finding with a recommendation, left unchanged.
- **Never trade safety for a step.** Never remove a permission check, a
  validation, the confirmation of an irreversible action, or a security step
  such as a second factor to make a task shorter.
- **Other passes own their parts.** How screens look belongs to the UI pass
  and the visual identity pass; loading, empty and error states, edge cases
  and accessibility belong to the quality pass. Record what you notice there
  as findings for those passes, unless it blocks a main task.
- The selected Stack's user experience pass guidance names where navigation,
  actions, defaults and words live in its technology; follow it.
- **Fix at the owner.** When the framework itself makes a task long, report the
  exact framework change instead of working around it in the app.
- You may edit source, styles, messages and tests in scope; every existing
  behavior assertion stays, and an assertion of old wording or an old step
  changes with it. Do not edit `.genesis/`, Git metadata, dependency
  directories, generated build output, retained migration history, or external
  resources. When a task's observable steps change, keep the Blueprint, the
  Program and the project's usage documentation in step.

Leave the pass as ordinary uncommitted work for review and a later normal
commit. Never amend or rewrite selected commits. Summarize the resolved scope,
the main tasks with who does them, each task's steps and decisions before and
after, what changed and why, the tests, screenshots and transcripts actually
taken and run (with their paths), files changed, and findings left unchanged
with what they need and who must decide.

When the prompt ends with a `PASS RECORD` step, take it once the pass has
finished: the Genesis `passes done ux-pass` operation records it in `genesis/passes.json`,
an uncommitted change that lands in the pass's own commit. Genesis adds that
step only to the pass's own runs, whose requests it writes itself, so a user experience pass
of a section, commits or your own changes is never recorded as the pass;
neither is a pass that stopped early, was abandoned or still has failing
checks.

## Deep run

When the prompt has a `DEEP RUN` section, follow it: it says how the checklist,
evidence, chunks, commits and report work for every pass. This pass adds to the
checklist:

- every main task, walked as a new and as a returning person, with its steps
  and decisions counted before and after;
- the cross-subsystem item: similar tasks or screens that work differently,
  and one thing called by different names.
