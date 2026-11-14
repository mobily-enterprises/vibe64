---
name: genesis-speed-pass
description: Make software and its tests take the time their work needs through an explicitly requested speed pass over the whole app, a named section, or the agent's own changes, covering test speed (the whole suite, its preparation and each file), client speed (first load, navigation, requests and the main thread) and server speed (latency at realistic sizes, startup, hot paths and work that runs without use), each wait measured before and after, its cause fixed, and nothing weakened to get there. Use when asked for a speed pass, when tests, pages, saves, commands or startup are slow, or to find where the time goes.
---

# Genesis speed pass

Make the software, and the tests that prove it, take the time their work
needs, and prove each gain by measuring the same wait before and after. A
speed pass is explicit: never run it merely because implementation finished.

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

A speed pass request may arrive as a complete Genesis-generated prompt or as a
direct request such as `Speed pass` or `Speed pass the Orders section`.

If the current task already contains `GENESIS CONTEXT` whose task is
`speed-pass`, continue with it directly. Do not generate another prompt.

Otherwise, before resolving scope, run the Genesis `prompt --task speed-pass`
operation once using the invocation rule above. For a bare `Speed pass`
request, pass no request argument. When the user names a section, commits or
your own changes, pass that exact request as one safely quoted argument. Treat
the printed prompt as the instructions for this same turn; do not dispatch it
to another agent and do not generate it again. This step composes the selected
Stack's speed pass guidance and any project customization with the portable
contract below.

When the user asks for a deep run of this pass, pass its Deep request,
`Speed pass the whole app deeply.`, exactly;
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

- **The whole app (default).** The test suite and its preparation, every
  screen, view or command a person opens and the main actions in it, and
  every route, job, loop or process the software runs.
- **A section.** A named area (a module, a route subtree, a set of screens or
  commands, a test folder): its tests, its screens and its server paths,
  touched or not.
- **The changes.** Your own changes for the current task, or explicit commits,
  established and resolved as for Deslop: the tests, screens and paths they
  create or change, and what they made slower.

If the scope is ambiguous, ask which section or changes.

## Measure first

Read the engineering approach and these sections of the sanity checks guide
(`.agents/skills/genesis-project/references/sanity-checks.md`): "How to use
this guide", "Work that repeats or lingers", "The wait a person sees", "Tests:
time", "Tests: each owns what it uses", "Tests: nothing hangs or lingers",
"Screens in use" and "Data: loading a dataset". They describe what good looks
like; this pass measures the whole scope against them and fixes what they
find.

Then list, for the scope, where people and developers wait: the whole test
suite and each of its phases, the first screen and each navigation, the main
actions from click or key press to result, the main routes, commands and jobs,
startup, and any work that runs while nobody asks for anything. A guess about
where time goes is usually wrong, and a fix aimed at the wrong place costs
complexity for nothing, so measure each wait before changing anything:

- **Measure what people meet.** Use a realistic build (the production build,
  not a development server), realistic data sizes (hundreds of rows in each
  list, long histories, large files) and, where it matters, a cold start as
  well as a warm one. A development server, an empty database or a warm cache
  hides most of what a person waits for.
- **Record how each number was taken**: the machine and its load, the build,
  the data size, cold or warm, so the measurement after can be taken the same
  way. Take each one more than once, and compare like with like: the same
  machine, load and data before and after.
- **Prefer counts where they answer the question.** Requests, queries, bytes,
  processes, renders and preparations per run change less with the machine
  than clock times do. Use a clock for what only a clock shows, and split each
  time into its parts (waiting, network, database, computing, rendering)
  before choosing a fix.

The areas below are advice with their reasons. Apply the ones that fit the
software: a library has no screens, a command-line program has no first page
load but has a start-up time, and a game measures frame times and level loads
more than requests. Say which areas do not apply, and why.

## Test speed

Every person and agent pays for a slow suite on every run, and a slow suite
gets run less, so defects land later.

Measure:

- the whole suite's wall time, and each phase: preparation (databases,
  fixtures, builds, servers), loading code, signing in, and the tests;
- each file's time, and the slowest files and tests;
- whether files ran together: a wall time close to the sum of the files' times
  means they ran one after another. Find why: a forced concurrency of one,
  files that collide on a shared resource, or files marked to run alone
  without a reason;
- in each slow file, where its time goes: preparation repeated per file or
  per test, a migration history replayed, fixed sleeps, polling, a server,
  browser or build started per test, a sign-in per test, the software's own
  retries and debounces waited out in real time, or a check made at an
  expensive level (a browser) that a cheaper one (a unit or component test)
  proves as well.

Fix the cause, when possible in the shared harness so every file gains:

- **Prepare once per run.** Build databases, fixtures, builds and servers once
  per run, from a stored schema and seed checked by a digest of their sources,
  and restore or reuse them from there; replay the full migration history
  once, as its own check. Something every file only reads (a built app, a
  generated project, a seeded snapshot) can be prepared once and shared
  read-only, while a file that writes into it makes its own copy.
- **Run files in parallel within the machine's test budget.** Isolate what
  files would share (ports the system picks, temporary directories, a database
  or schema per file, their own caches) rather than running them one at a
  time. A file that truly holds a resource of the whole machine runs alone and
  says why. Stay within the budget: an overloaded machine makes every test
  slower and some of them flaky.
- **Wait for events, not time.** Each sleep becomes a wait for the condition it
  stood for. The software's own delays (retry backoff, debounce, polling) run
  on a fake clock where the test runner allows it. A wait that often ends at
  its cap is waiting for the wrong thing.
- **Prove each behavior at the cheapest level that can.** Move a check that
  needs no real browser into a unit or component test, and add a new browser
  assertion to the test that already reaches that screen rather than a new
  file that signs in again.
- **Load what a test needs with its file**, not inside its timed body, so its
  time limit covers only its own work.

Never raise a time limit, add retries, or shrink realistic data or coverage to
get faster: a raised limit hides the slowness, a retry hides a race, smaller
data hides work done per row, and a dropped test or assertion stops proving
behavior. A test that changes its input to skip a wait stops proving the
skipped path; advance a fake clock instead. A limit far above the measured
need is a finding too, since it lets the next slowdown pass unseen.

Prove it with the whole suite's wall time before and after, on the same
machine under the same load, with each phase and the slowest files, and the
same tests and assertions passing. A faster suite that proves less is not
faster.

## Client speed

People wait for the first screen, for each navigation, for each action to show
its result, and for typing, scrolling or a frame that lags.

Measure on a production build, with a cold cache and a warm one, realistic
data and, where possible, the slower network and device the people who use it
have:

- what the first screen loads before it shows: scripts, styles, fonts and
  images, their sizes compressed and not, the largest chunks and what pulls
  each one in;
- the network waterfall: requests made one after another that could run
  together, and requests that wait for code that could have started them
  sooner;
- requests per screen and per action: the same request twice, a request per
  item in a list, polling, and responses much larger than what the screen
  shows;
- the main thread: long tasks, re-rendering on each keystroke or tick, work
  for content nobody can see (a list rendering every row), and for a game or
  animation, the time per frame, its worst frames and what each spends it on.

Fix the causes:

- **Load what the screen needs.** Split code a screen does not need into
  chunks loaded with the screens that do, so a library one screen uses does
  not load on every screen, and keep the first screen's code to what every
  screen needs.
- **Batch requests, and drop duplicates.** Related records in one request
  instead of one per item; one shared read for the same data, however many
  components show it; independent requests started together.
- **Drop needless polling.** A poll stands in for an event: listen for the
  event where the software has one (a push, a socket message, the action that
  changed the data). A poll that has to stay runs only while its result is
  visible, as rarely as its purpose allows.
- **Render what is visible.** Page or virtualize long lists, compute derived
  values once per change rather than once per render, and move or split work
  that blocks input.
- **Keep what does not change.** Content-hashed assets cached for long, images
  at the size they are shown, and data kept while it is fresh, with a stated
  rule for when it changes.

Prove it with the numbers before and after: what the first screen loads,
requests per screen and per action, and the main actions' time from click to
result, cold and warm.

## Server speed

Measure, on test copies at realistic data sizes:

- latency of the main routes, commands and jobs, the first after a start and
  later ones, each split into its parts: the database, outbound calls,
  computing in the process, serializing the answer and waiting;
- startup, from launch to ready to serve, and what it spends that time on;
- the hot paths of the slow ones, with a profiler where the time is computing:
  work repeated on every request whose answer does not change (reading
  configuration or files, compiling templates or schemas, discovering
  metadata, building clients or connections);
- outbound calls made one after another that could run together, or made once
  per item;
- what runs while nobody asks for anything: the processes, servers, timers and
  connections alive after the software has been idle a while, and the work
  they do.

Fix the causes:

- **Do once what does not change.** Compute it at startup, or cache it with a
  named owner and a stated rule for when it changes, instead of on every
  request.
- **Nothing runs without real use.** Start a process, server or worker when its
  first real use comes, give it an owner that stops it when it goes idle, and
  keep answers rather than idle processes.
- **Run independent work together, within a bound.** Calls that do not depend
  on each other run concurrently up to a limit, and a call per item becomes
  one batch.
- **Work nobody waits for leaves the request.** A slow side effect (sending
  email, building a report, syncing elsewhere) goes to a queue or a job, so the
  request answers once its own work is done.
- **Start-up does only what serving needs.** Defer optional setup to its first
  use, and keep maintenance out of the paths that serve people.
- **Answers hold what is used.** Page or stream large answers, and send what
  the screen shows rather than whole records.

When the time is in the database, the data pass owns the cure: query counts
that grow with the rows read, reads narrowed in code instead of in the query,
and indexes for the filters the software really runs belong to the data pass
skill (`.agents/skills/genesis-data-pass/SKILL.md`). Apply its method to that
path, with its counts at a few rows and at a realistic size, or report the
path as a data pass finding when it lies beyond the scope. This pass does not
restate those rules; it measures the whole wait, end to end, and reports it
before and after.

## Measure again, and keep it

For each wait:

1. Take the measurement before, recorded as above.
2. Fix the cause where it belongs (the shared test harness, the build's
   configuration, the owner of the repeated work, the framework), not at one
   call site, so the next test, screen or route is fast too.
3. Take the same measurement after, the same way, and report both as absolute
   numbers ("163 s to 41 s", "38 requests to 6"), never only as a ratio.
4. Keep it where a count can guard it: a test that asserts the count (requests
   per screen, queries per path, processes left after idle, preparations per
   run, what the first screen's code imports), seen to fail once without the
   fix. Assert counts rather than tight times, which change with the machine;
   a time bound, where one is needed, is a generous outer limit set from the
   measured need.
5. Run the checks the Stack guidance names, and finish with one whole run of
   the suite, timed.

## Boundaries

- **Never weaken anything to get faster.** Do not raise a time limit, add a
  retry, skip, shard away or delete a test, drop an assertion, shrink realistic
  data, loosen a check or a protection, serve stale data where fresh data is
  needed, or drop work the product needs. Each hides the cause instead of
  removing it. When the speed someone wants needs a trade (staler data, a
  smaller feature, less coverage), explain the trade and let the person
  decide.
- The pass changes how the software and its tests spend time, never what they
  do: no behavior, product rule or result changes. Every existing behavior
  assertion stays, and a test moved to a cheaper level is named with where it
  went.
- Measure on copies the run controls: test databases it creates and drops,
  local builds and local servers. Never measure against a development or
  production database, and never load a production deployment or another
  party's service.
- Share the machine fairly: stay within its test budget, never fill a shared
  machine with repeated full runs, and wait for long runs without polling.
- **Fix at the owner.** When the framework, the test runner or a library causes
  the slowness, report the exact change it needs instead of working around it
  in the app.
- **Report what it can't fix.** A slow outside service, a hosting limit or a
  product decision is reported with its numbers, what it needs and who must
  act.
- The selected Stack's speed pass guidance names its test runner and the
  machine's test budget, how its build splits client code, its request
  patterns and how to time its server; follow it.
- You may edit source, configuration, the test harness and tests in scope;
  every existing behavior assertion stays. Do not edit `.genesis/`, Git
  metadata, dependency directories, generated build output, retained
  migration history, or external resources.

Leave the pass as ordinary uncommitted work for review and a later normal
commit. Never amend or rewrite selected commits. Summarize the resolved scope,
each wait with how it was measured and its numbers before and after, each
cause found and its fix, the whole suite's wall time before and after with its
phases and slowest files, the tests guarding each fix and their failing run
without it, the paths handed to the data pass, the areas that do not apply and
why, files changed, checks actually run, and everything left unfixed with what
it needs and who must act.

When the prompt ends with a `PASS RECORD` step, take it once the pass has
finished: the Genesis `passes done speed-pass` operation records it in `genesis/passes.json`,
an uncommitted change that lands in the pass's own commit. Genesis adds that
step only to the pass's own runs, whose requests it writes itself, so a speed
pass of a section, commits or your own changes is never recorded as the pass;
neither is a pass that stopped early, was abandoned or still has failing
checks.

## Deep run

When the prompt has a `DEEP RUN` section, follow it: it says how the checklist,
evidence, chunks, commits and report work for every pass. This pass adds to the
checklist:

- every slow test file and phase of the suite, every screen's first load and
  each navigation, every main request, command and job, startup, and work that
  runs while nobody asks for anything, each measured before and after;
- the cross-subsystem item: the same work done in several places (repeated
  setup, duplicate fetches, the same computation on several paths).
