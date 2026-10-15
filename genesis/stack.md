# Stack

## Stack packages
- `genesis-stack`

## Components
- `nodejs`
- `jskit`
- `vue`
- `shell`

## Environment files

- Dotenv `.env`

## Verification

- Verify `application`: `npm` `run` `verify`

## Deployment

- Runtimes: `nodejs` `cpp`
- Ready when: `GET` `/api/health` returns `200`
- Prepare `Install dependencies`: `npm` `install`
- Build `Build`: `npm` `run` `build`
- Serve `Start`: `npm` `start`

## Outputs

### Target `app`: Run Vibe64

- Default.
- Mode: `interactive`
- Workdir: `.`
- Runtimes: `nodejs` `git`
- Run `Develop with example project`: `npm` `run` `dev:example` `--` `--connected-sources` `.development/connected.json` `--project` `{parameter:project-directory}` `--host` `{host}` `--port` `{port}`

#### Parameter `project-directory`: Project directory

- Default: `.vibe64-local/development/hello-node`
- Description: `Project opened by the development editor; a missing directory is initialized from the bundled example.`
- Required.

#### Presentation

- Kind: `web`
- Preferred port: `3000`
- URL path: `/app`
- Ready when: `GET` `/api/health` returns `200`

## Workspace setup

- Prepare `Install dependencies` with `nodejs` `cpp` when `package.json` exists: `npm` `install`
- Prepare `Build terminal native dependency` with `nodejs` `cpp` when `package.json` exists: `npm` `rebuild` `node-pty`

## Connected development

- Default package type: `npm`
- Sources file: `.development/connected.json`
- Verify `Compose and verify connected Node packages` with `nodejs`: `node` `tooling/development/compose.mjs` `verify` `.development/connected.json`

## Resource estimates

- Nothing.

## UI discovery

### Discovery `vue-pages`: Application pages

- Adapter: `jskit`
- Surface: `app`
- Mode: `filesystem`
- Page root: `src/pages`
- Registration: `vite.config.mjs`
- Component root: `src/components`
- Component root: `packages`

## Package discovery

### Discovery `npm`: Direct dependencies
- Adapter: `npm`
- Manifest: `package.json`
- Package root: `node_modules`

## Architecture inspection

### Inspector `vue`: Vibe64 routes and UI calls
- Runtime: `nodejs`
- Directory: `.`
- Command: `node` `node_modules/@jskit-ai/shell-web/src/architecture/cli.js` `--alias` `@=src`
- Required files: `node_modules/@jskit-ai/shell-web/src/architecture/cli.js`
- Timeout seconds: `60`
- Max output bytes: `4194304`
- Entry files: `bin/run.js` `server.js`

## Architecture layout

### Group `startup`: Application startup
- Kind: `layer`
- Purpose: `Starts the editor and wires its services together.`
- Subsystem: `bin`
- Subsystem: `.`
- Subsystem: `server`
- Subsystem: `config`
- Subsystem: `packages/main`

### Group `presentation`: Editor presentation
- Kind: `layer`
- Purpose: `Turns application capabilities into pages, components and interactions.`
- Subsystem: `src`
- Subsystem: `src/pages`
- Subsystem: `src/components`
- Subsystem: `src/composables`
- Subsystem: `src/views`

### Group `features`: Editor capabilities
- Kind: `layer`
- Purpose: `The tools people use to understand, edit, run and learn software.`
- Subsystem: `packages/vibe64-colleague`
- Subsystem: `packages/vibe64-training`
- Subsystem: `packages/vibe64-source-editor`
- Subsystem: `packages/vibe64-system-graph`
- Subsystem: `packages/vibe64-database-tools`
- Subsystem: `packages/vibe64-voice`

### Group `workspace`: Workspace services
- Kind: `layer`
- Purpose: `Owns the projects, identities and sessions that tools operate on.`
- Subsystem: `packages/vibe64-project`
- Subsystem: `packages/vibe64-sessions`
- Subsystem: `packages/vibe64-accounts`
- Subsystem: `packages/vibe64-terminals`
- Subsystem: `packages/current-app`
- Subsystem: `packages/studio-health`

### Group `runtime`: Application runtime
- Kind: `layer`
- Purpose: `Keeps application sessions and executions alive and recoverable.`
- Subsystem: `packages/vibe64-runtime`
- Subsystem: `src/lib`

### Group `support`: Development & resources
- Kind: `support`
- Purpose: `Supports development and distribution; these are not a runtime layer.`
- Subsystem: `tooling`
- Subsystem: `scripts`
- Subsystem: `docs`
- Subsystem: `examples`
- Subsystem: `src/assets`
- Subsystem: `.claude`
- Subsystem: `.github`
- Subsystem: `.opencode`

### Group `libraries`: Shared libraries
- Kind: `libraries`
- Purpose: `Reusable facilities independent of the editor features that consume them.`
- Subsystem: `packages/vibe64-core`
- Subsystem: `packages/vibe64-execution`
- Subsystem: `packages/vibe64-genesis`
- Subsystem: `packages/studio-terminal-core`
