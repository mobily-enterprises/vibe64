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
release-recreation paths, and success condition. Invalid, absent, and competing
declarations remain explicit states.

Commands are exact argument arrays with no placeholder expansion; `{host}` and
`{port}` are rejected. The executor starts the single, last Serve step with its
listen address in the `HOST` and `PORT` environment variables and probes the
Ready when path there.

Genesis does not know what Deployment means. Vibe64 does not infer scripts from
the selected language or framework. The application or technology Stack owns
the scripts and checks; a project-owned section replaces a component proposal
when the real source differs.

## Implementation map

- `parseVibe64DeploymentLines()` — validates the consumer-owned section without shell evaluation.
- `vibe64DeploymentInspection()` — binds the parsed plan to the exact Stack and resource inspection.
- `exactGenesisInspection()` — rejects an unexpected generic Genesis contract identity.
