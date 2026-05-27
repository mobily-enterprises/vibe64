# Vibe64 E2E Tests

`npm run test:e2e` runs the self-contained smoke spec. Playwright starts the Vite dev server through
`playwright.config.ts`, and the spec mocks Studio API responses before loading the app.

The large `base-shell.spec.ts` file is kept as the legacy shell coverage and is not part of the default E2E
command. Run it explicitly with `npm run test:e2e:legacy` when changing the shell behaviors it covers.

Live GitHub workflow coverage remains opt-in:

```sh
VIBE64_E2E_TARGET_ROOT=/path/to/studio-ai-e2e-repo npm run test:e2e:live
```
