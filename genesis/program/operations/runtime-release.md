# Runtime releases

Maintainers distribute Vibe64 as built frontend assets, a bundled server and
its helper commands, required package data, and native runtime dependencies.
Building a package leaves the development dependency installation intact.

## Sources

- `index.html`
- `src/main.js`
- `tooling/release/server-build.mjs`
- `tooling/release/runtime-package.mjs`
- `tooling/release/pack-release.mjs`
- `tooling/release/verify-runtime.mjs`
- `tooling/package-install-smoke.mjs`
- `tooling/verify-package-boundaries.mjs`
- `scripts/npm-release.js`
- `tests/server/runtimePackage.unit.test.js`

## Public contract

The initial HTML contains a lightweight, responsive loading shell with inline
styles and a reload link. Vue replaces it when bootstrap and initial routing
finish; a bootstrap failure changes its status to a retry explanation. The
document remains useful while JavaScript downloads or is unavailable.

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

`npm run release` keeps its existing token authentication and clean-worktree
requirements, bumps the version without making a Git tag, then builds and tests
the tarball and publishes that same file. A pending version-only change may be
retried. Direct `npm publish` or `npm pack` in the source checkout fails with an
instruction to use these commands, avoiding publication of the development tree.
Every external dependency version must already exist in the target registry.

The shared builder discovers installed server providers once at build time and
compiles their registry. It bundles helper entrypoints as well as the server,
including the standalone host execution helper and preserving runtime-relative
resource paths. Pure JavaScript already included in
the bundles is not declared as an additional complete runtime dependency.
Package metadata, licenses and non-code assets remain in small bundled packages.
Native modules and packages with dynamic runtime loading remain explicit pinned
npm dependencies. Their installed sizes are separate from the Vibe64 tarball.

Hosted consumers pass their own helper entrypoints, external packages and
minification choice to this public builder. They consume the materialized
runtime, including installed external dependencies, without needing npm on the
activation host. The builder accepts only an empty separate destination and
never prunes the development node_modules directory.
