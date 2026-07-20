# Vibe64 E2E Tests

`npm run test:e2e` runs the self-contained smoke spec. The JSKIT Playwright config uses the managed
`PLAYWRIGHT_BASE_URL` when supplied; otherwise it builds and starts the local app server. The spec
mocks Studio API responses before loading the app.

The large `base-shell.spec.ts` file covers the Studio shell and is not part of the default E2E command.
Run it explicitly with `npm run test:e2e:shell` when changing the shell behaviors it covers.

Live GitHub workflow coverage remains opt-in:

```sh
VIBE64_E2E_TARGET_ROOT=/path/to/studio-ai-e2e-repo npm run test:e2e:live
```
