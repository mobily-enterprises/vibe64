# Handover: Vibe64 Runtime Config And Generated Env Files

This file is intended as a prompt/context document for a new session. It captures the decisions from the beepollen incident and the runtime configuration design discussion.

## Short Summary

We decided that Vibe64 needs one generic runtime config engine.

The central rule is:

> Vibe64 owns runtime values. Adapters describe runtime shape. Generated env files are disposable output.

Production publishing is different from local preview.

The public/local Vibe64 repo should own the shared runtime config engine. The private `vibe64-online` repo should own hosted production deployment, because only Vibe64 Online has tenants, public URLs, custom domains, Caddy routing, release containers, and rollback.

The production deployment system in `vibe64-online` must be completed properly and changed to use the new shared runtime config architecture. It must not keep a separate environment-variable system.

For JSKIT specifically:

> JSKIT owns env shape. Vibe64 owns env values. `.env` is generated output.

For v1, do not implement `.env` import. If a non-generated `.env` exists, back it up and overwrite it with a generated file.

The dashboard must have a Runtime Config UI. Only user-owned values are editable. Vibe64-managed values are read-only.

Vibe64 Online must also have a visible Publish dashboard section. That section should remain private-online-only.

## Incident That Caused This

The remote project `beepollen` on `root@vibe64.dev` was an older Vibe64 project that later became a JSKIT app.

Its preview failed with:

```text
DB_CLIENT is required. Set DB_CLIENT or DATABASE_URL.
```

The active session was:

```text
/srv/vibe64/tenants/mercmobily/projects/beepollen/sessions/active/2026-06-21_08-54-03
```

The worktree was:

```text
/srv/vibe64/tenants/mercmobily/projects/beepollen/sessions/active/2026-06-21_08-54-03/source
```

Root cause:

- JSKIT launch ran database migrations.
- `knexfile.js` loaded dotenv from `.env`, then resolved DB config from process env.
- Project root `.env` did not exist.
- Worktree `.env` did not exist.
- Vibe64's JSKIT adapter only copied project root `.env` into the worktree if it existed.
- Therefore migrations had no `DB_CLIENT`, `DATABASE_URL`, or DB connection details.

After DB values were restored, preview failed again with:

```text
APP_PUBLIC_URL is required to build password reset links.
```

Then it became clear that the app also needed managed Supabase JSKIT auth values:

- `APP_PUBLIC_URL`
- `JSKIT_AUTH_MODE`
- `JSKIT_AUTH_PROVIDER`
- `JSKIT_AUTH_SOURCE`
- `JSKIT_AUTH_SUPABASE_PROJECT_REF`
- `JSKIT_AUTH_SUPABASE_URL`
- `JSKIT_AUTH_SUPABASE_PUBLISHABLE_KEY`
- `JSKIT_AUTH_ENVIRONMENT`

The remote managed Supabase state was healthy under:

```text
/srv/vibe64/tenants/mercmobily/state/app-auth/supabase.json
```

but launch preview did not pass those values into the app container.

## Remote Fix Applied To beepollen

On the remote server, the project root and active worktree both received a complete `.env` with:

- managed MariaDB values
- `APP_PUBLIC_URL=http://localhost:3000`
- managed Supabase JSKIT auth values

Files updated:

```text
/srv/vibe64/tenants/mercmobily/projects/beepollen/.env
/srv/vibe64/tenants/mercmobily/projects/beepollen/sessions/active/2026-06-21_08-54-03/source/.env
```

Both were owned by `mercmobily:mercmobily` and set to mode `0600`.

The active launch container was restarted and verified:

```text
http://127.0.0.1:4100/home        -> 200
http://127.0.0.1:3000/api/bootstrap -> 200
http://127.0.0.1:3000/api/session   -> 200
```

This fixed beepollen, but it was a one-off remote recovery. The design below is the general fix.

## Important Online Deployment Discovery

After the first plan was written, the `~/vibe64/vibe64-online` repository was inspected.

That repository does contain the production publishing system.

Important files:

```text
/home/merc/vibe64/vibe64-online/packages/private-online-deployments/src/server/service.js
/home/merc/vibe64/vibe64-online/packages/private-online-deployments/src/server/deploymentEnvironment.js
/home/merc/vibe64/vibe64-online/packages/private-online-deployments/src/server/deploymentRunner.js
/home/merc/vibe64/vibe64-online/packages/private-online-deployments/src/server/deploymentStore.js
/home/merc/vibe64/vibe64-online/packages/private-online-deployments/src/server/caddyRouteMaterializer.js
/home/merc/vibe64/vibe64-online/packages/private-online-deployments/src/server/publishPlans.js
/home/merc/vibe64/vibe64-online/packages/private-online-core/src/client/app/pages/app/[slug]/dashboard/publish/index.vue
/home/merc/vibe64/vibe64-online/packages/private-online-core/package.descriptor.mjs
```

Current private route:

```text
/app/project/:slug/dashboard/publish
```

The deployed server was checked too.

Facts from `root@vibe64.dev`:

- `/opt/vibe64/current/packages/private-online-core` exists
- `/opt/vibe64/current/packages/private-online-deployments` exists
- the private package descriptor includes `/app/project/:slug/dashboard/publish`
- active tenant services such as `vibe64@mercmobily.service` are running
- the generated dashboard placement file does not include a Publish link

That explains why the online system is not visible in the deployed dashboard:

- the Publish route exists
- the private component exists
- the deployment API exists
- but the dashboard menu only contains Configure, Run, Github repository, Session History, and Setup
- there is no private dashboard placement/link for Publish

So the system is present but not surfaced properly.

Also important: it appears to be unused or barely used. Do not assume it is complete just because the files exist.

## Local Code Fix Already Made In This Session

A repo-side fix was made so launch preview containers receive the project runtime env that Vibe64 already computes.

Files changed:

```text
packages/studio-terminal-core/src/server/launchTargetTerminal.js
packages/studio-terminal-core/src/server/terminalSessions.js
tests/server/launchTargetTerminal.unit.test.js
tests/server/terminalSessions.unit.test.js
```

What changed:

- `startTerminalSession()` now resolves `env` before `args`.
- Resolved env is passed into args, commandPreview, and metadata callbacks.
- Launch target Docker args now include env from the resolved launch env.
- Command preview redacts env keys matching secret patterns such as password, token, key, secret, credential, and pwd.

Tests run:

```text
node --test tests/server/launchTargetTerminal.unit.test.js
node --test tests/server/terminalSessions.unit.test.js
```

Both passed.

Important: this repo-side code fix was not hot-patched into `/opt/vibe64/current` on the live server. The remote project works because its `.env` was manually regenerated. The code fix should ship through the normal deploy path.

## The Design Decision

We do not want `.env` to be source of truth.

We also do not want one env implementation for JSKIT, another for Next.js, another for generic Node, another for Laravel, and so on.

The agreed design:

> One generic runtime config engine. Each adapter supplies only a tiny profile.

This solves both problems:

- shared implementation for env value handling
- adapter-specific materialization paths and requirements

Updated architecture:

> Public/shared Vibe64 owns runtime config. Vibe64 Online owns production deployment. Vibe64 Online must consume runtime config instead of inventing its own env resolver.

This is not optional. If online publishing keeps its separate `deploymentEnvironment.js` model, dev preview and production publish will drift.

## Strong Rules

1. Vibe64 owns runtime values.
2. Adapters describe runtime shape.
3. `.env` and similar files are generated compatibility artifacts.
4. Generated env files are not user-owned.
5. Generated env files are overwritten by Vibe64.
6. Vibe64 never reads `.env` to decide runtime config in normal operation.
7. No `.env` import in v1.
8. If a non-generated `.env` exists, back it up and write a generated file.
9. Only user-owned runtime config values are editable in the dashboard.
10. Vibe64-owned values are read-only in the dashboard.
11. The same resolved values must be used for both process env injection and file materialization.
12. Production publishing lives in `vibe64-online`, not public/local Vibe64.
13. Vibe64 Online deployment environment rows must come from the shared runtime config model.
14. Vibe64 Online deployment state is structured hosting state, not env config.

## Product Boundary: Public Vibe64 vs Vibe64 Online

There are two different products:

- public/local Vibe64: local editor, sessions, worktrees, previews, terminals, setup, adapter workflows
- Vibe64 Online: hosted tenants, authenticated users, managed project catalog, production publishing, public URLs, custom domains, Caddy routing, releases

The public/local Vibe64 repo should include:

- generic runtime config engine
- adapter runtime config profiles
- dotenv materializer
- worktree env file materialization
- terminal env injection
- preview launch env injection
- local/dev Runtime Config dashboard UI
- dev/readiness checks

The public/local Vibe64 repo should not include:

- hosted Publish page
- public-name reservation
- custom-domain verification
- Caddy route generation
- on-demand TLS decisions
- hosted release manifests
- hosted rollback
- tenant service lifecycle

Reason:

"Deploy" has no complete product meaning in local Vibe64.

Local Vibe64 can build, run, preview, migrate, seed, and verify. It does not know which hostname should route to the app, which tenant owns the release, how Caddy should route it, what custom domains are verified, or how production releases should be rolled back.

Those are Vibe64 Online concerns.

The shared runtime config engine should still support a `deploy` phase, but only Vibe64 Online should turn that phase into a hosted production product.

## Current Vibe64 Online Deployment System

The current online system has these responsibilities:

- reserve public Vibe64 URLs
- change public Vibe64 URLs
- add custom domains
- verify custom domains
- store deployment state under the project local root
- store global public-name and custom-domain registry records under the online system root
- generate Caddy snippets/fragments
- expose Caddy `/tls/ask` and route resolution endpoints
- generate publish plans from adapters
- build the app
- run migrations
- snapshot a release workspace
- start a release container
- health-check the release
- mark release as current
- roll back to previous published releases
- sync production app-auth redirect URLs from public names and custom domains

The existing online production environment resolver currently lives in:

```text
packages/private-online-deployments/src/server/deploymentEnvironment.js
```

It currently generates production values for:

- deployment public URL
- JSKIT managed MariaDB
- managed/manual Supabase app auth
- SMTP readiness status
- user-defined production environment overrides

This file overlaps heavily with the new runtime config engine.

Do not leave it as a parallel architecture.

## Required Vibe64 Online Refactor

Vibe64 Online should keep deployment state and release orchestration.

It should stop owning generic runtime env logic.

Keep in `vibe64-online`:

- `deploymentStore.js`
- public-name registry
- custom-domain registry
- DNS verification
- Caddy materialization
- publish route APIs
- publish page
- publish plan orchestration
- release manifests
- release container lifecycle
- rollback

Move or replace with shared runtime config engine:

- generated env entry model
- owner/editability model
- secret redaction
- required/missing checks
- production env groups
- production env overrides
- DB env value duplication
- app-auth env value duplication
- runtime config view model

The online package should contribute sources to the shared runtime config engine:

- deployment public URL source
- production managed database source
- production managed app-auth source
- production user override source
- optional deployment metadata source

Then online Publish should call the shared engine roughly like:

```text
resolve runtime config
  scope: prod
  phase: deploy / client-build / migrate / server
  adapter: configured adapter
  deployment context: public name, public URL, domains, release context
```

The resolved values should be used for:

- publish build
- publish migrate
- release container start
- production runtime config UI
- missing-value blockers
- redaction
- release environment snapshot

The deployment state should still be used for:

- Caddy route hosts
- Caddy upstream target
- TLS ask
- release history
- rollback
- public-name registry ownership
- custom-domain registry ownership

## Why Not Import `.env` In v1

Import sounds useful, especially for old projects, but it makes the system ambiguous before we fully understand requirements.

Problems with import:

- classification of unknown keys is hard
- preserving manual edits can accidentally make `.env` authoritative again
- stale secrets might be reintroduced
- import UI creates more scope
- merge behavior is subtle and risky

Decision:

For v1, do not parse or import `.env`.

Behavior:

- if `.env` is missing: write generated `.env`
- if `.env` has Vibe64 generated header: overwrite it
- if `.env` exists without Vibe64 generated header:
  - move it to `.env.vibe64-backup-<timestamp>`
  - write generated `.env`
  - report backup path in UI/logs

No parsing. No import. No classification. No merge.

## Why Always Generate, Not Generate If Missing

The user explicitly corrected the design from "if deleted, regenerate" to "always regenerate."

Reason:

If Vibe64 only regenerates when missing, `.env` can still drift. A stale value can remain forever and break preview, migrations, auth, or deploy.

Correct behavior:

```text
resolve runtime config
overwrite generated materialization files
inject same values into process env
run action
```

This should happen before worktree use, launch, command terminals, setup actions, and deploy prep.

For Vibe64 Online publishing, the equivalent is:

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

## `.env` Is Common, Not Universal

Most runtime configuration eventually becomes key/value strings.

Examples:

- Node `.env`
- Next `.env.local`
- Laravel `.env`
- Python dotenv files
- Docker env files
- shell exported env

But `.env` itself is not universal.

Therefore the abstraction is not "manage `.env`." The abstraction is "manage runtime config key/value records and materialize them through adapter profiles."

Adapters choose the materialization format:

- JSKIT: `.env`
- generic Node: `.env`
- Next.js: `.env.local`
- Laravel: `.env`
- Python: `.env` only if adapter opts in
- C++: probably no file by default

The engine stays generic.

## Internal Runtime Config Record

Use key/value records like:

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

Fields:

- `key`: env key
- `value`: string value, possibly secret
- `scope`: `dev` or `prod`
- `owner`: `vibe64`, `adapter`, or `user`
- `secret`: boolean
- `source`: where the value came from
- `requiredFor`: runtime phases that require it
- `materialize`: whether to write it into generated files
- `editable`: whether dashboard allows editing

## Owners

### `vibe64`

Vibe64-owned values are managed by Vibe64 and are read-only to users.

Examples:

- managed DB host
- managed DB port
- managed DB username
- managed DB password
- managed DB database name
- managed Supabase URL
- managed Supabase publishable key
- managed Supabase project ref
- preview auth bypass variables
- generated local app URL
- Vibe64 config helper paths

### `adapter`

Adapter-owned values are framework defaults or adapter-derived values.

Examples:

- a framework mode value
- a default local path
- a required non-secret default
- values inferred from adapter metadata

These are usually read-only unless explicitly designed otherwise.

### `user`

User-owned values are values Vibe64 cannot safely invent.

Examples:

- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- third-party API tokens
- product-specific external API credentials
- user-owned public config

Only user-owned values are editable in the dashboard.

## Scopes

Use:

- `dev`
- `prod`

Do not add more scopes unless there is a clear product need.

Preview uses dev values unless a future explicit preview scope is introduced.

Production values are used by Vibe64 Online publishing. The public/local Vibe64 UI may show prod config if useful, but it must not imply local Vibe64 can deploy by itself.

## Runtime Phases

Use phase tags to decide which values are required for each action:

- `install`
- `generate`
- `migrate`
- `seed`
- `server`
- `client-build`
- `preview`
- `deploy`

Example:

- DB keys are required for `migrate`, `seed`, `server`, `preview`
- a public frontend API URL may be required for `client-build`
- Stripe secret may be required for `server`, `preview`, `deploy`

`deploy` is a shared phase because the runtime config engine should understand it. The actual hosted deployment feature lives in Vibe64 Online.

## Generic Engine Responsibilities

The generic runtime config engine owns:

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

Adapters should not hand-write env files. They should call the engine.

The generic runtime config engine does not own hosted deployment state:

- public names
- custom domains
- DNS verification
- Caddy files
- release manifests
- release containers
- rollback

Those stay in Vibe64 Online.

## Adapter Profile

Adapters provide a small declarative profile:

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

The profile supplies:

- adapter id
- generated file targets
- materialization format
- how to discover required env keys
- adapter-specific source hints

It should not supply custom file-writing logic unless absolutely necessary.

## Shared Dotenv Materializer

Most adapters use the same dotenv materializer.

Responsibilities:

- write `KEY=value`
- deterministic order
- quote/escape values as needed
- include generated header
- set mode `0600` if secrets are present
- handle unmanaged-file backup
- write to project root and worktree path

Generated header should be stable and recognizable:

```env
# Generated by Vibe64.
# Do not edit. Changes will be overwritten.
# Configure user-owned values in Vibe64 Runtime Config.
```

## Generated File Behavior

For every materializer target:

1. Resolve target path.
2. If file missing, write generated file.
3. If file has Vibe64 header, overwrite generated file.
4. If file exists without Vibe64 header:
   - rename to `<path>.vibe64-backup-<timestamp>`
   - write generated file
   - return/report backup path

Never parse the unmanaged file in v1.

Never merge manual edits.

Never silently preserve unknown keys.

## Dashboard UI

Add a Runtime Config screen to the project dashboard.

The UI must show:

- Dev config
- Prod config
- key name
- owner
- source
- secret/public flag
- missing/required status
- phases that require it
- generated file targets
- last generated time
- active worktree sync status

Only values with `owner: "user"` are editable.

Read-only rows:

- Vibe64-managed database values
- Vibe64-managed Supabase values
- adapter-derived defaults
- generated preview/runtime values

Editable rows:

- user-owned secrets
- user-owned public config
- user-owned dev/prod overrides

Secret UI:

- mask secret values by default
- controlled secret input for editing
- never print saved secrets in logs
- never show secrets in command previews
- consider never revealing saved secret values after save

Dashboard actions:

- save user runtime config
- regenerate runtime files
- sync active worktrees
- show missing required values
- copy key name

No import action in v1.

For Vibe64 Online, the Publish page must also show production runtime config using the same view model.

Online Publish UI requirements:

- add the missing dashboard placement/menu link for Publish
- keep the route private-online-only
- show public URL
- reserve/change public name
- add and verify custom domains
- show DNS records needed for verification
- show production services
- show production runtime config groups
- allow editing only user-owned production values
- show managed production values as read-only
- block Publish when required production runtime config is missing
- show current release
- show release history
- support rollback
- show app-auth redirect sync status when public URL/domain changes matter

## Process Env Injection

Generated files are compatibility artifacts. Process env injection is the real runtime path.

The same resolved config map must be injected into every process Vibe64 starts:

- Codex terminal
- shell terminal
- command terminal
- preview launch container
- setup doctor action
- dependency install command
- migration
- seed
- deploy command in Vibe64 Online

This prevents `.env` from being the only runtime path.

## Security Concern With Docker

Current code often uses `docker run -e KEY=value`. Even if UI redacts command previews, process argv can reveal secrets to users with process access.

For v1, redaction in previews is required.

This applies to both:

- public/local preview launch containers
- Vibe64 Online publish build/migrate/release containers

Longer-term improvement:

- use a secure env file mounted/read by Docker
- pass `-e KEY` while setting parent process env
- use Docker API-style env passing instead of shell command text
- avoid logging raw command lines containing secrets

This does not block v1 but should be remembered.

## JSKIT-Specific Contract

Under Vibe64:

- JSKIT declares required env keys.
- JSKIT does not own real managed values.
- JSKIT generators should not need DB passwords or Supabase keys.
- Runtime commands receive env from Vibe64.
- If JSKIT writes `.env`, Vibe64 overwrites it from resolved runtime config.

Outside Vibe64:

- JSKIT can keep standalone `.env` behavior.

Important phrase:

> JSKIT owns env shape. Vibe64 owns env values.

## Existing JSKIT Metadata To Use

JSKIT apps may already have metadata in `.jskit/lock.json` describing env changes. For beepollen, `.jskit/lock.json` had an entry for:

```text
APP_PUBLIC_URL
```

with value:

```text
http://localhost:3000
```

This was a clue that `APP_PUBLIC_URL` belongs in generated runtime config.

The JSKIT adapter should use JSKIT metadata to discover env requirements where available, but should resolve values from Vibe64.

## Managed Database Values

For JSKIT managed MariaDB, values are already known by the adapter/runtime:

- `DB_CLIENT=mysql2`
- `DB_HOST=vibe64-mariadb`
- `DB_PORT=3306`
- `DB_USER=root`
- `DB_PASSWORD=<managed root password>`
- `DB_NAME=<project-derived database name>`

The database name is based on target root/project name, normalized.

These are Vibe64-owned values and read-only in UI.

## Managed Supabase Values

Managed Supabase values come from Vibe64 managed app-auth state.

Keys:

- `JSKIT_AUTH_MODE=managed_supabase`
- `JSKIT_AUTH_PROVIDER=supabase`
- `JSKIT_AUTH_SOURCE=vibe64-managed`
- `JSKIT_AUTH_SUPABASE_PROJECT_REF=<ref>`
- `JSKIT_AUTH_SUPABASE_URL=https://<ref>.supabase.co`
- `JSKIT_AUTH_SUPABASE_PUBLISHABLE_KEY=<publishable key>`
- `JSKIT_AUTH_ENVIRONMENT=dev`

These are Vibe64-owned values and read-only in UI.

The publishable key is not a service-role key, but still should be treated carefully and redacted by generic secret-key patterns.

## APP_PUBLIC_URL

`APP_PUBLIC_URL` is required by JSKIT Supabase auth to build password reset and auth redirect links.

For v1 local dev materialization, use:

```text
APP_PUBLIC_URL=http://localhost:3000
```

There is an open design question for preview-specific/public URL:

- materialized file may contain local app URL
- launch runtime env may override it with actual preview URL later
- managed Supabase redirect sync should use the correct public preview/prod URLs

Do not overcomplicate this in v1 unless necessary.

For production in Vibe64 Online, `APP_PUBLIC_URL` should be generated from deployment state:

```text
APP_PUBLIC_URL=https://<public-name>.users.vibe64.dev
```

If a verified custom domain is selected as the primary production domain in the future, `APP_PUBLIC_URL` should use that primary domain.

The source of truth is online deployment state, not `.env`.

## Lifecycle Hooks

Materialization should run before:

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
materialize session source env files
start terminal/preview
```

Do not copy `.env` from project root to session source as truth.

## Previous Source Prepare Behavior To Replace

Previous JSKIT source prepare hook copied `.env`:

```sh
if [ -f "$VIBE64_TARGET_ROOT/.env" ] && [ ! -e "$VIBE64_SOURCE_ROOT/.env" ]; then
  cp -p "$VIBE64_TARGET_ROOT/.env" "$VIBE64_SOURCE_ROOT/.env"
fi
```

This should be replaced by runtime config materialization.

The new behavior should not depend on existing project root `.env`.

## Suggested Implementation Order

1. Create a new runtime config module, probably under a shared server package.
2. Define runtime config record types and validation helpers.
3. Define owner/source/scope/phase constants.
4. Implement resolver composition.
5. Implement dotenv materializer.
6. Implement generated header detection.
7. Implement unmanaged-file backup.
8. Implement project-root materialization.
9. Implement worktree materialization.
10. Add JSKIT runtime config profile.
11. Resolve JSKIT DB values through existing JSKIT adapter/database runtime code.
12. Resolve managed Supabase values through `managedAppAuthService.projectEnvironment()`.
13. Resolve JSKIT metadata/default values such as `APP_PUBLIC_URL`.
14. Thread runtime config materialization into JSKIT worktree prepare.
15. Thread runtime config materialization before launch preview.
16. Thread runtime config materialization before command/shell/Codex terminal start.
17. Add dashboard service endpoint for runtime config view model.
18. Add dashboard UI.
19. Add user-owned value persistence.
20. Add missing-value blocking behavior.
21. In `vibe64-online`, refactor deployment environment resolution to use the shared runtime config engine.
22. In `vibe64-online`, keep deployment state, Caddy routing, public names, custom domains, releases, and rollback in the online deployment package.
23. In `vibe64-online`, add the missing dashboard placement/menu link for Publish.
24. In `vibe64-online`, update Publish UI production env rows to use the shared runtime config view model.
25. In `vibe64-online`, make publish build/migrate/release containers use shared resolved prod env.
26. In `vibe64-online`, preserve app-auth redirect sync from public-name/custom-domain state.

## Suggested Tests

Add focused tests for:

- JSKIT preview works when `.env` is absent before launch.
- JSKIT migrate works when `.env` is absent before command.
- Worktree creation writes generated `.env`.
- Existing generated `.env` is overwritten.
- Existing unmanaged `.env` is backed up and replaced.
- Unmanaged `.env` is not parsed or imported.
- Project root and active worktree receive the same generated values.
- Managed DB values appear as read-only in runtime config model.
- Managed Supabase values appear as read-only in runtime config model.
- User-owned values appear editable in runtime config model.
- Missing user-owned required value blocks relevant phase.
- Secret values are redacted in command previews.
- Launch container receives resolved env.
- Materialization order is deterministic.
- Vibe64 Online Publish route is visible from dashboard navigation.
- Vibe64 Online production runtime config uses the shared runtime config view model.
- Vibe64 Online production `APP_PUBLIC_URL` comes from deployment public URL.
- Vibe64 Online production Supabase values come from prod managed app-auth state.
- Vibe64 Online production DB values are read-only Vibe64-managed runtime config entries.
- Vibe64 Online user production overrides are editable only as user-owned values.
- Vibe64 Online publish blocks on missing required production values.
- Vibe64 Online build/migrate/release containers receive shared resolved prod env.
- Vibe64 Online Caddy route generation still uses deployment state, not env variables.

## Open Questions

### Where should user-owned values be stored?

Likely in Vibe64 project-local config/secret storage, with dev/prod separation.

Need to decide:

- file storage format
- secret encryption or permission model
- whether secrets can be revealed after save
- how to sync to remote deployments

### Should production values ever be materialized to `.env`?

Default should be no unless explicitly required. Production secrets should not be casually written into project files.

Possible approach:

- dev materialization to `.env`
- prod values stored in Vibe64 only
- deploy flow injects prod values without writing project file

For Vibe64 Online, the default should be process/container injection from the shared runtime config result. Do not write production secrets into the target project root.

### What is the exact public URL model?

For local dev, `APP_PUBLIC_URL=http://localhost:3000` is fine.

For preview, Vibe64 may know a public preview URL through launch proxy.

For production, Vibe64 Online deployment state owns the public URL.

Need to decide which scope owns which URL and whether launch env overrides generated `.env`.

Known production rule:

- public-name state produces the default production URL
- verified custom domains can become route hosts
- if a primary custom domain feature is added, that primary domain should produce production `APP_PUBLIC_URL`

### Should JSKIT stop writing `.env` under Vibe64?

Ideally yes. Under Vibe64, JSKIT should declare env requirements and let Vibe64 resolve/write values.

But Vibe64 can tolerate current JSKIT behavior by overwriting `.env` after JSKIT runs.

### How to avoid Docker argv secret leakage?

Current fix redacts command previews, but raw `docker run -e KEY=value` can still expose secrets in process args.

Long-term, use safer env passing.

## Explicit Things Not To Do

- Do not build per-adapter `.env` writers.
- Do not make `.env` the source of truth.
- Do not import `.env` in v1.
- Do not silently preserve manual `.env` edits.
- Do not hard-code project-specific values.
- Do not put Vibe64-managed values in Git.
- Do not require JSKIT generators to receive DB passwords or Supabase keys unless the command truly runs runtime behavior.
- Do not treat missing user secrets as something Vibe64 can invent.
- Do not add hosted Publish/product deployment UI to public/local Vibe64.
- Do not keep `vibe64-online` deployment env as a separate long-term env architecture.
- Do not model custom domains as env variables.
- Do not make Caddy routing depend on `.env`.

## Success Criteria

The system is working when:

- Deleting `.env` does not break JSKIT preview.
- Stale `.env` values cannot break preview.
- Worktrees always get fresh generated runtime files.
- Dashboard shows all runtime config with clear ownership.
- Users can edit only user-owned values.
- Managed DB and managed Supabase values are visible as read-only source-backed values.
- Vibe64-launched commands and previews receive the same config that is materialized.
- Secret values do not appear in command previews.
- Old unmanaged `.env` files are backed up, not imported or merged.
- Vibe64 Online Publish is visible in the hosted dashboard.
- Vibe64 Online publish uses the shared runtime config engine for production env.
- Vibe64 Online still owns production deployment state and routing.
- Vibe64 Online production public URL/domain changes sync auth redirects.

## Final North Star

`.env` should become boring.

It should be a printed view of Vibe64 runtime config, not a place where truth lives.

If a user deletes it, Vibe64 recreates it.

If a user edits it, Vibe64 overwrites it.

If an adapter needs a different format, the same engine writes that format.

The product concept is runtime config, not `.env`.

The hosted product concept is Publish, and that belongs in `vibe64-online`.

Publish should be powered by the same runtime config engine, not by a second env system.
