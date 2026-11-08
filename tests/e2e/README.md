# Vibe64 E2E Tests

`npm run test:e2e` runs the self-contained smoke, direct-chat, and managed-preview specs. The specs
mock Studio API responses before loading the app.

`playwright.config.mjs` is JSKIT's browser-test harness, `browserTestConfig()` from
`@jskit-ai/jskit-catalog/browser-tests`. A local run tests the app's production build in `dist/`,
which it makes once and reuses while the app's sources and installed JSKIT packages are unchanged, so
the pages load bundled client code that matches the installed packages. It starts one app server per
worker through the single-server harness `tests/e2e/support/start-web-server.mjs`: worker N tests
against its own server on port `PLAYWRIGHT_PORT + N` (`PLAYWRIGHT_PORT` defaults to `4173`), so no two
tests running at once share a server, and concurrent checkouts choose different `PLAYWRIGHT_PORT`s.
Each server's output is in `test-results/browser-test-servers/worker-N.log`. With
`PLAYWRIGHT_BASE_URL`, the tests use that running target instead, one worker at a time, with the login
state its host supplies in `PLAYWRIGHT_STORAGE_STATE`; `VIBE64_LIVE_E2E=1` makes a Vibe64 server you
started on `PLAYWRIGHT_PORT` that target.

Tests run in parallel, spread across the workers one test at a time (`fullyParallel`): no test
depends on another's order or state. The worker count is `--workers` (or `-j`) when given, else
`PLAYWRIGHT_WORKERS`, else one worker for every two threads of the machine's test budget
(`V64_TEST_CONCURRENCY`, else half the CPUs), at least one, because each worker's test process,
browser and app server keep about two threads busy. A test has 60 s, an action 15 s and a navigation
30 s, and the whole run stops at the browser suite's wall-clock bound in
`tooling/test-time-budgets.json`. A trace is kept only for a failed test, with a DOM snapshot of every
action and no screencast, whose frames cost about a quarter of the suite's CPU. Every run ends with
its 10 slowest tests, then its slowest files against their time budgets.

Each server keeps its state and project folders in its own temporary directory, never the person's
own Vibe64 state. Playwright stops the servers with SIGTERM, and each directory is removed when its
server exits. JSKIT's launcher also stops them when Playwright is killed, and refuses a run whose
port already answers, so a server left by another run is never taken for this run's.

The large `base-shell.spec.ts` file covers the Studio shell and is not part of the default E2E command.
Run it explicitly with `npm run test:e2e:shell` when changing the shell behaviors it covers.

## Nightly record

`.github/workflows/nightly-browser.yml` runs the whole suite every night, and on demand with **Run
workflow** on the Actions page. It splits the suite into 12 shards that run at once on separate
GitHub runners, each with the config's workers and a server for each. It is the one browser run that does not
stop at 2 failures, because it exists to record every result.

A failed night shows as a failed `Vibe64 Nightly Browser` run. Its `playwright-report` artifact
holds the merged HTML report with traces for 14 days:

```sh
gh run list --workflow=nightly-browser.yml
gh run view RUN_ID --log-failed
gh run download RUN_ID --name playwright-report --dir playwright-report
npx playwright show-report playwright-report
```

The run needs no secrets and deploys nothing. Tests that need a local overview fixture or a composed
Colleague host skip there, as they do in any run without those.
