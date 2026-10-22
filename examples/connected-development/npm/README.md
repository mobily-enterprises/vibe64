# npm connected development

Proves the `npm` connected package type: a Node application uses a connected
checkout of a dependency instead of the published package, without changing
any tracked file.

## Recipe

The project declares its own commands in `genesis/stack.md` (see
`app/genesis/stack.md`). `app/tooling/connected.mjs`:

- **prepare** reads the sources map and runs
  `npm install --no-save --install-links=false <sourceRoot>...` for every
  connected `npm` dependency. `--no-save` leaves `package.json` and
  `package-lock.json` unchanged; `--install-links=false` links the checkout
  into `node_modules` instead of packing a copy, so later edits are seen
  immediately. Repeating prepare is a no-op.
- **verify** resolves each package from the application root and fails unless
  it resolves to the connected `sourceRoot`. A zero-exit no-op cannot pass.

`node_modules/` and `.development/` are ignored, so `git status` stays clean.
An ordinary `npm ci` restores the published dependency.

## Limitations

- Only the `dependency` relationship is handled. A `composition` (the
  connected repository is part of the application rather than a library) needs
  a project-specific treatment; Public Vibe64's own `tooling/development/compose.mjs`
  is one example of such a composition.
- The linked checkout needs its own dependencies installed when it has any.

## Evidence

`./prove.sh` copies both packages to a temporary directory, commits the app
with a lockfile recording the published `1.0.0`, edits the library, runs
prepare twice and verify, runs the app, and checks `git status`.

Tools: Node v26.5.0, npm 11.17.0.

```
@example/library -> /tmp/tmp.pMfXfQEkd2/library
app prints: library 1.0.0 + local change
PASS npm
```
