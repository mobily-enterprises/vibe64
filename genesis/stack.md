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
