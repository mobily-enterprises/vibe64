# Sanity checks

The Engineering baseline states these checks in short form. This guide gives
each one's examples and outer limits. Read the section that applies before
reporting data access, tests, a refactor, a screen or a release done.

## How to use this guide

- Each section gives what good looks like, the check you make and judge, real
  failures it catches, and an outer limit.
- Measure, then judge. Prefer counts (queries, requests, processes, DOM nodes)
  to clock times, which change with the machine.
- An outer limit marks what is clearly broken, never a target: code just under
  one is not thereby fine, and code is never bent to reach a number.
- Apply each check with the tools your Stack pieces name under "Sanity checks
  with <stack>": the query counter, the parallel runner, the strict mode.
- Examples come from real projects; one that depends on a stack names it.

## Never do these

Each one silently loses data, protection or a whole run.

- Cap a read its callers treat as complete: they act on a silent first page.
- Narrow a broad or capped read in code: a broad one reads what it discards, a
  capped one loses every match past the cap.
- Drop a behavior, rule or access decision silently in a restructure.
- Declare a constraint or protection that nothing enforces.
- Let a client's ids or a missing value decide access.
- Store a missing value as a real one: a blank later reads as fact.
- Run tests against a development or production database or configuration.
- Edit a migration that has run anywhere: databases diverge.
- Let the first visitor to a new deployment own it.
- Run production with development settings, fallbacks, hosts or secrets.
- Send real email, messages or payments from a copy the platform's side-effects
  setting has not made live: honour that setting, and simulate them where it is
  unset or the platform has none.
- Release a test's servers, processes or timers only where a timeout skips it.
- Stop a process by name or pattern (`pkill`, `killall`, `kill $(pgrep ...)`)
  instead of the pid you started or the project's stop command: the match also
  stops other projects' servers on the same machine.
- Edit a generated file instead of its source: the next generation erases it.
- Keep a workaround after its cause is fixed: the behavior it changed (a page
  made public) stays wrong. Mark each with a comment naming its cause; once
  that is fixed, remove it, restore the intended behavior and check it.

## Data: one owner per table

**Good:** every table has one owner, a repository or resource module, and every
query of the table goes through it, so the table's scoping, validation and
locking live in one place. A request works on the rows it concerns; work over a
whole population runs as a job in bounded chunks.

**Check:** judge the structure, not only a change. Run the project's lint and
checks and read what they report. For each table, name its owner and search for
queries that reach the table from anywhere else: routes, services, another
table's owner, raw SQL. Read each request path for work that covers every user,
row or tenant (a recount, a backfill, a sweep) instead of the request's own
rows. Each read and write path needs a test that seeds a second owner and sees
its rows stay unseen and unchanged, write hooks and side effects included.

**Examples:**
- An application had no repository layer: each route queried the tables it
  needed with its own copy of the tenant filter, and every change looked fine
  in a review of that change alone.

**Outer limit:** an application with no owner layer, a table written from
several places, or a request whose work grows with the whole population.

## Data: one source for each fact

**Good:** each fact (an item's name, a rule, a template's structure) lives in
one known place, and everything else refers to it. Copies are made on purpose:
you know why each exists and what keeps it in step with its source, or why it
may drift. Accidental copies drift: a fix to the source never reaches them, and
nobody can tell which is right. Where it fits, prefer:
- shared content (a catalogue, a library of templates, presets) kept once and
  referenced by a stable id; a person's own version keeps what they changed and
  the id it came from;
- a variant as a reference plus what differs, not a copy of the whole;
- one current format for each kind of data: convert the old data and remove
  the old format and its converters, keeping only an upgrade path for old data
  out of reach (files people saved);
- where the software is translated, its own texts kept as keys and looked up
  when shown: stored text cannot follow the language, and matching it back to
  a key breaks once someone edits it. Text a person wrote is kept as written;
- a change sent to a tool, an API or an AI model rather than the whole
  document: each has size limits, the model's output length included, and a
  whole document stops fitting as it grows while a change stays small.

Deliberate copies are often right: a cache, a baked asset, a read model, a
snapshot that must not change (an issued invoice, a saved game). In a
database, a JSON column suits data read and written as one unit, while data
queried, shared or referenced elsewhere usually does better in its own rows.
When breaking one of these is clearly better, say why in the code or the
Program.

**Check:** before reporting a data feature done, list what it stores, where
each fact lives, what refers to what, each copy with what keeps it in step,
and the largest real size of each document. Look for one value or structure
stored twice. Send the largest real document, library and generated items
included, through the real path (the tool, the API, the loader).

**Examples:**
- Choosing a template from a library copied the whole template into the
  person's data, and a lighter variant copied every part to change one value:
  one template held 28 parts, 16 of them distinct. Its items, referenced by
  id, took names and translations live from their own library and needed no
  copy.
- The same library was kept in two formats, with converters for the old one
  beside them.
- The software's own names were stored as English and translated by matching
  that text against keys, which broke when a name was edited.
- An AI tool took a whole document as its arguments and refused the larger
  library documents. Every test passed: the library was generated by code and
  never went through the tool.

**Outer limit:** copies of one fact that disagree with nothing to say which is
right, two formats of one kind of data both still written, or a real document
the software's own path refuses.

## Data: loading a dataset

**Good:** a list, page or report takes about as many queries for 10 rows as
for 200. Related rows come in one batch per related table, and each visibility
check is part of the query, bounded by the rows read.

**Check:** seed hundreds of rows and long per-person histories. Count the
queries at a small and a realistic size and look at what grows. A count that
grows with the rows means something runs per row: a single-record read, lookup
or access check inside a loop. A count that grows with a person's history means
an access check sized by history. Read the captured SQL for:
- a schema-metadata read on a request path;
- a row read back just after it was written;
- the same table and id read twice in one request;
- one statement repeated with one id at a time;
- access-policy SQL that runs to kilobytes (print it per role and read its
  plan).

Compare a response's size with what the screen shows of it.

**Examples:**
- A page of 100 incidents read each incident's revision, pinned module and
  readers one at a time: 1,801 queries and 5–7 s. Batched per table it took
  181, still about one a row.
- A notice policy checked every source a reader had ever been notified about:
  26–33 s and 13,176 queries per 100 notices.
- Schema metadata joined across a database server holding hundreds of
  databases cost 25–63 s per call (MySQL `information_schema`).

**Outer limit:** a list that makes hundreds of queries, takes over a second on
a quiet database, runs the same access check more than a few times per
request, or returns megabytes for one screen is broken. Find the loop first.

## Data: each read asks for the rows it uses

**Good:** a read asks the data store for exactly the rows the code uses.
Filtering, sorting, limits, existence checks and counts go in the query. A
picker, lookup or autocomplete asks the server for the narrowed set, searching
on the server, instead of loading a list and filtering it in the browser.

**Check:** search for reads whose results are then filtered, found, sliced or
tested in code (`filter`, `find`, `some`, `slice`, a loop that skips rows, a
length taken to count rows or test for one), and for capped reads (the latest
N, a default page, a fixed limit) used as if complete. Move each into the
query, or the code states why the store cannot express it. A capped read
narrowed afterwards also loses every match past the cap, so it is a
correctness bug, not only a cost: seed more rows than the cap, with the oldest
one matching, and see it found.

**Examples:**
- Pickers loaded the latest 200 records of every kind and kept one kind in
  code: slow, and a matching record older than the newest 200 never appeared.

**Outer limit:** a capped read narrowed in code is broken at any size.

## Data: saves, batches and background work

**Good:** a batch writes each table in a few statements inside the owner's
transaction, not one full create per row. Work nobody waits for runs as a
scheduled or queued job in bounded chunks: it loops over units of work (a
tenant, a user), one transaction each, never one around the whole run and
never one per row. A read request takes no lock and writes nothing. Every path
takes its locks in one order, parents before children, so two transactions
never wait on each other. Two writers on the same records never produce a
server error.

**Check:** count a batch's statements at 10 items and at 500. Look for due work
run inside whichever request comes first, and one long transaction around it.
Find any lock or write a read path takes for one-time setup: read first, lock
only on the rare unset path. Compare the order in which each path locks rows.
Run two writers on the same records; a retried transaction must be safe to
repeat, so HTTP calls, email and uploads go before or after it, or into an
outbox row written inside it.

**Examples:**
- An import created each row through the full single-record create path, with
  its lookups and read-back, one row at a time.
- Overdue work ran inside the first user request after a quiet period, so that
  request's time depended on how long nobody had used the app.
- Concurrent saves surfaced database deadlocks as 500s.

**Outer limit:** thousands of queries or tens of seconds for one action, or a
request whose time depends on how long since anyone used the app.

## Work that repeats or lingers

**Good:** work whose answer does not change between calls runs once and is
reused. Everything a feature starts has a named owner that stops it. Each poll
stands in for a named event, and retries cover network errors, 5xx and 429
only. Logs say each thing once.

**Check:** time a call that should do nothing. List the processes alive after
the app has been idle. After a run, read the log's size and most repeated line.

**Example:** an idempotent "ensure" step rediscovered its whole configuration on
every call.

**Outer limit:** a no-op check over a second, an idle page requesting every
second, or a log growing by hundreds of MB per run.

## The wait a person sees

**Good:** the time from click to result is known, cold and warm, and each part
of it has a name.

**Check:** read the server's own request times while the tests run. Time the
main actions from click to result, and split the time into its parts.

**Outer limit:** an ordinary page taking seconds on a test database, or tens of
seconds with no feedback.

## Refactors keep behavior

**Good:** a refactor, consolidation or move keeps every behavior and access
decision, or drops one only with the person's agreement.

**Check:** before changing code, list its operations, inputs and their
validation, permissions per role, states and edge cases, with the test covering
each; pin what a path answers with a test before moving it. Afterwards walk the
list again with the original tests passing and their assertions unchanged. Compare per-file test counts before and after, and name
each removal. Search for what a removed caller was the only caller of. After a
mechanical sweep, compare files changed with files expected and search for the
old form. A new mechanism replaces the one already doing the job.

**Examples:**
- Restructures dropped validation and access rules along with the tests that
  covered them, so the suite stayed green.

**Outer limit:** dozens of dropped items found at review.

## Failing tests are bugs

**Good:** a failing test is a defect with an owner, in the product or in the
test. Red CI on the main branch stops the line. A final run is one whole run on
the tree that is pushed.

**Check:** name each failure's cause; never rerun until green, skip or loosen
to finish. Compare the tested commit with the pushed one. List every skip with
its reason and the run that covers it, against the last run's count. See each
new test fail once. Diagnosis runs may stop early; a final run runs everything
and reports what did not run. Report a speed win with its absolute number.

**Examples:**
- A preparation script ended with `exit $status` instead of
  `test $status -eq 0`, so it ended the caller and the tests never ran while
  the run reported success (shell).
- A suite kept a set of "known" failures as a baseline until they hid a new
  regression.

**Outer limit:** a red test on main nobody owns, a suite that needs reruns to
look green, or dozens of skips nobody can place.

## Tests: time

**Good:** tests take the time their work needs. Files run in parallel within
the machine's test budget. Databases and fixtures are prepared once per run
from a stored schema and seed, checked by a digest of their sources, and the
full migration history is replayed once, as its own check. Builds and server
starts happen once per run. Each test proves its behavior at the cheapest
level that can: rules and calculations in a unit test; data, access and
refusals in a server or integration test; a component's content and states in
a component test. A browser test checks only what needs a real browser (a flow
across screens, navigation, layout at the standard widths, focus, the real
sign-in); a new browser check is an assertion in the existing test that already
reaches that screen, and a new browser test file is for a new flow. The app's
own delays (retry backoff, debounce, polling) run on a fake clock, never in
real time. A test's own time limit covers only its own work: what it needs
is loaded when its file loads, not inside the timed test, so a slow first load
on a busy machine cannot fail it.

**Check:** after every run, read the suite time, each phase's time
(preparation, import, sign-in, tests) and the slowest files. A wall time close
to the sum of the files' times means they ran one at a time: find why. In a
slow file, find where the time goes: repeated preparation, replayed
migrations, fixed sleeps, polling, a process per test, repeated builds,
sign-ins or page loads. Split test time into the app's request time and the
harness's before choosing a fix. Remove exact repeats across CI jobs. Each
sleep names the condition it waits for; wait for that. Compare each raised
time limit with the measured need, and check a limit exists. Assert counts,
not tight times. Before adding a test, find the cheapest level that proves the
behavior and the existing test that already pays its setup; after adding it,
report its time, how much of that is setup, and the suite's time before and
after. A test that is mostly setup around one check is in the wrong place:
move the check, then see it fail once there. A test that changes its input to
skip a wait (another error, a shorter path) stops proving the skipped path:
advance the clock instead, unless another test already proves that path.

**Examples:**
- 359 tests ran one file at a time, 163 s in all, because the test command
  forced a concurrency of one.
- Test databases were rebuilt by replaying every migration for each file.
- Time limits were raised until slow tests passed, and the slowness stayed.
- A new browser test file took 21 s for two cases checking what one card on a
  page shows. A component test proves that in milliseconds, and the page's
  existing browser test could carry the one layout assertion for nothing.
- A browser test waited out the app's two retries of a failed request in real
  time, 3 s on every run.
- A test loaded its modules inside its 20 s limit, and on a busy machine
  after a fresh install the loading alone used it up; loading them with the
  file moved about 9 s out of the test, which then took under a second.

**Outer limit:** a suite running for hours (a small app's for an hour),
preparation in minutes, or a limit ten times the measured need. A new test
whose time is mostly its own setup, for a check that a cheaper level or an
existing test could make, is not acceptable: every run, by every person and
agent, pays for it for as long as it exists.

## Tests: each owns what it uses

**Good:** each test creates and signs in as what it asserts, and each file owns
its data, system-picked ports, directories and caches. A skip caused by the
environment is a failure.

**Check:** run a file twice, beside another, reversed and shuffled, and two
suites at once; the result does not change. Run at a fake time near midnight,
in another time zone and in a clean environment. Each seed names what needs it;
volume fixtures belong to the volume tests. A disposable test database server
may relax durability; each run drops what it made.

**Examples:**
- Specs passed only after an earlier spec left a signed-in user behind.
- Two parallel runs collided on one fixed port and one shared cache directory.

**Outer limit:** a test that passes only in one order, or two identical runs
that differ.

## Tests: nothing hangs or lingers

**Good:** everything a test starts is released by teardown that also runs
after a timeout, and the process exits when its tests end. Waits wait for the
thing that matters.

**Check:** list what keeps a finished file alive. A wait that often ends at its
cap waits for the wrong thing: an idle network on a page with live connections,
or an animation that never ends.

**Outer limit:** a file that ends only when its limit kills it.

## Tests that prove behavior

**Good:** a test drives the real path, passes after a behavior-preserving
refactor and fails when the behavior breaks. Doubles answer like the real
collaborator, refusals included. Every spec is linted and listed by the quick
check.

**Check:** ask whether each test you touch pins source text or internals. An
export, option or branch only tests use goes. Name the committed test for each
user-visible feature you changed.

**Outer limit:** a feature shipped with no test that would fail without it.

## Inputs and access

**Good:** every declared constraint and protection is enforced and has one
test that trips it. Access comes from the authenticated context, is decided
before validation answers, and refuses when a scope, role or collaborator is
missing. Refusals keep their status, code and message to the client. Writes go
through the layer that applies policy, validation and audit.

**Check:** send one input that breaks each constraint (a missing required
field, a call past a rate limit, a caller without permission, another tenant's
id) and see it refused. A malformed request from someone without permission
gets a 403 and no field errors. Trace inputs that reach file paths. Ask what
production does when each optional collaborator is missing: "nothing,
silently" means it is required. Each write that bypasses the policy layer, and
each "anyway" override, names its reason. Before removing a guard, prove the
layer below enforces it.

**Examples:**
- A partial-update mode accepted an empty body and saved nothing, while the
  schema declared the fields required.
- A framework silently discarded fields the model did not allow, and the save
  reported success (Laravel without strict mode).

**Outer limit:** a request missing a required field succeeds, or a user acts in
another tenant.

## Changes others depend on

**Good:** a change to a name, default or contract fails loudly, naming its
fix, wherever the old shape remains. A fix reaches every copy of the code it
fixes. A new setup step runs in every deploy path.

**Check:** boot and check every dependent with the change. Search every copy
of fixed code, scaffold copies included. Prove a new setup step runs in the
deploy path. Search the docs for removed or renamed names. A local workaround
for a dependency's gap names the owner's fix and is marked for removal.

**Outer limit:** a project that runs differently after an update without
saying so.

## Screens in use

**Good:** a screen renders what is visible, loads what its first view needs,
and feedback never covers the next action. Each inner page opens directly and
by link, and Up and Back stay inside the app. Screens use the design system's
tokens and components and show names, not ids.

**Check:**
- Count DOM nodes with realistic data, and the requests one action causes
  across open screens. Follow a big first-screen chunk to its import.
- After each action, look at what its feedback covers, use the next action and
  press Escape. At phone width, tap each control after the previous field
  blurs.
- Scroll every screen to its end at about 390 px, 1,000 px and desktop width,
  in light and dark. With a cold cache, look for numbers where names belong.
- Make each endpoint the first request after a restart; go offline and back;
  sign out in another tab and return; close the tab during a long action.
- In a production build, change a screen's inputs and see what it shows change,
  with no render loops.

**Examples:**
- A success message appeared over the Save button and took the next tap.
- A list rendered every row of a large data set into the page.

**Outer limit:** tens of thousands of DOM nodes, typing lag, or megabytes or
hundreds of requests on a first screen.

## State and workflow

**Good:** the same state twice gives the same result. Each fact has one
resolver. Each status names what clears it, and each gate has a case that must
fail it. Writes are conditional on the version read. A delete removes what it
created elsewhere. Readiness is checked directly.

**Check:** find every place that resolves the same fact. Check that what a
delete created outside its table is gone. When a rule's result breaks another
stated rule, stop and ask, and keep the failing case.

**Outer limit:** a step that fails because the one before said ready.

## Production settings

**Good:** production fails closed. Development modes, `localhost`, fixed ports
and fixed secrets exist only in tests. Security headers are sent, email
ownership is confirmed where sign-up needs it, and tokens and CI jobs have the
least permission they need.

**Check:** read the running production server's mode and flags and a
production build's response headers. Sign up without confirming email and try
to sign in. Run the ecosystem's dependency audit; fix it at the dependency
ranges. Search fixtures for real names, hosts and emails. Name what ends each
token.

**Outer limit:** the first visitor can own the deployment, or it runs as
development.

## AI features

**Good:** the assistant can see and do no more than its user. Volatile state
sits after the stable prompt prefix, so the model's prompt cache holds.

**Check:** sign in as the least-privileged user and list what the assistant can
read and change. Read cached and uncached input tokens on two turns of one
conversation.

**Outer limit:** most input tokens uncached on a long conversation.

## How you work

- Reproduce and measure before changing anything; verify a reviewer's premise.
- Lint the touched files and confirm the lint reads them. After the gates pass,
  read the code against this guidance and check each suppression's reason.
- A reviewer can read each changed function, and the commit, in one sitting.
- Raise an instruction that slows the work or hides failures; do not follow it
  silently.
- Run the smallest check that answers the question, and do not fill a shared
  machine with full runs. Wait without polling, and read counts and failures,
  not whole logs.
- Before acting on a shared machine or tree, name the approval that allows it,
  and stay inside the approved scope.
- At the end of a task, list what is uncommitted, and save or revert it.

**Outer limit:** gates green while review finds hundreds of defects, or
functions thousands of lines long.
