# Interpret application deployment

Vibe64 turns a project's opaque Stack Deployment section into a safe,
machine-readable publication plan without AI interpretation or framework
guessing.

## Sources

- `packages/vibe64-genesis/src/server/index.js`
- Main: `packages/vibe64-genesis/src/server/applicationDeployment.js`

## Public contract

`inspectVibe64Deployment()` asks Genesis for the exact composed Stack section
named `Deployment`, validates it under the Vibe64-owned
`vibe64.application-deployment.v1` contract, and combines it with the Stack's
declared resources. The source is strict Markdown; its normalized result
contains exact argument arrays, working directory, runtime requirements,
release-recreation paths, generated secret names, the setup code name, sandbox
allowances, and success condition. Invalid, absent, and competing
declarations remain explicit states.

Commands are exact argument arrays with no placeholder expansion; `{host}` and
`{port}` are rejected. The executor starts the single, last Serve step with its
listen address in the `HOST` and `PORT` environment variables and probes the
Ready when path there. A host may also give Serve, and only Serve, its
runtime's conventional production setting such as `NODE_ENV=production`; a
value the project sets on the Serve step or in its production environment wins.
No step inherits the editor's own `NODE_ENV`.

`- Generated secrets:` names production secrets the application needs as a
stable random value. The host stores one strong random value per name once,
when its production environment has no entry with that name; it never replaces
a value someone set.

`- Setup code:` names the one production secret the application asks for when
its first account registers on an empty production database, so that only the
project owner can create that account. The host generates it like a generated
secret, which is why a name may not be in both entries, and shows its value
only to the project owner. It never prints the value or gives it to an
assistant. A project declares it only when its application reads that variable.

`- Sandbox allows:` names, from the closed set `fuse` and `gvisor`, what the
application's own commands and release service may do beyond an ordinary
production sandbox; the result lists them sorted, each at most once. `gvisor`
lets them start gVisor's rootless `runsc`; `fuse` lets them mount a FUSE file
system inside a user and mount namespace of their own. A host grants each only
where its owner permits it and refuses a deploy that needs one it does not grant;
[Workflow accounting](../execution/workflow-accounting.md) says exactly what
each adds to the sandbox.

The Deployment guidance for assistants also says where host-level preparation
beyond the package manager goes: one script per hosting environment,
`scripts/hosting/<host>.sh`, named by the `HOSTING_SCRIPT` environment variable
and run by the Prepare step, and only in an application that needs one. It
never works around Vibe64's rules: what Vibe64 provides, such as a runtime or a
sandbox allowance, is declared in the section, never installed or switched on
by the script, and a host that lacks something makes it fail with one plain
sentence.

`SIDE_EFFECTS` belongs to the host. It gives every step `live` only when the
deployment's owner chose to act for real, otherwise `simulate`, and an
unset value means `simulate` too. The parser refuses a step argument that sets
it (`SIDE_EFFECTS=...`) and a Generated secrets or Setup code entry naming it.
The application follows it: unless it is exactly `live`, it is a test copy that
simulates and logs email, SMS, push notifications, payments and third-party
webhooks and shows a "Test copy" banner. The application reads it at run time,
so a host can change it by restarting Serve without a new build. Prepare and
Build never need the database or another managed service, so a host may run
them alone, without those credentials, to check a revision builds.
Vibe64 itself acts for real: its server gives `SIDE_EFFECTS=live` only to the
environment its own features receive, so the projects it runs, which inherit
the process environment, stay test copies.

Genesis does not know what Deployment means. Vibe64 does not infer scripts from
the selected language or framework. The application or technology Stack owns
the scripts and checks; a project-owned section replaces a component proposal
when the real source differs.

## Implementation map

- `parseVibe64DeploymentLines()` — validates the consumer-owned section without shell evaluation.
- `vibe64DeploymentInspection()` — binds the parsed plan to the exact Stack and resource inspection.
- `exactGenesisInspection()` — rejects an unexpected generic Genesis contract identity.
