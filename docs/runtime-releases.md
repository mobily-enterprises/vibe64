# Building and publishing Vibe64

For ordinary local development, use `npm run dev`. To run the built frontend
from the source checkout:

```sh
npm run build
npm start -- --project /absolute/path/to/test-project
```

To build a compact npm release and test a fresh installation:

```sh
npm run pack:release
```

The tested artifact is `.vibe64-release/build-<id>/vibe64-<version>.tgz`. It contains the
built frontend, bundled server and helpers, and required runtime assets. Native
modules and explicitly external packages are installed as ordinary npm runtime
dependencies. npm no longer receives the complete frontend/development graph.

To test that artifact manually without publishing:

```sh
npx --yes --package /absolute/path/to/vibe64-<version>.tgz vibe64 --project /absolute/path/to/test-project --open
```

To publish, use `npm run release` with the existing `VIBE64_NPM_TOKEN` or
`NPM_TOKEN` configuration. It bumps the patch version without creating a Git
tag, builds and tests the package, and publishes the exact tested tarball.
`--bump minor` and `--tag next` remain supported. `--dry-run` only reports the
planned version/publication; use `pack:release` to actually build and test.
Direct `npm publish` and `npm pack` from the source checkout are guarded because
the source manifest includes development-only dependencies. Release preparation
never prunes the source checkout's installed dependencies.

Publish any new external dependency versions first. In particular, changes to
Genesis must be published before the corresponding Vibe64 release can pass a
normal fresh npm installation.
