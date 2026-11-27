# How this repository's tests run

`AGENTS.md` → **Test Execution Safety** holds the rules agents follow. This
page explains the machinery behind them.

## Concurrency

Test suites run in parallel by default, bounded by the machine's test budget,
JSKIT's `testConcurrency()` from `@jskit-ai/jskit-catalog/test-budget`:
`V64_TEST_CONCURRENCY` when set to a whole number (a test runner sharing a
machine sets it for each of its slots), otherwise half the CPUs, at least one.
`npm run test:full` and `npm run test:client` run that many test files at
once. Playwright runs on JSKIT's browser-test harness, `browserTestConfig()`
from `@jskit-ai/jskit-catalog/browser-tests`, with one worker and app server
for every two of those threads, at least one, as each worker also runs a
browser.

## Time budgets

Every test file, and each suite's files together, have a coarse time budget in
`tooling/test-time-budgets.json`: about five times the measured time, with a
floor for small files, and each suite's run a wall-clock bound of about three
times its parallel run on a busy test host. Each suite prints its ten slowest
files against their budgets.

## Hangs

A hang fails fast instead of holding a run. In `npm run test:full`, each test
has the server suite's `testMs` as a hard deadline and fails by name past it;
its file then ends with its other tests, even when the hung test left a server
or timer open, and its whole report still reaches the runner: a file whose
report ends before its summary fails the run instead of losing its last tests
silently. The whole run stops at its wall-clock bound, and each CI job has a
`timeout-minutes` above the bounds of the suites it runs. A test that waits for
a hold, a child or an event also stops waiting when the work it waits on has
already ended.

## CI

CI runs every check of `npm run verify` in parallel jobs, the server suite in
shards: `npm run test:full -- --shard=I/N` runs every Nth server test file from
the Ith (Node's `--test-shard`), so the N shards together run every file once.

## What every test process loads

- `tooling/test-host-path-guard.mjs`, in every test process,
  `npm run test:full` included, which runs with `APP_ENV=test`, as `jskit test`
  gives it, whatever the shell says.
- `tooling/test-skip-disk-flush.mjs`, in every server test process and each
  Node child it starts: a durable write's flush (fsync, fdatasync) still checks
  its descriptor but no longer waits for the disk. Nothing a test writes has to
  survive a power cut, and on a shared test host those waits were most of a
  session test's time. A test that proves a write durable still sees every
  flush call, in order (`tests/server/durableWriteTrace.js`).

## Tests that start Playwright

A test that starts Playwright, or a wrapper or fixture that runs it, gives the
child `playwrightChildEnvironment(own)` from
`tests/server/playwrightChildEnvironment.js`, never `{ ...process.env, ... }`.
A test host's lane or an outer suite exports Playwright and JSKIT browser-test
settings, such as `PLAYWRIGHT_PORT` or `PLAYWRIGHT_WORKER_TARGETS`, which JSKIT's
harness reads as the child's own. The helper drops every `PLAYWRIGHT_` and
`JSKIT_BROWSER_` name the test process has except `PLAYWRIGHT_BROWSERS_PATH`,
then sets the child's own on top.
