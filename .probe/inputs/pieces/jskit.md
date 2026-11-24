# Stack piece: jskit

## Description

AI-first JSKIT runtime capabilities, tested source patterns, Vue surfaces, and
application-owned composition. Authoritative framework documentation:
https://mobily-enterprises.github.io/jskit-ai/

## Requires

- `nodejs`

## Guidance

- Derive one smallest JSKIT lane from established product intent instead of
  asking the user to choose framework shape: a public page uses the minimal
  foundation; navigation or settings uses the shell foundation; persistent
  records add the matching database integration and one CRUD pattern;
  login-required records use the shell, authentication, matching database
  integration, and one CRUD pattern; and an administrative dashboard uses the
  shell plus its relevant authenticated dashboard pattern. These are routing
  examples, not substitutes for unresolved product, access, or data decisions.
- Read the authoritative JSKIT framework guide at
  `https://mobily-enterprises.github.io/jskit-ai/guide/` and only the foundation
  and next source pattern required by that lane from
  `https://mobily-enterprises.github.io/jskit-ai/patterns/`. Do not compare every
  foundation, clone the whole framework repository, inspect unrelated package
  internals, or delegate research unless a concrete failure requires one exact
  investigation.
- Before writing or reviewing JSKIT server code (a feature, provider, action,
  service, repository, route, error or test), read the typed features guide at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features`.
  `npm run lint` checks its rules through `@jskit-ai/config-eslint`, and each
  finding links the section that explains it. Fix a finding in the code; excuse
  one only with the guide's `readable-check: allow` comment and reason prefix.
  Do not add project rules that repeat or contradict the guide.
- Before writing or reviewing JSKIT client code (a Vue component, composable or
  client provider), read the client features guide at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/client-features`.
  Client code listed in `clientFeaturesConfig` is held to its rules as lint
  errors, the same way the typed features rules hold server code.
- When local authentication is selected, ask whether the relevant application
  surfaces are public or login-required and expose
  `AUTH_LOCAL_SESSION_SECRET` as a required environment name in the project's
  established environment contract and committed environment example. Never
  commit or invent its value; the proposed Deployment lists it as a generated
  secret, so the deployment consumer supplies its production value.
- An application with accounts always has the host's browser-preview login,
  without waiting to be asked: when adding authentication, add the
  `auth/auth-surface` pattern's executable `tools/preview-identity` and copy its
  exact `#### Preview identity` block (Command `tools/preview-identity`,
  Protocol `vibe64.preview-identity.command.v1`, Identity types `email`
  `user-id`, Enabled environment `AUTH_DEV_BYPASS_ENABLED`, Secret environment
  `AUTH_DEV_BYPASS_SECRET`, Runtimes `nodejs`) under each web `Outputs` target
  (`app` and `test-app`).
- The `test-app` Outputs target serves the app's browser suite on its own test
  database: `jskit browser-test-server` runs one worker's server of the
  `browserTestConfig()` in `playwright.config.mjs`, whose `prepare` module and
  `env` choose that database and the test controls, so keep that config. Run a
  suite that writes data against it (in a Vibe64 session,
  `vibe64-helper playwright --target test-app npm-run test:e2e`), never against
  the normal target, whose data is the person's.
  Which existing accounts the preview uses stays the person's choice; never
  create users for it.
- Production mode is `NODE_ENV=production`. JSKIT and application code read
  it; JSKIT never sets it. The proposed Deployment sets it on the Serve step
  only. Never make it a project-wide default or set
  it for dependency installation: `npm ci` would then omit the
  devDependencies the Build step needs, such as Vite. `vite build` sets it for
  its own process only. In production JSKIT's local authentication requires
  `AUTH_LOCAL_SESSION_SECRET`, refuses `AUTH_DEV_BYPASS_ENABLED`, and issues
  `Secure` session and CSRF cookies with the `__Host-` prefix, so the first
  production-mode start signs everyone out once.
- Before creating or modifying JSKIT Vue/Vuetify UI, read the Material 3
  contract at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/material-3`
  completely.
- Implement Material 3 through JSKIT patterns, shared screens, shell and
  placement seams, app-owned theme configuration, and supported Vuetify APIs.
- Use geometry-preserving Material skeletons for content that is still
  loading, so nothing jumps when the data arrives. A control's own loading
  state is the right signal and stays: `SelectField`'s `loading` while its
  options load, which JSKIT's client guide requires, and the same `loading` on
  `v-autocomplete`, `v-combobox` and `v-data-table` draw Vuetify's thin
  progress line along the control. When possible, avoid ad-hoc spinners: a
  circular indicator on a button (`v-btn`'s `loading` draws one) or in place of
  content, and a whole-page or blocking spinner. A running action keeps a
  stable pending label ("Saving…"): `pending` on `ShellPageAction` and
  `ShellPrimaryAction`, `v-pending` on other buttons, rather than `disabled`.
- Keep resource-load and field errors in context, but route transient
  user-command failures through JSKIT's shared non-layout-shifting action
  feedback/snackbar path.
- When declared, `TEST_DB_NAME` is the exact disposable integration database and
  `BROWSER_TEST_DB_NAME` is a separate reusable browser-fixture database whose
  migration ledger survives routine runs. Never reset `DB_NAME`, share these
  identities, or point a test runner's `DB_NAME` elsewhere to pass safety checks.
  Routine browser-test startup reuses the isolated test schema, applies only
  pending migrations and resets fixtures deterministically; it does not drop or
  rebuild the database or run a production frontend build per check. Keep
  fresh-schema migration checks separate.
- Sanity checks with JSKIT. Apply the engineering baseline's checks and
  `.agents/skills/genesis-project/references/sanity-checks.md` with JSKIT's
  mechanics, described at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/sanity-checks`.
  Integration tests restore `TEST_DB_NAME` from a stored schema snapshot keyed
  by a digest of the migration sources, as
  `https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/database-layer#integration-test-databases`
  describes; list, batch and write paths compare their query counts at
  realistic sizes, as
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#query-counts-at-realistic-sizes`
  describes. A read narrows in its query, with the filters the resource's
  `searchSchema` maps (a field, an id list, `q`), never with `filter`, `find`
  or `slice` on rows a query returned; a list's Search box and a lookup field's
  autocomplete send `q` to the server, which narrows only where that resource
  maps `searchSchema.q`.

- When application integrations are requested or `integrations.json` exists,
  treat that file as the application-owned configuration used by both editor
  forms and CLI work. Inspect the selected provider's installed package README
  and setup instructions before changing its registration, scopes or callbacks.
  For catalogue providers, start with `@jskit-ai/connectors-catalog/README.md`
  and its `docs/<provider-id>.md`; separately packaged providers own their docs.
  Do not configure every provider merely because the catalogue is installed.
- Read credentials through the declared Env references on the server. Keep
  registrations, callbacks, connection persistence and refresh/revocation with
  the application. Use its durable identity rather than deriving identity from
  a deployment URL. Shared administrator connections and each app user's
  connections require distinct authorization and storage scopes.
- For Stripe/Paddle subscription features, read the installed
  `@jskit-ai/payments-core/docs/standalone.md` and `docs/contract.md` before
  composing its ordinary libraries, package migrations and authenticated app
  routes. `extensions.payments` in the same configuration declares plans and
  environment bindings; an editor is not needed to author it. Missing package
  availability or provider credentials must be stated, not silently invented.
- If the project uses an editor integration-setup command, implement the exact
  supplied static operation contract through the app's existing command entry
  point. Keep local administrator authority separate from customer web routes;
  input fields never grant administrator access. Verify the requested provider
  outcomes and denied access with controlled fixtures. Genesis transports
  guidance and opaque declarations; it does not execute integrations or payments.
- Shipping the app to phones ("install on my phone"): the host-owned
  `## Packaging` section is written only when the person adds a mobile target.
  It declares a separate `web-bundle` package whose Build produces the bundled
  client (Output its build folder) with the absolute HTTPS API base the client
  calls, then a `capacitor` package with `Content: package <that id>`,
  `Platforms: android`, a permanent reverse-DNS `Id`, `Name`, a committed
  1024x1024 PNG `Icon` without transparency, `Version from: package.json` and
  one `Permission` line, with a plain reason, per native capability. The host
  generates and discards the native project on every build: never commit
  `android/`, `ios/`, `capacitor.config.*`, Gradle files, build numbers or
  signing keys. Native plugins are ordinary client dependencies at the exact
  versions in `package-lock.json`, and the host's shell is Capacitor 8; it
  blocks a lockfile mismatch or another major. `@jskit-ai/mobile-capacitor` is
  still on Capacitor 7, so propose mobile packaging for a JSKIT client only
  once its Capacitor dependencies are 8.x. A deep-link scheme and app-link
  domains live once in `## Environment defaults` (for example `APP_URL_SCHEME`,
  `APP_LINK_DOMAINS`) and Packaging names them with `Deep link scheme from` and
  `App link domains from`; the server's CORS and OAuth callbacks must accept
  the app's origin and scheme.

## Adoption

- Read the authoritative existing-application migration guide at
  `https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/existing-application-migration`
  completely before editing Stack or assessing readiness.
- Inventory the coordinated `@jskit-ai/*` package graph, application-owned
  composition, package-owned migrations, explicit repositories/features/named
  actions, and current client resources without running a broad package update.
- Compare the real package scripts with JSKIT's current Workspace setup,
  Outputs, Verification, and consumer-owned Deployment proposal. Genesis keeps
  that extra section opaque; the deployment consumer validates it. Older source
  needs a complete project-owned override until a separately approved port
  supplies the current commands.
- When an established Deployment's Serve step lacks `NODE_ENV=production`, the
  application has been running in development mode. Add it only when the
  production environment already holds every value the application's source
  requires in production mode (for example real email, payment or storage
  providers instead of simulated ones, and `AUTH_LOCAL_SESSION_SECRET` unless
  the Deployment generates it); the next deployment then starts in production
  mode, and a missing value stops it from starting.
- When an established Deployment lacks the proposal's
  ``- Generated secrets: `AUTH_LOCAL_SESSION_SECRET` `` entry, add it (keeping
  any names it already lists), so the deployment consumer supplies the
  production session secret the application never commits.
- Inspect existing setup and database preparation for both migration discovery
  and an app-owned idempotent seed. Never infer `db:prepare` from the selected
  component when the script or preparation file does not exist.
- When the project declares an application-owned identity exchange for a host's
  browser preview, preserve its command, selectors, protocol, environment names,
  runtime and timeout in the project's existing section. When an application
  with JSKIT accounts lacks it, add it from the `auth/auth-surface` pattern as
  in Guidance.
  A host-saved identity name/value is not a substitute for this application
  contract.
- Treat generator descriptors, receipts, sync commands, legacy service
  locators, and retired tool manifests as migration evidence only. Translate
  live facts into current source/Stack and report remaining port work; do not
  add compatibility readers or claim adoption performed the port.
- Compare the application's `eslint.config.mjs` with the foundation pattern's:
  `typedFeaturesConfig` over the server and shared code of each converted
  package, `sizeLimitsConfig` over all hand-written code and `formatterConfig`.
  Report the packages not yet listed, and the findings that keep them out, as
  remaining port work; never lower a rule to `warn` or excuse findings in bulk
  to make lint pass.
- Review the proposed `## Resource estimates` section (a host-owned opaque
  section whose grammar belongs to the consuming host) against the application's
  actual Outputs target ids and Workspace setup. Its initial Node development
  estimates are planning hints, not measured requirements, hard memory limits,
  or a promise of available capacity. Keep startup/build and ready runtime
  separate, and give an isolated test target its own estimates. Do not add a
  shared database's full footprint to every application target. Hosts own
  measured history, admission and limits outside project source; they do not
  rewrite this section as they learn. Preserve an existing project section.

## Workspace setup

- Prepare `Install dependencies` with `nodejs` when `package.json` exists: `npm` `install`

## Environment files

- Dotenv `.env`

## UI discovery

### Discovery `vue-pages`: Application pages

- Adapter: `jskit`
- Surface: `app`
- Mode: `filesystem`
- Page root: `src/pages`
- Registration: `vite.config.mjs`
- Component root: `src/components`
- Component root: `packages`

## Architecture inspection

### Inspector `vue`: Application pages, routes and function calls
- Runtime: `nodejs`
- Directory: `.`
- Command: `node` `node_modules/@jskit-ai/shell-web/src/architecture/cli.js` `--alias` `@=src` `--calls`
- Required files: `node_modules/@jskit-ai/shell-web/src/architecture/cli.js`
- Timeout seconds: `90`
- Max output bytes: `67108864`
- Preview locator: `node_modules/@jskit-ai/architecture-inspector/src/previewLocator.js`

## City regions

- Ignore `**/test/**`
- Ignore `**/tests/**`
- Ignore `**/__tests__/**`
- Ignore `**/*.test.*`
- Ignore `**/*.spec.*`
- Match `packages` as `Packages`: `packages/**`
- Match `source` as `Source`: `src/**`
- Fallback `everything-else` as `Everything else`

## Outputs

### Target `app`: Run app

- Default.
- Mode: `interactive`
- Runtimes: `nodejs`
- Run `Develop`: `npm` `run` `develop`

#### Presentation

- Kind: `web`
- Preferred port: `3000`
- URL path: `/`
- Ready when: `GET` `/api/health` returns `200`

### Target `test-app`: Test Preview

- Mode: `interactive`
- Data: `test`
- Runtimes: `nodejs`
- Run `Serve on the test database`: `node_modules/.bin/jskit` `browser-test-server` `{host}` `{port}`

#### Presentation

- Kind: `web`
- URL path: `/`
- Ready when: `GET` `/api/health` returns `200`

## Resource estimates

### Output `app`

- Startup typical MiB: `1024`
- Startup high MiB: `1536`
- Running typical MiB: `768`
- Running high MiB: `1536`

### Output `test-app`

- Startup typical MiB: `1024`
- Startup high MiB: `1536`
- Running typical MiB: `768`
- Running high MiB: `1536`

### Workspace setup

- Typical MiB: `1024`
- High MiB: `1536`

## Deployment

- Runtimes: `nodejs`
- Recreate on restore: `node_modules`
- Generated secrets: `AUTH_LOCAL_SESSION_SECRET`
- Ready when: `GET` `/api/health` returns `200`
- Prepare `Install dependencies`: `npm` `ci`
- Build `Build`: `npm` `run` `build`
- Serve `Start`: `env` `NODE_ENV=production` `npm` `start`

## Deslop

- For every affected JSKIT screen, read the Material 3 contract at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/material-3`
  and execute its audit.
- Use JSKIT patterns, packages, resources, composables, screens, and placement
  seams instead of parallel framework plumbing.
- For affected JSKIT server code, apply the typed features guide at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features`
  and leave `npm run lint` without findings: collaborators required and typed,
  actions one line from `create<Name>Actions`, refusals with their own code,
  the environment from the caller, files under 750 lines.
- For affected JSKIT client code (Vue components, composables, client
  providers), apply the client features guide at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/client-features`,
  simple code first, and leave `npm run lint` without findings where the code
  is listed in `clientFeaturesConfig`: options and props typed and required,
  no probes, a fixed result shape, listeners released, no module state.
- Treat copied pattern source as app-owned and customizable. Adapt routes,
  placements, and infrastructure tests coherently; when replacing a foundation
  route, update its baseline browser coverage instead of deleting it.
- Consolidate repeated validation, pending/error state, API access, and page
  behavior at the shared resource or established JSKIT seam.
- Replace transient command-error alerts that shift page content with the
  established JSKIT action feedback/snackbar seam; preserve stable in-page
  resource-load errors, retry states, and field validation.
- Replace generic in-content spinners with Material skeletons that reserve the
  final layout, and verify that loading completion does not shift content.
  Keep a control's own loading line (`SelectField`'s, a field's or a table's
  `loading`): it is not a spinner. Find spinners by what renders
  (`v-progress-circular`, a button's `loading`), not by `loading` props.
- Remove pass-through wrappers and abandoned scaffold code only when doing so
  preserves routes, placements, baseline tests, and observable behavior.

## UI pass

- Read JSKIT's Material 3 rules at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/material-3`
  and its UI pass method at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/ui-pass`
  completely, then follow the method for the resolved scope: the changes, a
  section, or the whole app.
- Navigation and Up are must-fix at every scope (#241): plain
  `npx jskit check`, which `npm run verify` runs, fails on every `nav/*` rule.
- Run `npx jskit check m3` on the scope (the changed UI files, the section's
  directory, or no paths for the whole app) until it reports nothing, and
  `npx jskit check` until it passes.
- The checks cannot see layout, spacing or contrast; look at every screenshot
  for those.

## Identity pass

- Read JSKIT's visual identity page at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/visual-identity`
  and its Material 3 rules at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/material-3`
  completely. The identity lives where that page puts it: the seed and a
  named colour per content kind in `src/theme/index.js`, every content colour
  in `src/theme/palettes.js`, the cover and empty-state art in
  `src/components/art/`, the logo with `favicon.svg`, the startup shell in
  `index.html`, and sign-in in the auth surface's `AppBrand.vue`.
- Run `npx jskit check m3` until it reports nothing and `npx jskit check`
  until it passes, then take the screenshots as JSKIT's UI pass method shows.

## Quality pass

- Read JSKIT's quality pass page at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/quality-pass`
  completely: where loading, empty, error and refused states live in a JSKIT
  app, how each refusal carries its own code to `useJskitText()`'s
  `serverMessage()`, and how Playwright forces each state.
- Run `npm run verify` and the focused Vitest and Playwright tests of the
  affected screens.

## Data pass

- Read JSKIT's data pass page at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/data-pass`
  and its data access guide at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/data-access`
  completely: the table resource is each table's one owner, Knex migrations
  carry constraints and indexes, and `expectFlatQueries()` compares a path's
  queries at a few rows and at a realistic number on `TEST_DB_NAME`.
- Leave `npm run lint` (which reports narrowing in code) and `npx jskit check`
  without findings.

## Security pass

- Read JSKIT's security pass page at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/security-pass`
  completely: each route's `auth` and `permission`, a table resource's
  `ownership` and row policy scoping every handle call, `expectScoped()` for
  another workspace's rows, `rateLimit` and `config.auth.rateLimits`, the
  first account's setup code, and what `NODE_ENV=production` requires, such as
  `AUTH_LOCAL_SESSION_SECRET`.
- Try each refusal through `app.inject` on the test server, then run
  `npm run verify`.

## User experience pass

- Read JSKIT's user experience pass page at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/ux-pass`
  completely: main tasks as `shell.primary-nav` placements and each inner
  page's `jskit.parent`, `ShellPrimaryAction` for a list's New and a record's
  one filled next step, a new form's `initialValue` or `createModel`,
  `saveSuccess` for where Save lands, `CrudDeleteAction`'s confirmation, Undo
  in the snackbar, and the app's words through `useJskitText()`.
- Walk each main task in the host's managed Preview or a Playwright spec, then
  run `npm run verify`.

## Speed pass

- Read JSKIT's speed pass page at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/speed-pass`
  completely: `jskit test` runs test files in parallel within the machine's
  test budget (`V64_TEST_CONCURRENCY`, else half the CPUs) and ends with its
  slowest files, `jskit test --databases` restores a stored snapshot for each
  file, a fixture every file only reads is made once in a
  `--test-global-setup` module, a client provider exported by its own subpath
  keeps screens out of every page's first load, and a list reads its related
  records with `include` and its selected values by `filter[id]` in one
  request.
- Compare the whole `npm test` wall time, its slowest files and the build's
  chunk sizes before and after, then leave `npx jskit check` and
  `npm run verify` passing.

## Verification

- Verify `application`: `npm` `run` `verify`
