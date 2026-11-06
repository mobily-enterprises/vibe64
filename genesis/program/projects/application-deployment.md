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
release-recreation paths, generated secret names, the setup code name, and success condition. Invalid, absent, and competing
declarations remain explicit states.

Commands are exact argument arrays with no placeholder expansion; `{host}` and
`{port}` are rejected. The executor starts the single, last Serve step with its
listen address in the `HOST` and `PORT` environment variables and probes the
Ready when path there. A host may also give Serve, and only Serve, its
runtime's conventional production setting such as `NODE_ENV=production`; a
value the project sets on the Serve step or in its production environment wins.

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

Genesis does not know what Deployment means. Vibe64 does not infer scripts from
the selected language or framework. The application or technology Stack owns
the scripts and checks; a project-owned section replaces a component proposal
when the real source differs.

## Implementation map

- `parseVibe64DeploymentLines()` — validates the consumer-owned section without shell evaluation.
- `vibe64DeploymentInspection()` — binds the parsed plan to the exact Stack and resource inspection.
- `exactGenesisInspection()` — rejects an unexpected generic Genesis contract identity.
