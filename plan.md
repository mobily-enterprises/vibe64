# Vibe64 Runtime Config And Online Deployment Plan

## Core Decision

Vibe64 owns runtime values. Adapters describe runtime shape. Generated env files are disposable output.

Production publishing is not a public/local Vibe64 feature. Production publishing belongs in the private `vibe64-online` repository, because that repository owns hosted tenants, public URLs, custom domains, Caddy routing, releases, and rollback.

The shared runtime config engine still belongs in public/shared Vibe64 code, because local preview, sessions, terminals, adapters, setup, and Vibe64 Online publishing all need the same key/value model.

For v1, there is no `.env` import. If an existing env file is not Vibe64-generated, Vibe64 backs it up and writes a fresh generated file from Vibe64 state.

The operating rule is:

> Never read `.env` to decide runtime config. Always write `.env` from resolved Vibe64 runtime config.

For production:

> Vibe64 Online owns deployment state. The shared runtime config engine owns environment values.

## Why This Exists

The beepollen preview failure exposed the old model:

1. Vibe64 knew managed database and managed Supabase values.
2. JSKIT and the app expected runtime values through process env or `.env`.
3. The session worktree copied `.env` only if it already existed at the project root.
4. beepollen was an old project added to newer JSKIT/Vibe64 flows, so project root `.env` did not exist.
5. Preview migrations failed because `DB_CLIENT` and `DATABASE_URL` were missing.
6. After database values were restored, auth failed because `APP_PUBLIC_URL` and managed Supabase values were missing.

The bug was not Knex or Supabase. The bug was that Vibe64 had runtime knowledge but did not consistently materialize or inject it everywhere.

## Goals

- One generic runtime config engine.
- Tiny adapter profiles.
- Runtime values resolved from Vibe64 state.
- Generated files always overwritten from Vibe64 state.
- Process env always injected by Vibe64.
- Dashboard UI for viewing and editing runtime config.
- Hosted Publish UI in `vibe64-online`, not public/local Vibe64.
- Vibe64 Online deployments use the same runtime config engine as preview and terminals.
- Only user-owned values are editable.
- Vibe64-managed values are read-only.
- No `.env` import in v1.
- No per-adapter hand-written env file writers.

## Non-Goals For v1

- No `.env` import.
- No unknown key classification.
- No preserving manual `.env` edits.
- No merge behavior.
- No per-adapter env file implementations.
- No production deployment UI in the public/local Vibe64 repo.
- No custom-domain or Caddy management in the public/local Vibe64 repo.
- No separate production env resolver in `vibe64-online` after the shared engine exists.
- No production secret materialization to project files unless explicitly designed.
- No attempt to infer arbitrary third-party secrets.

## Mental Model

`.env` is not source of truth.

`.env` is:

- generated
- reproducible
- safe to delete
- overwritten by Vibe64
- useful only as a compatibility file for local/framework tooling

Vibe64 should never read `.env` to decide runtime config in normal operation.

## Internal Data Model

All runtime config is represented as key/value records.

```js
{
  key: "OPENAI_API_KEY",
  value: "...",
  scope: "dev",
  owner: "user",
  secret: true,
  source: "project-secret",
  requiredFor: ["server", "preview"],
  materialize: true,
  editable: true
}
```

### Owners

- `vibe64`: managed database, managed Supabase, preview auth, generated URLs
- `adapter`: framework defaults and adapter-derived values
- `user`: third-party API keys, product secrets, user-provided config

### Scopes

- `dev`
- `prod`

Avoid extra scopes unless clearly necessary.

### Runtime Phases

- `install`
- `generate`
- `migrate`
- `seed`
- `server`
- `client-build`
- `preview`
- `deploy`

The phase list decides which keys are required for a specific action.

Important boundary: `deploy` is a valid runtime phase in the shared engine, but the public/local Vibe64 app should not expose a generic deploy product. A deploy phase has real product meaning only when Vibe64 Online supplies hosted deployment context.

## Generic Runtime Config Engine

The shared engine owns:

- schema/key registry
- value resolution
- dev/prod separation
- secret redaction
- required/missing checks
- generated file writing
- backup of unmanaged env files
- process env generation
- dashboard view model
- deterministic ordering
- sync status for project root and active worktrees

Adapters should not write `.env` directly. They should call the generic engine.

The shared engine does not own:

- public name reservation
- custom domain verification
- Caddy route files
- on-demand TLS approval
- release manifests
- rollback
- hosted tenant lifecycle

Those belong to `vibe64-online`.

## Adapter Profiles

Adapters provide small declarative profiles.

```js
{
  id: "jskit",
  materializers: [
    {
      format: "dotenv",
      path: ".env"
    }
  ],
  definitions: async (context) => [
    // env keys required by JSKIT packages and Vibe64-managed services
  ]
}
```

Example profiles:

- JSKIT: `.env`
- generic Node: `.env`
- Next.js: `.env.local`
- Laravel: `.env`
- Python: `.env` only if the adapter opts in
- C++: no file by default

Most adapters should reuse the same dotenv materializer.

## Value Resolution

Vibe64 resolves actual values from:

- project config
- managed database runtime
- managed Supabase app-auth state
- project/user secret store
- adapter metadata
- launch/runtime context

### Vibe64-Owned Values

Examples:

- `DB_CLIENT`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `JSKIT_AUTH_MODE`
- `JSKIT_AUTH_PROVIDER`
- `JSKIT_AUTH_SOURCE`
- `JSKIT_AUTH_SUPABASE_PROJECT_REF`
- `JSKIT_AUTH_SUPABASE_URL`
- `JSKIT_AUTH_SUPABASE_PUBLISHABLE_KEY`
- `JSKIT_AUTH_ENVIRONMENT`
- `APP_PUBLIC_URL`
- preview auth bypass variables

These values are read-only in the dashboard.

### User-Owned Values

Examples:

- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- third-party API tokens
- product-specific external service keys
- user-provided public config

Only these values are editable in the dashboard.

## Dashboard UI

Add a Runtime Config screen in the dashboard.

The screen should show:

- dev config
- prod config
- key name
- owner
- source
- required/missing status
- secret/public flag
- where it is materialized
- last generated time
- active worktree sync status

Only `owner: "user"` values are editable.

Read-only values:

- Vibe64-managed DB values
- Vibe64-managed Supabase values
- adapter-derived defaults
- generated preview/runtime values

Editable values:

- user-owned secrets
- user-owned public config
- user-owned dev/prod overrides

Secret values:

- masked by default
- edited through controlled secret inputs
- never shown in logs
- never shown in command previews
- ideally not revealable after save, or revealable only by explicit policy

Dashboard actions:

- save user runtime config
- regenerate runtime files
- sync active worktrees
- view missing required values
- copy key name

No import UI in v1.

## Public Vibe64 vs Vibe64 Online

There are two products involved:

- public/local Vibe64: the local editor/session system in this repo
- Vibe64 Online: the hosted product in `~/vibe64/vibe64-online`

The public/local Vibe64 repo should own shared mechanics:

- runtime config engine
- adapter profiles
- dotenv materialization
- terminal and preview env injection
- local project dashboard runtime config UI
- setup/readiness checks
- local managed runtime values

The public/local Vibe64 repo should not own hosted production publishing:

- no public deployment route as a product feature
- no custom domain screen
- no Caddy host routing
- no tenant production release runner
- no public-name registry
- no hosted ingress decisions

That separation matters because "deploy" has no complete meaning in local Vibe64. Local Vibe64 can run, preview, build, migrate, and verify a project. It does not know where the app should be published, which hostname should serve it, which tenant owns it, which Caddy instance routes it, or how a production release is rolled back.

Vibe64 Online gives `deploy` its meaning.

## Vibe64 Online Deployment System

The private `vibe64-online` repo already contains a deployment system, but it has not been completed as the authoritative production path.

Important current files:

- `packages/private-online-deployments/src/server/service.js`
- `packages/private-online-deployments/src/server/deploymentEnvironment.js`
- `packages/private-online-deployments/src/server/deploymentRunner.js`
- `packages/private-online-deployments/src/server/deploymentStore.js`
- `packages/private-online-deployments/src/server/caddyRouteMaterializer.js`
- `packages/private-online-deployments/src/server/publishPlans.js`
- `packages/private-online-core/src/client/app/pages/app/[slug]/dashboard/publish/index.vue`
- `packages/private-online-core/package.descriptor.mjs`

Current Vibe64 Online behavior:

- private route descriptor registers `/app/project/:slug/dashboard/publish`
- publish page can reserve/change a public Vibe64 URL
- publish page can add and verify custom domains
- publish page can show production services
- publish page can show and save production environment overrides
- publish page can run publish and rollback
- deployment store writes public-name, custom-domain, current-release, and release manifest state
- deployment runner builds, migrates, snapshots the workspace, starts a release container, health-checks it, and marks it published
- Caddy materializer writes generated Caddy site fragments for the public name and verified custom domains
- managed app auth sync reads deployment URLs and custom domains for production Supabase redirect allow lists

Current gap:

- the route exists, including on the deployed `/opt/vibe64/current`, but the generated dashboard placement/menu does not include a Publish link
- therefore the page is routable but not discoverable from the dashboard
- the deployment environment resolver is separate from the runtime config design
- deployment phase and release containers inject env with `docker run -e KEY=value`, which has the same secret argv problem as preview

## Online Deployment Must Use Runtime Config

`packages/private-online-deployments/src/server/deploymentEnvironment.js` should not remain a parallel env architecture.

The right end state:

- shared runtime config engine lives in public/shared Vibe64 code
- `vibe64-online` depends on that shared engine
- `vibe64-online` provides production runtime config sources
- online Publish UI consumes the shared runtime config view model for production env rows
- online publish runner consumes the shared runtime config resolved values for build, migrate, and release containers

The online deployment system still owns deployment state:

- public name
- public host
- custom domains
- DNS verification records
- verified domain state
- Caddy route files
- TLS ask/approval
- release manifests
- release logs
- rollback
- current release pointer

The online deployment system must not own generic runtime env logic:

- key registry
- owner/editability rules
- secret redaction
- missing required value checks
- user-owned value persistence model
- adapter runtime config profiles
- DB/app-auth env duplication

Instead, online should contribute production-specific sources into the shared engine.

## Online Production Runtime Config Sources

Vibe64 Online should resolve production runtime config with:

- scope: `prod`
- phases: `deploy`, `client-build`, `migrate`, `server`
- deployment context from `vibe64-online`
- adapter profile from public Vibe64

Online production source examples:

- deployment public URL from public-name state
- custom domain list from deployment domain bindings
- generated production `APP_PUBLIC_URL`
- production managed database values
- production managed Supabase values
- user-owned production overrides/secrets
- release/container metadata where needed

Example production values currently generated by online:

- `VIBE64_DEPLOYMENT_ENVIRONMENT=production`
- `VIBE64_DEPLOYMENT_PUBLIC_HOST=<name>.users.vibe64.dev`
- `VIBE64_DEPLOYMENT_PUBLIC_URL=https://<name>.users.vibe64.dev`
- `APP_PUBLIC_URL=https://<name>.users.vibe64.dev`
- `DB_CLIENT=mysql2`
- `DB_HOST=vibe64-mariadb`
- `DB_NAME=<stable production db name>`
- `DB_PASSWORD=<managed production password>`
- `DB_PORT=3306`
- `DB_USER=root`
- `JSKIT_AUTH_MODE=managed_supabase`
- `JSKIT_AUTH_PROVIDER=supabase`
- `JSKIT_AUTH_SOURCE=vibe64-managed`
- `JSKIT_AUTH_SUPABASE_PROJECT_REF=<prod ref>`
- `JSKIT_AUTH_SUPABASE_URL=<prod Supabase URL>`
- `JSKIT_AUTH_SUPABASE_PUBLISHABLE_KEY=<prod publishable key>`
- `JSKIT_AUTH_ENVIRONMENT=prod`

The exact key list should come from adapter profiles and source contributors, not from a hard-coded online-only resolver.

## Online Publish UI Work

The Publish page in `vibe64-online` must be completed properly.

Required product work:

- add a private dashboard placement/menu link for Publish
- keep the route private-online-only
- show public URL state
- support reserving/changing public name
- support custom domains and verification
- show current release and release history
- support rollback
- show production service readiness
- show production runtime config using the shared runtime config view model
- allow editing only user-owned production values
- show Vibe64/adapter/online-managed values as read-only
- block publish when required production values are missing
- make auth redirect sync status visible when public URL/domain changes affect app login

The public/local Vibe64 dashboard may have Runtime Config for local/dev values. It should not gain a hosted Publish page.

## Generated Files

For JSKIT, generated `.env` should look like:

```env
# Generated by Vibe64.
# Do not edit. Changes will be overwritten.
# Configure user-owned values in Vibe64 Runtime Config.

APP_PUBLIC_URL=http://localhost:3000
DB_CLIENT=mysql2
DB_HOST=vibe64-mariadb
DB_NAME=beepollen
DB_PASSWORD=...
DB_PORT=3306
DB_USER=root
JSKIT_AUTH_MODE=managed_supabase
JSKIT_AUTH_PROVIDER=supabase
JSKIT_AUTH_SOURCE=vibe64-managed
JSKIT_AUTH_SUPABASE_PROJECT_REF=...
JSKIT_AUTH_SUPABASE_PUBLISHABLE_KEY=...
JSKIT_AUTH_SUPABASE_URL=https://...
JSKIT_AUTH_ENVIRONMENT=dev
```

File rules:

- stable key ordering
- full overwrite
- generated header required
- recreate if missing
- `0600` if any secret exists
- user edits are overwritten

Existing unmanaged file behavior:

- if env file is missing: write generated file
- if env file has Vibe64 header: overwrite it
- if env file exists without Vibe64 header:
  - move it to `<path>.vibe64-backup-<timestamp>`
  - write generated file
  - report backup path

No parsing or importing in v1.

## Process Env Injection

The same resolved config must be injected into every Vibe64-launched process:

- Codex terminal
- shell terminal
- command terminal
- preview launch container
- setup doctor actions
- dependency install commands
- migrations
- seed scripts
- deploy commands in Vibe64 Online

Generated files are for compatibility. Process env injection is the runtime path.

Security note:

- Redact secrets in UI and command previews.
- Longer term, avoid leaking secrets through command argv such as `docker run -e SECRET=value`.
- Prefer secure env files, parent-env forwarding, or Docker API-style env passing where possible.

## JSKIT Contract

Under Vibe64:

- JSKIT declares required env keys.
- JSKIT does not own real managed values.
- JSKIT generators should not require DB passwords or Supabase keys.
- Runtime commands receive env from Vibe64.
- If JSKIT writes `.env`, Vibe64 overwrites it from resolved runtime config.

Outside Vibe64:

- JSKIT can keep standalone `.env` behavior.

## Lifecycle Hooks

Run runtime config materialization before:

- worktree creation/reuse
- Codex start
- shell terminal start
- command terminal start
- preview launch
- setup doctor repair
- dependency install
- migration
- seed
- hosted deploy prep in Vibe64 Online

Also run after:

- project config save
- managed Supabase sync
- user runtime config save
- database runtime config change
- online public name change
- online custom domain verification
- online production runtime config save

Worktree flow becomes:

```text
resolve runtime config
materialize project-root env files
materialize worktree env files
start terminal/preview
```

Do not copy `.env` as truth.

Online publish flow becomes:

```text
read online deployment state
resolve prod runtime config through shared engine
block if required prod values are missing
run build/migrate with resolved prod env
snapshot release workspace
start release container with resolved prod env
health check release
write release state
materialize Caddy route
sync app auth redirect URLs
```

Do not let online publish read `.env` as truth.

## Immediate Implementation Sequence

1. Create generic runtime config data model and resolver interfaces.
2. Create shared dotenv materializer.
3. Add generated-file header and unmanaged-file backup behavior.
4. Add JSKIT runtime config profile.
5. Resolve JSKIT managed database values from existing adapter/database runtime.
6. Resolve managed Supabase values from managed app-auth service.
7. Resolve `APP_PUBLIC_URL` from adapter/runtime defaults, initially `http://localhost:3000` for local dev materialization.
8. Add project-root and worktree materialization hook.
9. Replace JSKIT worktree `.env` copy hook with materialization.
10. Ensure terminal and launch process env injection uses the same resolved value map.
11. Add dashboard Runtime Config read-only/editable model.
12. Add user-owned value persistence.
13. Add missing-value blocking checks.
14. Add public/local dashboard Runtime Config screen for dev values.
15. In `vibe64-online`, replace the independent deployment env resolver with shared runtime config contributors.
16. In `vibe64-online`, keep deployment state, public names, custom domains, Caddy routes, releases, and rollback in the online deployment package.
17. In `vibe64-online`, add the missing private dashboard placement/menu link for Publish.
18. In `vibe64-online`, update the Publish page to render production runtime config through the shared runtime config view model.
19. In `vibe64-online`, update publish build/migrate/release-container env injection to use the shared resolved runtime config.
20. In both preview and online publish paths, move away from raw `docker run -e SECRET=value` where feasible.
21. Add tests for missing `.env`, stale `.env`, unmanaged backup, worktree sync, preview launch, online production config resolution, and online publish env injection.

## Test Requirements

Minimum tests:

- JSKIT preview works with `.env` missing before launch.
- JSKIT migrations work with `.env` missing before command.
- Worktree prepare writes generated `.env`.
- Project root generated `.env` is overwritten deterministically.
- Existing unmanaged `.env` is backed up, not parsed.
- Vibe64-managed values are read-only in dashboard model.
- User-owned values are editable in dashboard model.
- Missing user-owned required value blocks relevant phase with clear message.
- Launch container receives resolved env.
- Secret values are redacted in command preview/output metadata.
- Vibe64 Online publish route has a visible dashboard placement/menu link.
- Vibe64 Online production environment view is produced from the shared runtime config model.
- Vibe64 Online deployment public URL contributes production `APP_PUBLIC_URL`.
- Vibe64 Online managed Supabase production state contributes `JSKIT_AUTH_ENVIRONMENT=prod`.
- Vibe64 Online production database values are read-only runtime config values.
- Vibe64 Online user overrides are editable only when owner is `user`.
- Vibe64 Online publish blocks when required production values are missing.
- Vibe64 Online publish build/migrate/release containers receive the shared resolved prod env.
- Vibe64 Online Caddy route materialization still uses deployment state, not runtime config.

## Result

Vibe64 has one runtime config system.

Adapters describe what they need and how to print it.

Vibe64 Online owns production publishing and consumes the shared runtime config system.

Users edit only their own values in the dashboard.

Vibe64-managed values are read-only, regenerated, and injected everywhere.

`.env` becomes boring, disposable, and impossible to drift.
