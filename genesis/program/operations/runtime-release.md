# Runtime releases

Maintainers distribute Vibe64 as built frontend assets, a bundled server and
its helper commands, required package data, and native runtime dependencies.
Building a package leaves the development dependency installation intact.
The launcher resolves the teaching CLI through its workspace package export,
so the same command works without a source checkout in the relocated runtime.

## Sources

- `index.html`
- `favicon.svg`
- `vite.config.mjs`
- `src/main.js`
- `src/theme/index.js`
- `src/theme/icons.js`
- `src/theme/extensions.js`
- `src/theme/terminal.js`
- `src/theme/palettes.js`
- `src/styles/vibe64-m3.css`
- `src/styles/vibe64-font.css`
- `tests/client/vibe64ThemeColours.vitest.js`
- `src/App.vue`
- `config/public.js`
- `tooling/release/server-build.mjs`
- `tooling/release/runtime-package.mjs`
- `bin/upgrade-state.js`
- `packages/vibe64-core/src/server/stateUpgrades/20260923-routing-v2.js`
- `packages/vibe64-accounts/src/server/assistantRoutingUpgrade.js`
- `packages/vibe64-core/src/server/stateUpgrades.js`
- `packages/vibe64-core/src/server/stateUpgrades/20260923-codex-login-id.js`
- `tests/server/stateUpgrades.unit.test.js`
- `docs/state-upgrades.md`
- Main: `tooling/release/pack-release.mjs`
- `tooling/release/verify-runtime.mjs`
- `tooling/release/verify-client-startup.mjs`
- `tests/server/clientStartup.unit.test.js`
- `tooling/release/precompress-assets.mjs`
- `server/lib/spaFallback.js`
- `tests/server/webBuildFiles.unit.test.js`
- `tests/server/webBuildReload.browser.test.js`
- `tooling/package-install-smoke.mjs`
- `tooling/verify-package-boundaries.mjs`
- `tests/server/runtimePackage.unit.test.js`
- `tooling/development/source-roots.mjs`
- `tooling/development/source-packages.mjs`
- `tooling/development/compose.mjs`
- `tooling/development/run.mjs`
- `tests/server/developmentSourceComposition.unit.test.js`
- `tooling/dev-example.mjs`
- `examples/hello-node/server.js`
- `examples/hello-node/index.html`
- `tests/server/developmentExample.integration.test.js`

## Public contract

Standalone same-user commands retain the launching shell PATH after the runtime
and project command paths, including dynamic terminal environments. This makes
personally installed coding tools available when opening a local directory.
Managed execution, managed workspace processes and commands crossing identities
do not inherit that path. The execution gateway owns this distinction in
`packages/vibe64-execution/src/server/runVibe64Command.js`; the environment
resolver and PTY engine carry the selected path through command startup.
`tests/server/vibe64ExecutionGateway.unit.test.js` exercises executable lookup
in capture and dynamic PTY modes and the managed boundary.

Runtime packages include an explicit state-upgrade command. Operators preflight
pending numbered scripts with `--check`, stop writers, then use `--apply` before
activating the candidate. The installation records each successful upgrade once,
retains private backups, and rejects unsupported upgrade history. Errors stop
activation; interrupted scripts must be safe to retry. A new installation
records its baseline (`--baseline`, or the server's first start of an empty
state root) so its current-format state is never replayed through history;
existing state without a ledger is refused for inspection. Ordinary application
reads and startup do not backfill old metadata. The first upgrade supplies a
Vibe64-local login identity for existing Codex connections without changing
native credentials or canonical project content. See `docs/state-upgrades.md`
for authoring, operation and recovery.

The appended `20261007-training-question-admission` boundary is prospective:
operators apply the complete candidate ledger with learner and conversation
writers stopped before admitting optional question/delivery snapshots. The step
converts no application files and creates no provenance for old messages; retry
changes only the ledger. The prior registry refuses its completed entry.

The build compresses each file Vite writes under `dist/assets/` once, beside
it: after `vite build`, package.json's build scripts run
`tooling/release/precompress-assets.mjs dist`, which writes a brotli (`.br`,
quality 11) and a gzip (`.gz`, level 9) copy of each script, stylesheet, SVG,
JSON, WebAssembly, icon and TrueType or OpenType font of at least 1 KB, each
only when it is smaller; images and woff/woff2 fonts are compressed already.
The server (`server/lib/spaFallback.js`) sends the copy the request's
`Accept-Encoding` accepts, brotli first, with `Vary: Accept-Encoding`; nothing
is compressed per request. Vite names every file it writes under `assets/` by
its content's hash, however the build splits the client, and the build has no
`public/assets/` to copy there unhashed (`webBuildFiles.unit.test.js` checks
both), so each file there is `public, max-age=31536000, immutable` and a browser
never asks for it again. The page is `no-store`, and every other file
`no-cache` with no ETag or Last-Modified: an installation such as the Nix store
dates every file 1970, so a validator from a file's size and date would match a
changed file of the same size. A plain reload or a new visit after an update
therefore loads the new build's page, which names only the new build's files;
a hard reload is never needed. A tab still running the old build that then
loads one of its modules finds that file gone (404), and JSKIT's shell shows
**App module did not download** (or **Page did not download**) with
**Reload**, which opens the same address on the new build.

An open tab keeps the client build it loaded. JSKIT names each production
build in `index.html` (its `jskit-client-build` meta tag), and the realtime
reconnection after a restart announces the build the server now serves. When
they differ, the JSKIT shell's `ShellErrorHost` in `src/App.vue` shows **Vibe64
was updated. Reload to get the latest version.** with **Reload**, naming the app
from `index.html`'s `<title>`. Vibe64 adds no code of its own for this. Nothing
polls, the page never reloads by itself, and a development (`npm run dev`) page
has no build to compare. See `docs/colleague-usage/vibe64-updates.md`.

While the editor restarts, the page carries on. Its one HTTP client
(`src/lib/vibe64HttpClient.js`, configured in `src/main.js`) sends a read that
finds no editor (no answer, or a 502, 503 or 504 from the edge) again with
backoff for up to a minute. It sends a write again only when the editor cannot
have done it. A write made while the page already knows the editor is
unreachable waits unsent until the editor answers. A write that got a 503 no
handler ran for is sent again: the stopping server's refusal before any handler
ran (`x-vibe64-stopping: 1`), or mobilynet's edge answering itself while no
editor runs (`x-mobilynet-no-backend: 1`, which the edge strips from every
backend response). Any other failed write (no answer, a 502 or 504, or an
unmarked 503) may come after the editor did the work, so it is never sent
again: its error keeps the transport's status and code for the callers
that follow their own lost answers (`vibe64HeldMessage.js`, the Preview start,
Create pull request), and its words say Vibe64 cannot tell whether it was done.
`src/lib/vibe64EditorReconnect.js` holds whether the editor answers. After
1.5 s without an answer `src/error.js` shows **Updating…** in the shell's
banner, and clears it when the editor answers. While it is unreachable, a GET
of `/api/health` watches for that answer. Once the editor answers, a realtime
socket that lost it reconnects at once and the live queries refetch
(`packages/main/src/client/vibe64RealtimeQueries.js`).
`tests/client/editorReconnect.vitest.js` drives a 5 s and a 30 s gap.

Task-oriented Colleague usage guides under `docs/colleague-usage/` ship with the
matching application runtime. The builder also ships `docs/training-content.md`
and the copyable `docs/templates/learn-topic/` authoring template. Its explicit
documentation list excludes unrelated project and internal architecture material.
The relocated runtime proof discovers a topic and reads its complete guide through
the real authenticated actions, checking it against the packaged Markdown.
The same relocated-runtime test validates the shipped draft topic through the
installed teaching CLI, without a source checkout.

This mechanism also applies to persisted message-format changes. Each script
currently owns discovery, backups and transformation through its `run` callback;
the runner supplies the backup directory and records completion. It does not
consume path declarations or create automatic snapshots. The guide separates
the implemented contract from the proposed `prepare()`/`backupPaths` extension.
The routing upgrade uses project/session-owned inventory, including restorable
archives. Its private before/after copies and manifest preserve original choices
across interrupted publication. The packaged command assembles the feature owner
without making Core depend on Accounts, and archive maintenance does not require
loading native PTY support. Normal routing reads reject the old format with an
upgrade instruction instead of repairing it on demand.

`npm run dev:example` starts both the editor backend and Vite, opening a working
copy of `examples/hello-node` through the existing project startup contract.
The default working copy, isolated state and session source live in ignored
`.vibe64-local/development/`; restarts preserve them. `--project` selects the
example working-copy path, `--state-dir` selects its runtime directory, and
`--host`/`--port` select the loopback frontend listener. The backend gets its own
OS-assigned port. Vite proxies API and realtime traffic to that backend.
The proxy keeps Origin and protocol local for backend authorization, and passes
on no X-Forwarded-For, so the backend, which believes a loopback proxy's, has the
proxy as its client. Its forwarded host retains the configured Studio hostname
for proxied output routing.
Proxied Preview routing and socket placement are retained from the host, with a
per-example routing namespace. The execution gateway preserves the trusted absolute `XDG_RUNTIME_DIR` for
children retaining the same OS identity, so the existing Preview resolver uses
the same host default. Cross-identity children do not inherit it, and callers
cannot override it. The launcher needs no separate host socket resolver. Standalone Preview socket housekeeping uses
`preview-sockets` under the example's state directory.
The listener can be reached through an authenticated preview proxy.
The browser connects realtime directly over WebSocket, which supplies the Origin
header required by cookie authentication. It does not begin with a
same-origin polling GET, where browsers omit that header. This uses JSKIT's
existing client transport configuration; proxied origin validation remains strict.

Initial preparation copies the bundled Genesis-authored application, initializes
current Genesis skills/hooks, and creates an independent Git baseline. An existing
working copy is never overwritten. The child editor uses standalone execution
inside the enclosing preview process, with its own state, source roots, attachments
and runtime namespace. It does not inherit the parent editor's private control
configuration. Frontend edits use Vite updates; backend edits require a restart.
The example preserves an explicit `VIBE64_CLAUDE_COMMAND` through its launcher
and terminal-provider environment filter, so account discovery and native chat
use the same operator-selected CLI. Vite's dependency cache lives under that
example's state directory and survives restarts without competing with other apps.
The Codex runtime directory retains this namespace even for the scope-free local
account server. Conversations share that account server within the example;
different example state directories cannot replace one another's runtime.
Explicit persisted runtime paths retain their existing recovery and stop owner.

Development may select JSKIT and Genesis source through `VIBE64_JSKIT_SOURCE_ROOT`
and `VIBE64_GENESIS_SOURCE_ROOT`. The shared development tools resolve ordinary
checkouts or current session pins, select the dependency closure, and materialize
one disposable dependency graph. Composing applications reuse those same operations.
Session pins validate the active-session path, package identity and Git metadata
through file reads; selection runs no commands in another project's session.
Ordinary laptop roots retain their Git repository-root check.
The normal installation and release lockfile stay unchanged. Source-aware Preview
and focused test commands use that graph; missing configured sources fail clearly.
Preview recomposes after source edits only after its previous process exits. A
changed pin is resolved on the next launch. Example source and state remain outside
the disposable app. Watch subscriptions exclude dependency directories and generated
state, and close before recomposition. Restart handling begins after the watcher's
initial scan, including symlink discovery, and logs the triggering path.
See `docs/colleague-usage/developing-vibe64.md`.

The repository's default Outputs target runs this complete development preview.
Its declared Project directory parameter defaults to the persistent example;
people can change it in Preview options without command-line access.
Workspace setup and deployment installation declare Node and C++ runtimes because
`node-pty` may need to build from source. Workspace setup explicitly rebuilds that
native dependency, including when npm considers its existing installation current
but its binary is missing. Example startup also declares Git.

The initial HTML contains a responsive loading screen with inline styles and no
requests of its own: Vibe64's logo drawn inline (the drawing of
`docs/site/public/vibe64-logo.svg`), its name, a slim loading bar and the
`role="status"` line. Its colours are literals, because it paints before the
theme: the editor's Material 3 background, on-surface, on-surface-variant,
surface-container-highest and primary roles from the seed's light and dark
schemes. It follows the device's light or dark setting, or this browser's
Appearance choice, which a small script inside the screen reads before it
paints. The bar slides only without a reduced-motion preference; with one it
pulses in place, overriding the app's own reduced-motion rule, which would leave
it still. Vue replaces the screen when bootstrap and initial routing finish. The
initial document's script offers "Taking longer than usual? Reload the page"
after ten seconds without the editor; a failed entry-module or dependency
download, or a bootstrap failure, changes the status to a retry explanation,
hides the bar and offers the reload at once. The download-error handler lives in
the initial document so it works even when the application cannot execute.
Without JavaScript the noscript explanation replaces the bar and the loading
line. The browser tab's icon, `favicon.svg`, is the same logo cropped to its tile,
with heavier waves so it reads at 16 pixels on light and dark tabs.
`tests/server/clientStartup.unit.test.js` keeps the colours equal to the
generated schemes, and the mark and the tab icon equal to the logo. Package releases verify the
exact built HTML in cold browser contexts at 390 (with reduced motion), 768 and
1280 pixels with JavaScript requests held back, then failed entry or dependency
downloads: loading feedback, the bar's motion with every stylesheet applied, no
reload before ten seconds and one at ten, a failure explanation after abort, and
a 48px Reload target, without horizontal overflow. Release artifact builders
invoke the same public proof on their composed frontend.

The built page opens the editor from few files. `vite.config.mjs` links the
built stylesheets at the end of `<body>`, after the loading screen, instead of
in `<head>`, where every one would hold the first paint: the screen paints as
soon as the page arrives, and the editor's module scripts still run only once
every stylesheet has applied, since a stylesheet the parser met holds the page's
module scripts wherever it stands. Vite's preload helper adds a lazily loaded
module's stylesheets at the end of `<body>` too, so they still follow the page's
own in the cascade; the build fails, naming the change, if the helper no longer
adds them as the config expects. Its Rolldown groups put every module the
entry imports statically (`$initial`) into the entry's own file, so the page
names one script and one stylesheet. The project page (`/app/project/:slug`,
where the editor opens) stays a lazy route; its file holds the page and the
modules it imports that nothing loaded without it imports. The modules it
shares with pages or components loaded without it come one file for each set of
those importers (`project-shared-<first module>`), so none of them loads more
than before. A lazily loaded page or component counts as loaded with the project
page when it is one of the page's nested routes, shows the page itself, or only
the page's own modules load it. Other routes and lazily loaded components keep
Rolldown's own chunks. `tests/server/clientStartup.unit.test.js` checks the
stylesheet moves and the grouping on a sample module graph. Package releases also
verify the exact built HTML names one script, no module preloads and its
stylesheets after the screen; then, with every stylesheet held back, that the
screen paints, the editor's code asks for nothing for a second after its entry
arrived, and its first request after they arrive finds every stylesheet
applied.

`npm run build` builds the frontend for local source execution. `npm run
pack:release` verifies package boundaries, builds the frontend, assembles a
separate runtime directory, packs it, and tests that exact tarball in an isolated
npm installation. The result is `.vibe64-release/build-<id>/vibe64-<version>.tgz`.
`npm run smoke:package -- /absolute/path/to/package.tgz` repeats the installation
proof for an existing artifact. It tests the real server and frontend asset,
realtime WebSocket handshake (with long-polling refused, as JSKIT's realtime
refuses it), native terminal, Genesis indexing and catalog, and CLI paths.
The relocated runtime also instantiates Knex's MySQL and PostgreSQL clients
without connecting to a database. Their dynamically loaded `mysql2` and `pg`
drivers remain explicit runtime dependencies even when bundling cannot see the
loads, so Database inspection works outside the development installation.
The lazy-loaded `node-pty` terminal dependency is also explicitly included.
The native-terminal proof is shared with release artifact creation: it starts a
real PTY from the assembled package before release, catching missing packages
and unusable native binaries without depending on a project's dependencies.

`npm run npm-publish` runs the shared `jskit-release publish` tool, whose
`jskitRelease.pack` command is `tooling/release/pack-release.mjs`. It requires a
clean `main` checkout matching `origin/main`, compares the built, tested
tarball's contents with the current npm version, and publishes only when they
differ: it bumps the patch version, commits and pushes the bump, rebuilds and
tests the tarball and publishes that same file. Unchanged contents publish
nothing. Direct `npm publish` or `npm pack` in the source checkout fails with an
instruction to use these commands, avoiding publication of the development tree.
Every external dependency version must already exist in the target registry.

The shared builder discovers installed server providers once at build time and
compiles their registry, which the server bundle hands to JSKIT's
`createStaticInstalledRuntime`: the development server's runtime, with its
APP_ENV check, security headers and health, without reading `node_modules`.
It bundles helper entrypoints as well as the server, including the standalone
host execution helper, the Codex process leader
with its history adapter and the working-turns reader (`workingTurns.js`), which
a host tool loads by its package export from outside the editor, preserving
runtime-relative resource paths. The relocated-package test launches the Codex
process leader and verifies its adapter lifetime without invoking a provider,
and loads the working-turns reader from the relocated runtime as a host does. Pure JavaScript already included in
the bundles is not declared as an additional complete runtime dependency.
Package metadata, licenses and non-code assets remain in small bundled packages.
Native modules and packages with dynamic runtime loading remain explicit pinned
npm dependencies. Their installed sizes are separate from the Vibe64 tarball.

JSKIT keeps the database-backed assistant in its own store feature, so a
supplied file-backed conversation runtime neither resolves, loads nor installs
the optional assistant database package. When that package is installed for SQL
storage, the materializer includes it using the existing optional-dependency
rule. The relocated assistant proof rejects database resolution and loading
while composing the actual file-backed runtime.

Composing applications pass their own helper entrypoints, external packages and
minification choice to this public builder. They consume the materialized
runtime, including installed external dependencies, without needing npm on the
activation host. The builder accepts only an empty separate destination and
never prunes the development node_modules directory.

The application theme is `src/theme/index.js`: one seed colour (Vuetify's default
blue, `#1867C0`), the Learning colour (`blend: false`, so its golden hue does not
move toward the blue seed), the subsystem colour (the teal of Architecture's
subsystem map, also `blend: false`, so subsystems stay apart from the blue pages),
the app's typeface and its own icons from
`src/theme/icons.js`, extended by `src/theme/extensions.js`, which Vibe64 leaves
empty and an app composed from Vibe64 replaces with its own colours and icons.
`src/main.js` builds Vuetify from it with JSKIT's `createMaterialVuetifyOptions`
(`@jskit-ai/material-web`): the md3 blueprint, light and dark Material 3 schemes
generated from the seed with every colour role (`surface-container-low`,
`outline-variant`, `learning-container` ...), Material Symbols Rounded behind every
`$` icon alias and JSKIT's component defaults; `material.css` adds the sizes props
cannot set. The theme's typography names Roboto for both Material 3 typefaces, the
brand one (display, headlines, large titles) and the plain one (everything else),
so the app keeps its font instead of JSKIT's default Roboto Flex. Roboto ships
inside the build: `src/styles/vibe64-font.css` self-hosts the variable latin subset
from `@fontsource-variable/roboto`, so every first launch renders it even where the
system has no Roboto. The person's Appearance choice picks the scheme, System
unless they chose Light or Dark.
`src/App.vue` keeps disabled actions on status and alert surfaces legible through
the shared roles. New notices use the theme surface/foreground pair, or a semantic
warning/error alert; components do not introduce grey background constants.
Borders, dividers and container tints use the theme's Material 3 roles directly
(`rgb(var(--v-theme-outline-variant))`, the `surface-container-*` tiers);
`src/styles/vibe64-m3.css` keeps only shape, spacing, motion, elevation and type
tokens and the Learning accent (`--v64-learning*`), built from the learning
roles. `src/theme/terminal.js` gives the terminal the dark scheme's surface and
on-surface in either appearance, because it is always a dark console. Content
colours, drawn the same in light and dark, are plain values in a `palettes.js`
beside the theme (`src/theme/palettes.js`, or a package's own `src/theme/`): the
Learn welcome's learner, Merc's avatars, the file tree's language tints, the
white marks and frosted monogram over course covers and the shading of Claude's
gold, crowned provider mark; components read them through `v-bind()` in their
styles or bound attributes. Shadows and scrims read the theme's `shadow` and
`scrim` roles with an alpha (`rgba(var(--v-theme-shadow), 0.12)`), as the
elevation tokens do, so no colour is written as channels outside `src/theme/`. A light tile that must stay light in either
appearance, such as the install QR code or a vendor logo, is a `v-sheet` with
`theme="light"`. A component names only `--v-theme-*` colours Vuetify declares for this theme, because the
browser ignores a declaration that names an undefined one;
`tests/client/vibe64ThemeColours.vitest.js` derives that set from the generated
theme, and fails on any other name in `src/` or a package's `src/`.
A device's reduced-motion setting reaches every screen: `src/styles/vibe64-m3.css`
then gives every CSS transition no duration and every animation a single
near-instant run, except Vuetify's indeterminate progress, which keeps moving to
show work under way, and turns off smooth scrolling. `src/main.js` opens Vuetify's
menus, selects and dialogs without their JavaScript fade, which no stylesheet
can end. Browser tests ask for reduced motion, so no step waits out an
animation.


The numbered `20261016-claude-rejected-input` repair joins the exact original
pre-write Claude guard to the retained Main routing attempt, interrupted agent
run, native binding and strict native history. It changes only a proven rejected
attempt into an explicit retryable failure; authored input, history and native
state remain unchanged. Temporary and archived chats are outside this correction.
The Terminals owner `assistantClaudeDeliveryUpgrade.js` uses existing session
inventory and Core's before/after publisher. Native nondelivery is rechecked on
backup resume. The assembled candidate CLI supplies the owner to Core; ordinary
application paths never run the repair. All writers must remain stopped until
candidate activation, including during interrupted-upgrade recovery.
