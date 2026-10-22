# Runtime releases

Maintainers distribute Vibe64 as built frontend assets, a bundled server and
its helper commands, required package data, and native runtime dependencies.
Building a package leaves the development dependency installation intact.
The launcher resolves the teaching CLI through its workspace package export,
so the same command works without a source checkout in the relocated runtime.

## Sources

- `index.html`
- `src/main.js`
- `src/styles/vibe64-font.css`
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
The proxy keeps Origin and protocol local for backend authorization. Its forwarded
host retains the configured Studio hostname for hosted output routing.
Hosted Preview routing and socket placement are retained from the host, with a
per-example routing namespace. The execution gateway preserves the trusted absolute `XDG_RUNTIME_DIR` for
children retaining the same OS identity, so the existing Preview resolver uses
the same host default. Cross-identity children do not inherit it, and callers
cannot override it. The launcher needs no separate host socket resolver. Standalone Preview socket housekeeping uses
`preview-sockets` under the example's state directory.
The listener can be reached through an authenticated hosting preview proxy.
The browser connects realtime directly over WebSocket, which supplies the Origin
header required by hosted cookie authentication. It does not begin with a
same-origin polling GET, where browsers omit that header. This uses JSKIT's
existing client transport configuration; hosted origin validation remains strict.

Initial preparation copies the bundled Genesis-authored application, initializes
current Genesis skills/hooks, and creates an independent Git baseline. An existing
working copy is never overwritten. The child editor uses standalone execution
inside the enclosing preview process, with its own state, source roots, attachments
and runtime namespace. It does not inherit the hosting editor's private control
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
checkouts or current hosted pins, select the dependency closure, and materialize
one disposable dependency graph. Hosted consumers reuse those same operations.
Hosted pins validate the active-session path, package identity and Git metadata
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

The initial HTML contains a lightweight, responsive loading shell with inline
styles and a reload link. Vue replaces it when bootstrap and initial routing
finish; a failed entry-module or dependency download, or a bootstrap failure,
changes its status to a retry explanation. The download-error handler lives in
the initial document so it works even when the application cannot execute. The
document remains useful while JavaScript downloads or is unavailable.
Package releases verify the exact built HTML in cold browser contexts at 390,
768 and 1280 pixels with JavaScript requests held back, then failed entry or
dependency downloads. Loading feedback, a failure explanation after abort, and a
48px Reload target must remain visible without horizontal overflow. Hosted
artifact builders invoke the same public proof on their composed frontend.

`npm run build` builds the frontend for local source execution. `npm run
pack:release` verifies package boundaries, builds the frontend, assembles a
separate runtime directory, packs it, and tests that exact tarball in an isolated
npm installation. The result is `.vibe64-release/build-<id>/vibe64-<version>.tgz`.
`npm run smoke:package -- /absolute/path/to/package.tgz` repeats the installation
proof for an existing artifact. It tests the real server and frontend asset,
realtime handshake, native terminal, Genesis indexing and catalog, and CLI paths.
The relocated runtime also instantiates Knex's MySQL and PostgreSQL clients
without connecting to a database. Their dynamically loaded `mysql2` and `pg`
drivers remain explicit runtime dependencies even when bundling cannot see the
loads, so Database inspection works outside the development installation.
The lazy-loaded `node-pty` terminal dependency is also explicitly included.
The native-terminal proof is shared with hosted artifact creation: it starts a
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
compiles their registry. It bundles helper entrypoints as well as the server,
including the standalone host execution helper and the Codex process leader
with its history adapter, preserving runtime-relative resource paths. The
relocated-package test launches the Codex process leader and verifies its adapter
lifetime without invoking a provider. Pure JavaScript already included in
the bundles is not declared as an additional complete runtime dependency.
Package metadata, licenses and non-code assets remain in small bundled packages.
Native modules and packages with dynamic runtime loading remain explicit pinned
npm dependencies. Their installed sizes are separate from the Vibe64 tarball.

The assistant feature's three SQL repository modules remain separate compiled
entries at their original package paths. The server retains their existing lazy
imports behind the SQL capability branch, so a supplied file-backed conversation
runtime neither loads nor installs the optional assistant database package.
When that package is installed for SQL storage, the materializer includes it
using the existing optional-dependency rule. The relocated assistant proof rejects
database loading while composing the actual file-backed runtime; the release
proof checks that the repository entries survive relocation.

Hosted consumers pass their own helper entrypoints, external packages and
minification choice to this public builder. They consume the materialized
runtime, including installed external dependencies, without needing npm on the
activation host. The builder accepts only an empty separate destination and
never prunes the development node_modules directory.

The application theme in `src/main.js` supplies paired `surface-variant` and
`on-surface-variant` colours: pale blue/dark text in light mode, blue/light text
in dark mode. Status sheets, session information, renewal messages and future
notices using that semantic surface inherit the pair rather than choosing a
background independently. `src/App.vue` keeps disabled actions on these surfaces
legible through the shared semantic surface and status/alert roles. Connection recovery uses its primary tint and the same on-surface
foreground. New notices use the theme surface/foreground pair, or a semantic
warning/error alert; components do not introduce grey background constants.
The app font, Roboto, ships inside the build: `src/styles/vibe64-font.css`
self-hosts the variable latin subset from `@fontsource-variable/roboto` under
the family name Vuetify and the `--v64-font-family` token already use, so every
first launch renders it even where the system has no Roboto.


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
