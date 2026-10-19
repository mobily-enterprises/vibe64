# Develop Vibe64 with library source

This is a coding-agent and developer workflow for working on Vibe64 itself.
Colleague can explain it; it cannot edit source or run shell commands.

## Prepare the connected checkouts

The Vibe64 repository declares its libraries in `vibe64.connections.json`.
**Prepare workspace** creates or reuses this session's isolated contribution
sources and writes its ignored `.development/connected.json` selection. The
checked-in Preview command supplies that map to `dev:example`. It consumes the
selected npm sources without modifying release manifests or installing over the
editable checkouts. Vibe64's own composition treats only npm dependencies and
custom connections; a connection with another package type, such as pip, stops
Preview with "has no treatment for pip connections". Choose npm or custom for
Vibe64's connections. See [Connected projects](connected-projects.md) for Settings,
preparation and contribution Save.

For a local prepared map, run
`npm run dev:example -- --connected-sources .development/connected.json`.
An explicitly supplied missing or invalid map fails; it never falls back to
another checkout. The map takes precedence over manual source variables below.

## Select checkouts manually

In the Vibe64 project's **Env → Development**, set either or both entries:

| Entry | Value |
| --- | --- |
| `VIBE64_JSKIT_SOURCE_ROOT` | Absolute path to the JSKIT checkout |
| `VIBE64_GENESIS_SOURCE_ROOT` | Absolute path to the Genesis checkout |

For hosted development, use each dependency project's absolute
`sessions/pinned/source` path. Pin the intended source session in that project.
Source selection reads the pin and repository identity without running commands
in the dependency's session. Its own agent still owns dependency tests and setup.
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
the prepared map or explicitly selected manual sources and composes a disposable application under
`.vibe64-local/source-development`. The normal `node_modules`, package manifest
and release lockfile remain unchanged. The example project's source and state
remain in the original development location, outside that disposable app.

To run two local examples at once, give each a different `--state-dir` and
`--port`. Each state directory supplies its own runtime namespace, so starting
Codex in one example does not replace the other's shared Codex server.
Conversations within the same example continue sharing their account's server.

Source changes restart the composed development app after its previous process
exits. The initial scan, including existing skill symlinks, does not restart it.
Each restart logs its triggering path. Dependency directories and generated state
are excluded from watching.
After changing a project's pin, use **Restart preview** so the next launch
resolves the new selection. The log reports the resolved source roots and selected
local packages. No npm publication is needed for these edits.

For a personally installed Claude CLI, sign in using `claude auth login`, then
launch the example with `VIBE64_CLAUDE_COMMAND=/absolute/path/to/claude` set in
your shell. The launcher preserves this explicit tool selection for account
discovery and chat. Open **AI Accounts** and use **Refresh** to confirm the
connection. A Claude website login alone does not sign in the CLI. Without an
explicit command, the installed managed-runtime command remains the default.

To hear read-aloud and use **Talk** in a local example, run a speech service (for
example `jskit-assistant-voice serve`, which listens on `127.0.0.1:3092`) and
launch with `VIBE64_VOICE_ENDPOINT=ws://127.0.0.1:3092/v1/voice` and
`VIBE64_VOICE_ACCESS_TOKEN_FILE=/absolute/path/to/token` set in your shell. The
launcher preserves these two settings like the Claude command; set both or
neither. Without them, voice controls report that speaking voices could not load
and text chat keeps working.

Each example keeps its frontend dependency cache under its own state directory.
Keep that directory between runs so normal restarts can reuse the prepared cache.
When a host supplies Preview routing, the example uses the host’s Preview socket
directory, including its default when no explicit directory is configured, so its
own project outputs remain reachable through that host. Same-user child processes
retain the host runtime directory through the execution gateway; you do not need
to create socket directories or change permissions manually.
Each example has a distinct Preview namespace while keeping its session data
isolated. Standalone runs keep sockets under their writable state directory.
Its API and conversation connection use a consistent origin through the internal
proxy, including when opened through HTTPS Preview. If an already-running example predates a launcher fix, use
**Restart preview** to apply it while retaining its example project and sessions.

For a slow agent startup, a developer can launch with `LOG_LEVEL=debug npm run
dev:example` and retain the server log. Claude startup records identify temporary
`catalogue` and `usage` queries. Managed Git records include `phaseElapsedMs`:
cumulative milliseconds through session lookup, authorization, account and
credential lookup, then command start and finish. Subtract command start from
finish to measure execution separately from admission. These extra diagnostic
fields are absent at the normal log level; they do not change execution or
automatically retry a command.

Focused checks also use the selected sources:

- Server: `npm test -- tests/server/<name>.test.js`.
- Client: `npm run test:client:file -- tests/client/<name>.vitest.js`.

Run tests in the project that owns them. For a JSKIT test, the editing agent sends
JSKIT's agent the changed files, exact focused command and selected checkout. Its
owner checks for another active test, runs or queues the check, and returns the
result and log location. Relevant checks are already covered by the standing
development permission; do not create another human-approval exchange.

## Recover and release

New Hello Node examples include Node's default connected package type, `npm`.
An existing example is preserved on restart. If current Genesis reports
`STACK_PROJECT_CONTRACTS_INCOMPLETE` or `STACK_SECTION_AMBIGUOUS`, explicitly
reconcile or decide that example's Stack section before retrying; restarting does not rewrite its
source or discard its state.

If a source is unavailable, correct its path or pin and restart Preview. If a
package reports missing dependencies or outputs, have its owner prepare and check
that checkout. If the previous development app has not stopped, use **Stop
preview** and inspect the cleanup log before retrying; a second app must not be
started over it.

Use the normal publication process when releasing library changes, then update
Vibe64's published dependency versions and lockfile. Production builds use the
normal installation, not the disposable development composition. Development
permission does not itself authorize publication or deployment.
