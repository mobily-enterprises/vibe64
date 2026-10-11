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
- Run `Develop with example project`: `npm` `run` `dev:example` `--` `--project` `{parameter:project-directory}` `--host` `{host}` `--port` `{port}`

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
- Timeout seconds: `60`
- Max output bytes: `4194304`
- Entry files: `bin/run.js` `server.js`

## Architecture layout

### Group `startup`: Application startup
- Kind: `layer`
- Purpose: `Starts the editor and wires its services together.`
- Subsystem: `bin` `Launcher` `Starts Vibe64 from the command line.`
- Subsystem: `.` `Application root` `Hosts the main server and application configuration.`
- Subsystem: `server` `HTTP host` `Registers server routes and request handling.`
- Subsystem: `config` `Configuration` `Declares application bindings and configuration.`
- Subsystem: `packages/main` `Composition` `Connects the application to its framework.`

### Group `presentation`: Editor presentation
- Kind: `layer`
- Purpose: `Turns application capabilities into pages, components and interactions.`
- Subsystem: `src` `UI composition` `Connects the editor UI to the application.`
- Subsystem: `src/pages` `Pages` `Registered screens and their navigation entry points.`
- Subsystem: `src/components` `Components` `Reusable editor views and controls.`
- Subsystem: `src/composables` `UI behaviour` `Coordinates reactive view state and application requests.`
- Subsystem: `src/views` `View shells` `Provides application view containers.`

### Group `features`: Editor capabilities
- Kind: `layer`
- Purpose: `The tools people use to understand, edit, run and learn software.`
- Subsystem: `packages/vibe64-colleague` `Colleague` `Operates Vibe64 through the product conversation.`
- Subsystem: `packages/vibe64-training` `Learning` `Delivers lessons and practical learning sessions.`
- Subsystem: `packages/vibe64-source-editor` `Source & interfaces` `Owns file navigation, editing and source explanations.`
- Subsystem: `packages/vibe64-system-graph` `Architecture` `Presents project structure and public interfaces.`
- Subsystem: `packages/vibe64-database-tools` `Database workspace` `Explores schemas, queries and database relationships.`
- Subsystem: `packages/vibe64-voice` `Voice` `Connects authorized speech to conversations.`

### Group `workspace`: Workspace services
- Kind: `layer`
- Purpose: `Owns the projects, identities and sessions that tools operate on.`
- Subsystem: `packages/vibe64-project` `Projects` `Owns project selection, environment and session creation.`
- Subsystem: `packages/vibe64-sessions` `Sessions` `Owns project conversations and their coordination.`
- Subsystem: `packages/vibe64-accounts` `Accounts` `Owns account readiness and login orchestration.`
- Subsystem: `packages/vibe64-terminals` `Terminals & outputs` `Owns managed terminals, conversations and output lifecycle.`
- Subsystem: `packages/current-app` `Project outputs` `Inspects the current project output targets.`
- Subsystem: `packages/studio-health` `Host health` `Reports read-only platform health.`

### Group `runtime`: Application runtime
- Kind: `layer`
- Purpose: `Keeps application sessions and executions alive and recoverable.`
- Subsystem: `packages/vibe64-runtime` `Session runtime` `Owns session storage, Git workspaces and runtime recovery.`
- Subsystem: `src/lib` `Editor support` `Provides application-specific browser and editor utilities.`

### Group `support`: Development & resources
- Kind: `support`
- Purpose: `Supports development and distribution; these are not a runtime layer.`
- Subsystem: `tooling` `Development tools` `Starts and packages development workspaces.`
- Subsystem: `scripts` `Maintenance scripts` `Performs build, release and maintenance operations.`
- Subsystem: `docs` `Documentation` `Explains how to operate and extend Vibe64.`
- Subsystem: `examples` `Examples` `Demonstrates supported projects and workflows.`
- Subsystem: `src/assets` `Assets` `Provides images and other UI resources.`
- Subsystem: `.claude` `Claude guidance` `Stores project-specific agent guidance.`
- Subsystem: `.github` `GitHub workflows` `Defines repository automation.`
- Subsystem: `.opencode` `OpenCode guidance` `Stores project-specific agent configuration.`

### Group `libraries`: Shared libraries
- Kind: `libraries`
- Purpose: `Reusable facilities independent of the editor features that consume them.`
- Subsystem: `packages/vibe64-core` `Core primitives` `Shared paths, errors, requests and project-context primitives.`
- Subsystem: `packages/vibe64-execution` `Command execution` `Runs authorized commands and managed terminal processes.`
- Subsystem: `packages/vibe64-genesis` `Genesis boundary` `Interprets project-owned contracts and exposes Genesis inspection.`
- Subsystem: `packages/studio-terminal-core` `Terminal primitives` `Provides shared terminal access, runtime identity and credential homes.`
