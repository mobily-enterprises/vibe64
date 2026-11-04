# Vibe64 E2E Tests

`npm run test:e2e` runs the self-contained smoke, direct-chat, and managed-preview specs. The JSKIT Playwright config uses the managed
`PLAYWRIGHT_BASE_URL` when supplied; otherwise it builds and starts the local app server. The spec
mocks Studio API responses before loading the app.
That server keeps its state and project folders in a temporary directory, never the person's own
Vibe64 state. Playwright stops it with SIGTERM, and the directory is removed whenever the server
exits, including when Playwright itself ends without stopping it. `PLAYWRIGHT_PORT` (default
`4173`) selects its port, so concurrent checkouts each start their own server.

Every run builds the app first and tests that build, so the pages load bundled client code that
matches the installed JSKIT packages; no development-server dependency cache is involved. The run
never reuses a server already listening on its port, because that server may serve a build from
before the last install: stop it, or choose another `PLAYWRIGHT_PORT`.

The large `base-shell.spec.ts` file covers the Studio shell and is not part of the default E2E command.
Run it explicitly with `npm run test:e2e:shell` when changing the shell behaviors it covers.

## Nightly record

`.github/workflows/nightly-browser.yml` runs the whole suite every night, and on demand with **Run
workflow** on the Actions page. It splits the suite into 12 shards that run at once on separate
GitHub runners, each with its own server and one worker. It is the one browser run that does not
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
