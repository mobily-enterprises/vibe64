# Vibe64 E2E Tests

`npm run test:e2e` runs the self-contained smoke, direct-chat, and managed-preview specs. The JSKIT Playwright config uses the managed
`PLAYWRIGHT_BASE_URL` when supplied; otherwise it builds and starts the local app server. The spec
mocks Studio API responses before loading the app.
That server keeps its state and project folders in a temporary directory, never the person's own
Vibe64 state. `PLAYWRIGHT_PORT` (default `4173`) selects its port, so concurrent checkouts do not
reuse each other's server.

The large `base-shell.spec.ts` file covers the Studio shell and is not part of the default E2E command.
Run it explicitly with `npm run test:e2e:shell` when changing the shell behaviors it covers.
