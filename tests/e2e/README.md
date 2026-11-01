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
