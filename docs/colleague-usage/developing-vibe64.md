# Develop Vibe64 with library source

This is a coding-agent and developer workflow for working on Vibe64 itself.
Colleague can explain it; it cannot edit source or run shell commands.

## Select the library checkouts

In the Vibe64 project's **Env → Development**, set either or both entries:

| Entry | Value |
| --- | --- |
| `VIBE64_JSKIT_SOURCE_ROOT` | Absolute path to the JSKIT checkout |
| `VIBE64_GENESIS_SOURCE_ROOT` | Absolute path to the Genesis checkout |

For hosted development, use each dependency project's absolute
`sessions/pinned/source` path. Pin the intended source session in that project.
For laptop development, export these variables with ordinary local checkout
paths before running the development command. Do not set them in Production.
Keep each selected checkout prepared with its own normal dependency setup.
Public's **Workspace setup** installs dependencies and rebuilds its native terminal
dependency with the declared Node and C++ runtimes. If Preview reports a missing
`node-pty` binary, let the assistant finish and use **Prepare workspace** or
**Retry** to run that setup. An ordinary managed command may lack the C++ tools
that the setup operation declares.

Vibe64 owns its own source, so it does not need `VIBE64_PUBLIC_SOURCE_ROOT`.
The selected Genesis repository supplies both compiler and Stack packages.
An unset entry uses the normal installed packages. A configured missing source,
missing required package, invalid export or incompatible external dependency is
an error; Vibe64 does not silently substitute a published package.

## Start or check development

Use **Start preview**, or run `npm run dev:example` locally. The launch resolves
the current pins and composes a disposable application under
`.vibe64-local/source-development`. The normal `node_modules`, package manifest
and release lockfile remain unchanged. The example project's source and state
remain in the original development location, outside that disposable app.

Source changes restart the composed development app after its previous process
exits. Dependency directories and generated state are excluded from watching.
After changing a project's pin, use **Restart preview** so the next launch
resolves the new selection. The log reports the resolved source roots and selected
local packages. No npm publication is needed for these edits.

Focused checks also use the selected sources:

- Server: `npm test -- tests/server/<name>.test.js`.
- Client: `npm run test:client:file -- tests/client/<name>.vitest.js`.

Run tests in the project that owns them. For a JSKIT test, the editing agent sends
JSKIT's agent the changed files, exact focused command and selected checkout. Its
owner checks for another active test, runs or queues the check, and returns the
result and log location. Relevant checks are already covered by the standing
development permission; do not create another human-approval exchange.

## Recover and release

If a source is unavailable, correct its path or pin and restart Preview. If a
package reports missing dependencies or outputs, have its owner prepare and check
that checkout. If the previous development app has not stopped, use **Stop
preview** and inspect the cleanup log before retrying; a second app must not be
started over it.

Use the normal publication process when releasing library changes, then update
Vibe64's published dependency versions and lockfile. Production builds use the
normal installation, not the disposable development composition. Development
permission does not itself authorize publication or deployment.
