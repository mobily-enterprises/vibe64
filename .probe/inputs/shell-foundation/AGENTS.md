# App Agent Instructions

Use current project context, JSKIT public APIs, and the official framework
documentation as the source of truth for application work.

Framework references:

- `https://mobily-enterprises.github.io/jskit-ai/guide/`
- `https://mobily-enterprises.github.io/jskit-ai/patterns/`

Before writing or reviewing code that reads or writes a database table, read
the data access guide at
`https://mobily-enterprises.github.io/jskit-ai/guide/framework/data-access`.

Before writing or reviewing server code (a feature, provider, action, service,
repository, route, error or test), read the typed features guide at
`https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features`.
`npm run lint` checks its rules, and each finding links the section that
explains it; `npm run verify` adds the package graph, tests and build. Fix a
finding in the code; excuse one only with the guide's `readable-check: allow`
comment and reason prefix.

Before writing or reviewing client code (a composable, component, client
factory or client provider), read the client features guide at
`https://mobily-enterprises.github.io/jskit-ai/guide/framework/client-features`.
Simple, direct code comes first: never add a layer, wrapper, registry or tiny
module only to satisfy a rule. `npm run lint` checks its rules too.

Before writing code that sends email, SMS, push notifications or payments,
calls another system, or depends on where the app runs, read the environments
guide at
`https://mobily-enterprises.github.io/jskit-ai/guide/framework/environments`.
`APP_ENV` (development, test, staging or production) decides all of it: only
production sends for real, staging sends email and SMS only to its test
addresses, and `NODE_ENV` only picks optimised builds.

Before implementation, read the narrow relevant source pattern completely. If
its owner package is installed, prefer that version-matched package-owned copy.
Do not install an unrelated runtime package only to read documentation.

Where the host provides a managed browser runner, every Playwright suite runs
through it from the first run, never through `npx playwright test`,
`playwright test` or a package script such as `npm run test:e2e`.

Before adding or changing browser-test setup, read the browser verification
guide at
`https://mobily-enterprises.github.io/jskit-ai/guide/framework/ui-operations#browser-verification`.
`playwright.config.mjs` is `browserTestConfig()` from
`@jskit-ai/jskit-catalog/browser-tests`: every Playwright worker gets its own
server on the production build, its own port and, through the config's
`prepare` module, its own copy of the browser database, restored from a schema
snapshot and seeded. A local run never starts the development server; with
`PLAYWRIGHT_BASE_URL`, the tests use that managed target as its host serves
it. Keep `BROWSER_TEST_DB_NAME` distinct from disposable `TEST_DB_NAME`. The build and
the snapshot are reused while their sources are unchanged; do not rebuild the
database or production frontend for each focused browser check. Require
repeat-start regression proof.

Tests run in parallel within the machine's test budget: run node's test
runner through `jskit test` (`npm test`), with `--databases` once the app has a
database so each file running at once gets its own copy of `TEST_DB_NAME`,
Playwright through `browserTestConfig()`, and take Vitest's `maxWorkers` from
`testConcurrency()` of
`@jskit-ai/jskit-catalog/test-budget`; never one file at a time or a fixed
count. Isolate files that collide (their own port, temporary directory and
database) instead of serialising them; a file that truly must run alone says
why on its first line, `// jskit-test: alone - <reason>`. Plain `jskit check`
fails anything else
(`https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#test-files-run-in-parallel`).

Keep verification output small. Run the relevant cases together, save complete
stdout/stderr to local artifacts, and preserve the exit status. Report counts,
duration, failed case names and artifact paths; read only actionable failure
excerpts. Do not dump full JSON/TAP reports, passing assertions, request logs or
traces into agent context. Wait on the existing run instead of restarting it or
repeatedly printing unchanged output. Keep startup and cleanup errors visible.
For browser evidence, use existing automated cases, targeted locators and
meaningful visual checkpoints. Avoid a full DOM snapshot or screenshot after
every action; retain the required viewport, identity and security checks.

Pages never start with a page header, title block, welcome heading, or other
standalone heading copy. Start with the useful content and actions. If the user
wants a heading, they will ask for or add one.

Selection fields never show a stored id as text. A select, autocomplete or
combobox whose options load from the server, or whose value is a record id,
uses `SelectField` from `@jskit-ai/http-web/client/components/SelectField` with
`loading` while the options load, not a raw `v-select`, `v-autocomplete` or
`v-combobox`. The lint rule `jskit/selection-field` reports a raw one whose
items are not fixed (a list written out, a top-level `const` holding one, or an
import from a `shared` module) and a `SelectField` over loaded items without
`loading`; a justified case says why in
`<!-- readable-check: allow selection-field - data: <reason> -->` above it.
That `loading` is not a spinner: Vuetify draws it as the field's own thin
progress line along its underline, the built-in loading state the Material 3
rules keep (`https://mobily-enterprises.github.io/jskit-ai/guide/framework/material-3#components-state-and-feedback`).
What those rules avoid is an ad-hoc spinner: a circular indicator on a button
or in place of content, or a whole-page one. Count spinners by what renders,
not by `loading` props.

Copied pattern source is ordinary application source. Do not add generator
provenance, receipts, completion ledgers, or tooling-operation history. Keep
changes scoped to the user request and verify runtime behavior directly.
