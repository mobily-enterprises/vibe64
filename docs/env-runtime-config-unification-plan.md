# Env And Runtime Config Unification Plan

## Version

This is a version 0 plan.

Version 0 is allowed to break existing env/runtime-config storage, routes,
names, and UI behavior.

There is no backwards compatibility requirement.

There must be:

- no compatibility shims
- no dual-read transition layer
- no old route names kept for convenience
- no old UI names kept for familiarity
- no legacy storage wrapping just to avoid migration

Affected real projects will be migrated by hand:

- `matt/beepolled`
- `sas/dogandgroom`
- `sas/compas-next`
- `sas/racing`

## Decision Summary

Vibe64 should have one user-facing Env surface.

The core model is:

```text
project + environment + key = resolved value
```

The user-facing environments are:

```text
dev
prod
```

There is no user-facing `phase`, `requiredFor`, or separate production env
concept.

Runtime config remains the underlying resolved model. `.env` files and similar
files remain generated framework/runtime artifacts.

## Root Cause

Vibe64 currently has two env-like systems:

- Public Vibe64 Runtime Config, shown at `/dashboard/runtime-config`.
- Vibe64 Online Deployment Env, shown at `/dashboard/env`.

They are backed by different stores:

- Runtime Config user values live under `runtime-config/user-values.json`.
- Online deployment env overrides live under `deployments/environment.json`.
- Online deployment secrets live in provider-owned secret storage.

The UI makes both screens look like places to add environment variables. This
means a value such as `HOME_ASSISTANT_AI_API_KEY` can be present on the online
deployment Env screen but missing from Runtime Config, even though the user
reasonably thinks both screens are editing the same app environment.

The deeper issue is ownership drift:

- Runtime Config owns dev/session/setup/preview/migrate/server values.
- Deployment Env owns hosted production values.
- Both systems independently resolve runtime-shaped records.
- The user has to understand an internal split that should not exist.

## Goals

- Present one Env page for normal users.
- Resolve env records on demand from providers and user overrides.
- Keep dev and prod as the only user-visible environment scopes.
- Derive public/private visibility from adapter key-name rules.
- Keep `.env` generation, but treat generated files as outputs, not truth.
- Replace the old split model without compatibility shims.
- Make online production deployment consume the same Env model.
- Keep advanced generated-file diagnostics available without competing with Env.

## Non-Goals

- Do not import arbitrary existing `.env` files in v0.
- Do not make users choose public/private visibility manually.
- Do not expose phase-level runtime details in the normal UI.
- Do not remove generated `.env` support.
- Do not build compatibility shims for existing stored values.
- Do not keep old Env/Runtime Config route, API, component, or UI names.
- Do not move Vibe64 Online deployment ownership into the public repo.

## Vocabulary

### Env Record

One generated/resolved key for one project/environment.

An Env Record is resolver output. It is generated on demand from stored user
values, provider state, adapter rules, deployment state, and app requirements.
It is not stored as-is.

```js
{
  key: "HOME_ASSISTANT_AI_API_KEY",
  value: {
    present: true,
    preview: "********",
    secret: true
  },
  source: "user",
  required: true
}
```

The public API must never return raw secret values.

The active environment is normally implied by the endpoint or selected tab.
If a multi-environment response is needed, include `environment`; otherwise do
not repeat it on every row.

Fields that should not be stored in the Env Record:

- `visibility`: derived from the adapter's public key naming rules.
- `sourceLabel`: derived from `source`.
- `status`: derived from `required` and `value.present`.
- `editable`: derived from write policy, usually `source === "user"`.
- `owner`: avoid unless a provider genuinely needs a separate owner concept.

### Stored Truth

Stored data should be smaller than generated Env Records.

User value storage should contain only durable user input and secret metadata,
for example:

```js
{
  key: "HOME_ASSISTANT_AI_API_KEY",
  environment: "prod",
  secret: true,
  value: "real-secret-value"
}
```

If secret custody lives outside the project file, store a secret reference
instead of the raw value:

```js
{
  key: "HOME_ASSISTANT_AI_API_KEY",
  environment: "prod",
  secret: true,
  secretRef: "provider-owned-secret-id"
}
```

Provider/computed values, such as managed auth URLs or deployment public URLs,
are not stored as Env Records. They are generated from provider state when Env
is resolved.

Required-but-missing values come from explicit requirements, not from stored
resolved rows:

```js
{
  key: "HOME_ASSISTANT_AI_API_KEY",
  environment: "prod",
  source: "assistant_contract",
  required: true,
  secret: true
}
```

### UI Presentation

The UI may display labels, actions, and statuses, but those are presentation
derived from the generated Env Record plus adapter rules.

Examples:

- `visibility`: `Public` or `Server`, derived from the key name.
- `source label`: `Managed Auth`, `User`, `Deployment URL`, derived from
  `source`.
- `status`: `Present`, `Missing`, or `Empty`, derived from value presence.
- `actions`: edit/remove/read-only, derived from write policy.

### Environment

The user-visible target.

- `dev`: used for local sessions, preview, setup, migrations, and dev servers.
- `prod`: used for hosted production build/deploy/runtime.

### Provider

A provider contributes records or requirements to the resolved Env model.

Examples:

- adapter
- Vibe64 defaults
- managed auth
- managed database
- deployment URL
- assistant/app-declared required keys
- user overrides

Providers are resolved on demand. They do not write a flattened resolved table
as source of truth.

### Visibility

Whether a key is browser-public or server-only.

Visibility is derived from the adapter's key naming convention.

Examples:

- Vite/JSKIT frontend: `VITE_*` is public.
- Next.js: `NEXT_PUBLIC_*` is public.
- SvelteKit/Astro: `PUBLIC_*` is public.
- Server-only adapters: no public keys unless declared by the adapter.

Users do not choose visibility manually.

### Source

Where the value comes from.

Examples:

- User
- Adapter Default
- Managed Auth
- Managed Database
- Deployment URL
- Vibe64

`Generated` is a source/category, not a status.

### Status

Whether the value currently resolves.

Allowed user-facing statuses:

- `present`
- `missing`
- `empty`

`read-only` is editability, not status.

## Target User Surface

The normal dashboard surface should be:

```text
Env
```

It should have two tabs:

```text
Dev | Production
```

The main table should show:

```text
Key | Value | Visibility | Source | Status | Actions
```

Example rows:

```text
APP_PUBLIC_URL                 https://racing.sas.users.vibe64.dev   Server   Deployment URL     Present   read-only
VITE_SUPABASE_URL              https://example.supabase.co            Public   Managed Auth       Present   read-only
AUTH_SUPABASE_URL              https://example.supabase.co            Server   Managed Auth       Present   read-only
HOME_ASSISTANT_AI_API_KEY      ********                               Server   User               Present   edit/remove
HOME_ASSISTANT_AI_PROVIDER     openai                                 Server   User               Present   edit/remove
```

The Add form should live only on Env:

```text
Key
Value
Secret checkbox
Add
```

There should be no `Required for` picker.

If a public-prefixed key is marked secret, the UI/server should reject it or
show a hard validation error. A key that is public by adapter convention is
intentionally exposable to browser code.

## Runtime Config UI

The current Runtime Config page should stop competing with Env.

Preferred outcome:

- Remove Runtime Config from the normal dashboard nav.
- Keep an advanced diagnostics view only if useful.

If kept, rename it to something like:

```text
Env Diagnostics
```

Diagnostics can show:

- generated file targets
- sync state
- last materialized time
- adapter contributor details
- raw records
- missing provider records

Diagnostics must not have a generic Add env form.

## Server Model

Add a shared Env resolver in the public Vibe64 codebase.

Conceptual API:

```js
async function resolveProjectEnv({
  projectContext,
  environment
}) {
  return {
    environment,
    records,
    generatedFiles,
    unavailable,
    diagnostics
  };
}
```

The resolver should:

1. Load committed project config where dashboard/project state needs source
   shape.
2. Ask the selected adapter for env metadata and public key rules.
3. Ask Vibe64 providers for managed values.
4. Ask online deployment providers for production-only values when running
   inside Vibe64 Online.
5. Read user overrides from the appropriate store.
6. Merge all records deterministically.
7. Compute visibility, status, editability, and public-safe previews.

The resolver should not:

- write generated files during a read
- persist resolved records as truth
- read arbitrary `.env` files as truth
- expose secret values over client APIs

## Provider Contract

Providers should return records and requirements in one shape.

Example:

```js
{
  id: "managed-auth",
  records: [
    {
      key: "VITE_SUPABASE_URL",
      value: "https://example.supabase.co",
      source: "managed_auth"
    }
  ],
  requirements: [
    {
      key: "HOME_ASSISTANT_AI_API_KEY",
      source: "assistant_contract",
      required: true,
      secret: true
    }
  ]
}
```

Requirements become missing records when no provider or user override supplies
a value.

The assistant/generator should declare app-specific required keys explicitly.
Vibe64 should not infer required env by scanning app code in v0.

## Merge Rules

Records merge by:

```text
environment + key
```

Precedence should be explicit and stable:

1. User override, when the key is user-editable or user-owned.
2. Online deployment override for `prod`, treated as a user override in the
   unified model.
3. Managed provider value.
4. Adapter default.
5. Requirement-only missing record.

Managed read-only records cannot be silently replaced by user values unless the
provider marks the key overridable.

Conflicts should produce diagnostics rather than silently choosing a surprising
value.

## Adapter Responsibilities

Each adapter owns env shape rules, not env storage.

Adapter contract should include:

```js
{
  publicEnvPrefixes: ["VITE_"],
  getEnvContributors(context) {},
  getGeneratedEnvTargets(context) {}
}
```

For a JSKIT/Vite-style app:

```text
public: VITE_*
server: everything else
```

For Next.js:

```text
public: NEXT_PUBLIC_*
server: everything else
```

For SvelteKit or Astro:

```text
public: PUBLIC_*
server: everything else
```

The adapter may map Vibe64-managed concepts into framework-specific public
names. For example, if the browser needs a public Supabase URL, the adapter
should expose the framework-correct public key rather than relying on a generic
server-only key.

## Env Naming Migration

Because visibility is derived from adapter key names, some existing variables
must be renamed in v0.

The migration rule is:

```text
If browser code reads it, use the adapter-public key convention.
If only server/setup/deploy/runtime code reads it, keep it server-only.
```

For JSKIT/Vite, browser-consumed values must use `VITE_*`.

Likely JSKIT candidates, if browser code reads them directly:

```text
APP_PUBLIC_URL                  -> VITE_APP_PUBLIC_URL
AUTH_PROVIDER                   -> VITE_AUTH_PROVIDER
AUTH_SUPABASE_URL               -> VITE_AUTH_SUPABASE_URL
AUTH_SUPABASE_PUBLISHABLE_KEY   -> VITE_AUTH_SUPABASE_PUBLISHABLE_KEY
```

If those values are only consumed by server code, setup commands, generated
server routes, or server-side bootstrap endpoints, they should keep server-only
names and should not be renamed just because their English name sounds public.

Do not public-rename server-only secrets or infrastructure values:

```text
DB_CLIENT
DB_HOST
DB_NAME
DB_PASSWORD
DB_PORT
DB_USER
DATABASE_URL
HOME_ASSISTANT_AI_API_KEY
```

`HOME_ASSISTANT_AI_PROVIDER` should also stay server-only unless generated
frontend code has a real browser need for it.

Do not emit both old and new names as a compatibility shim.

Only emit two names when they are genuinely different contracts for different
consumers. For example, a server auth integration could receive
`AUTH_SUPABASE_URL` while browser code receives `VITE_AUTH_SUPABASE_URL`, but
that must be an intentional adapter contract, not a transition alias.

Each adapter migration must audit current keys by consumer:

- browser bundle
- server runtime
- setup/generation commands
- deployment runner
- generated `.env` files

The result of that audit is the adapter's v0 env contract. Old public-looking
names are removed if they are not part of that contract.

## Storage Responsibilities

Storage remains provider-owned, but the user sees one model.

Because this is v0, storage names and locations may change. Do not keep
`runtime-config` or deployment-env storage paths just to preserve compatibility.
If an implementation keeps a current path, it must be because that path is the
clean owner after the rename, not because old projects need to keep working.

### Public Vibe64

Dev user overrides should be stored through the new Env-owned provider contract.
Do not expose or preserve `runtime-config/user-values.json` as a compatibility
contract.

### Vibe64 Online

Production user overrides should be stored through the new Env-owned provider
contract.

Production secret values may continue to use provider-owned secret storage,
because secret custody belongs outside browser-visible project files. That is
not a compatibility shim; it is the storage owner.

### Provider State

Managed auth, managed database, deployment URL, and other Vibe64-owned state
remain where they are. Their values are contributed at read/injection time.

## Generated Files

Keep `.env` generation.

Generated files are materialized outputs:

```text
resolved env -> generated files
resolved env -> injected process env
resolved env -> deployment runner env
resolved env -> diagnostics
```

Generated files should:

- be deterministic
- be overwritten from resolved Env
- have clear generated headers
- be excluded from source-of-truth reasoning
- be shown as synced/stale in diagnostics

Users should not be expected to edit generated `.env` files.

If a non-generated `.env` exists, v0 behavior should back it up and write a
generated file. Do not import arbitrary `.env` into the model in v0.

## API Plan

Add or adapt endpoints so both local Vibe64 and Vibe64 Online can use the same
contract.

Suggested public routes:

```text
GET /vibe64/env?environment=dev
GET /vibe64/env?environment=prod
PUT /vibe64/env/user-values
DELETE /vibe64/env/user-values/:key
POST /vibe64/env/materialize
```

The exact route names can follow existing JSKIT route conventions, but the
contract should be Env, not deployment-only env or Runtime Config user values.

Do not keep old runtime-config or deployment-env endpoint names as public API
aliases. Replace call sites instead.

The read endpoint returns public-safe records only.

The injection/materialization server path may request secret values internally,
but that must not use the browser-facing response contract.

## UI Plan

### Step 1: New Env Component

Create a reusable Env panel in the public repo.

Responsibilities:

- environment tabs
- records table
- add/edit/remove user values
- secret placeholder display
- visibility label derived from server data
- source/status labels
- diagnostics affordance

It should not know which provider-owned storage backs a record.

### Step 2: Local/Public Route

Point the public dashboard Env route at the new component.

Remove `/dashboard/runtime-config` from normal navigation. If diagnostics remain
available, expose them under a new Env Diagnostics name, not the old Runtime
Config name.

### Step 3: Online Route

Update Vibe64 Online `/dashboard/env` to use the shared component and shared
server contract. This route can remain because `Env` is the target user-facing
name.

Online-only deployment providers contribute `prod` records:

- deployment public URL
- custom domain/public host state
- production managed auth
- production managed database
- production user overrides

### Step 4: Navigation

Normal dashboard nav should show:

```text
Setup
Env
Publish
Release
Session History
```

`Runtime Config` should not appear as an editable normal user surface.

## Migration Plan

Migration is manual and project-specific.

There is no automatic compatibility migration, no dual-read path, and no shim
that makes old Runtime Config or deployment-env stores look like the new Env
contract.

For each real project:

1. Inspect the old Runtime Config values.
2. Inspect the old Vibe64 Online deployment env values.
3. Inspect provider-owned secret values if needed.
4. Create the new Env records explicitly.
5. Regenerate generated `.env` files from the new model.
6. Verify preview for `dev`.
7. Verify publish/deployed runtime for `prod`.
8. Delete or archive old env/runtime-config state so it cannot be mistaken for
   truth.

Projects to migrate by hand:

- `matt/beepolled`
- `sas/dogandgroom`
- `sas/compas-next`
- `sas/racing`

## Rollout Plan

### Phase 1: Contract And Resolver

- Add shared Env record types/helpers.
- Add provider merge logic.
- Add adapter public visibility rules.
- Add server tests for merge, visibility, status, and secret redaction.

### Phase 2: Replace Existing Stores

- Add the new Env storage/provider implementation.
- Move all write paths to the new Env contract.
- Remove old endpoint names and old UI names from call sites.
- Do not add compatibility aliases.

### Phase 3: UI Unification

- Build the shared Env panel.
- Replace Online Env page internals with unified Env records.
- Remove Runtime Config as an editable user surface.
- Add diagnostics-only generated file section.

### Phase 4: Runtime Consumers

- Update preview/session launch to inject resolved `dev` Env.
- Update migrations/setup to use resolved `dev` Env.
- Update publish/build/deploy runner to inject resolved `prod` Env.
- Update materializers to generate files from resolved Env.

### Phase 5: Cleanup

- Remove duplicated deployment env presentation code.
- Remove user-facing `requiredFor` controls.
- Remove old Runtime Config UI names from normal product flow.
- Remove obsolete tests for split behavior.
- Remove compatibility scaffolding if any was created during development.

## Verification Plan

### Unit Tests

Add tests for:

- deterministic provider merge order
- user override precedence
- read-only managed value protection
- missing requirement records
- secret redaction in public API
- public/private visibility from adapter prefixes
- public-prefixed secret rejection
- dev/prod store separation
- generated file target diagnostics

### Server Integration Tests

Use fixtures with:

- committed `.vibe64`
- active session source
- new Env user values
- provider-owned secret values
- managed auth state
- managed database state
- deployment public URL state

Assert:

- `dev` Env includes dev/session/runtime values.
- `prod` Env includes deployment and production provider values.
- production user values appear as normal `prod` records.
- dev user values appear as normal `dev` records.
- raw secrets are not returned to browser-facing APIs.
- production publish uses resolved `prod` values.
- preview/session launch uses resolved `dev` values.
- old Runtime Config and deployment-env stores are not read as shims.

### UI Tests

Add browser checks for:

- Env page loads with Dev and Production tabs.
- Adding a dev value appears in Dev only.
- Adding a production value appears in Production only.
- A `VITE_*` key is labeled Public for JSKIT/Vite.
- A non-public key is labeled Server.
- Managed auth values are read-only and present when configured.
- Missing assistant-declared keys appear as Missing.
- Runtime Config no longer exists as a competing editable surface.

### Manual Online Check

For a project like `racing`:

1. Open `/dashboard/env`.
2. Confirm `HOME_ASSISTANT_AI_API_KEY` and `HOME_ASSISTANT_AI_PROVIDER`
   appear under Production if saved there.
3. Open Dev and confirm the values only appear if configured for dev.
4. Confirm managed Supabase/Auth values appear with Managed Auth source.
5. Confirm deployment URL values appear with Deployment URL source.
6. Publish and verify production receives resolved prod env.
7. Launch preview and verify preview receives resolved dev env.

## Open Questions

1. Should the default Add form environment be `dev` or whichever tab is active?
2. Should production values be editable before a public deployment URL exists?
3. Should generated file diagnostics live on Env behind an expansion panel, or
   on a separate advanced route?
4. How should assistant/app-required env contracts be stored in source so they
   are committed and portable?

## Acceptance Criteria

- A user can explain Env as: "Dev affects preview/session; Production affects
  the published app."
- There is only one normal place to add environment values.
- `HOME_ASSISTANT_AI_*` cannot appear in one env UI but not the other due to
  split ownership.
- Public/private visibility is adapter-derived from key names.
- No user-facing phase/requiredFor picker remains.
- `.env` generation still works and is clearly derived output.
- Existing projects are migrated by hand; no compatibility shim is required.
- Vibe64 Online production deploy no longer owns a separate env concept.
- Old Runtime Config and deployment-env names are not kept as public UI/API
  names.
