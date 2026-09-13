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

- Runtimes: `nodejs`
- Ready when: `GET` `/api/health` returns `200`
- Prepare `Install dependencies`: `npm` `install`
- Build `Build`: `npm` `run` `build`
- Serve `Start`: `npm` `start`

## Outputs

### Target `app`: Run Vibe64

- Default.
- Mode: `interactive`
- Workdir: `.`
- Runtimes: `nodejs`
- Run `Develop`: `npm` `run` `dev` `--` `--host` `{host}` `--port` `{port}`

#### Presentation

- Kind: `web`
- Preferred port: `3000`
- URL path: `/`
- Ready when: `GET` `/api/health` returns `200`

## Workspace setup

- Prepare `Install dependencies` with `nodejs` when `package.json` exists: `npm` `install`

## Resource estimates

- Nothing.
