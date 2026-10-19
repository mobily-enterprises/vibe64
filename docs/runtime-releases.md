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

To publish, use `npm run npm-publish` (the shared JSKIT release tool,
`jskit-release publish`) with `NPM_TOKEN` in the environment, from a clean
`main` checkout whose HEAD matches `origin/main`. It builds and tests the
runtime artifact through `pack:release` (declared as the package's
`jskitRelease.pack` command) and compares its contents with the current npm
version. When they match, nothing is published and the version stays. When
they differ, it bumps the patch version, commits `Release vibe64@<version>`,
pushes to `main`, rebuilds and retests the artifact, and publishes that exact
tarball. `npm run npm-publish -- --dry-run` builds and compares without
writing, pushing or publishing. Production releases normally happen through
the Vibe64 Online deploy, which runs this command after pinning released JSKIT
and Genesis versions. Direct `npm publish` and `npm pack` from the source
checkout are guarded because the source manifest includes development-only
dependencies. Release preparation never prunes the source checkout's installed
dependencies.

Publish any new external dependency versions first. In particular, changes to
Genesis must be published before the corresponding Vibe64 release can pass a
normal fresh npm installation.
