# Vibe64 E2E Tests

`npm run test:e2e` runs the self-contained smoke, direct-chat, and managed-preview specs. The JSKIT Playwright config uses the managed
`PLAYWRIGHT_BASE_URL` when supplied, with one worker; otherwise it builds the app once and starts one
local app server per worker. The specs mock Studio API responses before loading the app.

Tests run in parallel, spread across the workers one test at a time (`fullyParallel`): no test
depends on another's order or state. The worker count is `--workers` (or `-j`) when given, else one
worker for every two threads of the machine's test budget (`V64_TEST_CONCURRENCY`, else half the CPUs),
at least one, because each worker's test process, browser and app server keep about two threads busy.
A trace is kept only for a failed test, with a DOM snapshot of every action and no screencast, whose
frames cost about a quarter of the suite's CPU. Worker N tests against its own server on
port `PLAYWRIGHT_PORT + N` (`PLAYWRIGHT_PORT` defaults to `4173`), so no two tests running at once
share a server, and concurrent checkouts choose different `PLAYWRIGHT_PORT`s.

Each server keeps its state and project folders in its own temporary directory, never the person's
own Vibe64 state. Playwright stops the servers with SIGTERM, and each directory is removed whenever
its server exits, including when Playwright itself ends without stopping them.

Every run builds the app first and tests that build, so the pages load bundled client code that
matches the installed JSKIT packages; no development-server dependency cache is involved. The run
never reuses a server already listening on one of its ports, because that server may serve a build
from before the last install: stop it, or choose another `PLAYWRIGHT_PORT`.

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
