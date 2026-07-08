# Adapter-Owned Hosted Config Plan

## Problem

Vibe64 currently knows too much about app-specific hosted configuration. Supabase
auth, JSKIT app auth setup, and JSKIT database/runtime details have leaked into
Vibe64-level setup and management surfaces.

That is the wrong ownership boundary. Vibe64 is an editor/runtime shell that can
host many kinds of projects. A C++ project, Laravel project, plain Node project,
or JSKIT project should not inherit Supabase setup as a Vibe64 concern.

The same applies to app database configuration. Vibe64 can provide hosted
runtime services, secrets, and settings plumbing, but the meaning of "this app
uses MySQL" or "this app uses Supabase auth" belongs to the adapter.

## Target Ownership

Vibe64 owns:

- project/session/runtime shell
- project catalog and access
- generic hosted settings surface
- generic secret storage and retrieval
- generic long-running action/job plumbing
- hosted service roots and daemon/runtime container lifecycle
- workspace-wide SMTP only if it remains broadly useful outside one adapter

Adapters own:

- adapter-specific hosted config schema
- adapter-specific settings sections
- adapter-specific settings actions and flows
- adapter-specific seeding behavior
- adapter-specific runtime/env materialization
- adapter-specific readiness and error messages

For JSKIT, this means JSKIT owns:

- auth provider choice: local by default, Supabase optional
- Supabase PAT/project/redirect setup
- Supabase config consumed by seeding
- JSKIT database runtime selection
- JSKIT MariaDB app config expectations

## Product Model

New JSKIT projects should start simple.

Default auth:

```json
{
  "auth": {
    "provider": "local"
  }
}
```

Supabase is optional. If Supabase config is absent, seeding uses local
username/password auth and does not prompt for Supabase.

Supabase-backed auth is selected only when the adapter config explicitly says so:

```json
{
  "auth": {
    "provider": "supabase",
    "supabase": {
      "projectRef": "...",
      "url": "https://example.supabase.co",
      "anonKey": "...",
      "serviceRoleKeySecretRef": "...",
      "redirectsSyncedAt": "..."
    }
  }
}
```

The Supabase PAT should not become ordinary project runtime config. Store it as
an adapter-owned secret and reference it from adapter state only when future
management actions need it.

## Hosted Config Surface

Vibe64 should expose hosted config as a generic adapter settings surface, not as
hard-coded Vibe64 forms.

Adapters provide settings sections:

```js
{
  sections: [
    {
      id: "auth",
      title: "Authentication",
      fields: [],
      actions: [
        {
          id: "configure-supabase",
          kind: "flow",
          label: "Configure Supabase",
          status: "not_configured"
        }
      ]
    }
  ]
}
```

Vibe64/JSKIT renders the frame:

- section layout
- fields
- action buttons
- modal/drawer frame
- loading/error/done states

The adapter owns the action behavior.

## Settings Actions

Do not build a large generic wizard framework. Add a small settings action
protocol.

Adapter flow handler shape:

```js
{
  id: "configure-supabase",
  start(context),
  submitStep(context, stepId, payload),
  status(context),
  cancel(context)
}
```

Initial generic step types should be limited to:

- `form`
- `choices`
- `progress`
- `done`
- `error`

That is enough for Supabase without turning adapter settings into a second app
framework.

Example form step:

```js
{
  type: "form",
  step: "pat",
  title: "Supabase token",
  fields: [
    {
      name: "pat",
      type: "password",
      label: "Personal access token"
    }
  ]
}
```

Example progress step:

```js
{
  type: "progress",
  step: "syncing",
  message: "Configuring Supabase redirects..."
}
```

## Supabase Flow

The JSKIT adapter should own the Supabase flow:

1. Validate/store Supabase PAT as an adapter secret.
2. Fetch available organizations/projects.
3. Let the user choose an existing project or create one.
4. Resolve Supabase URL, anon key, service-role secret reference, and project ref.
5. Sync redirect URLs using hosted deployment/preview URLs.
6. Optionally apply workspace SMTP if present and if JSKIT/Supabase terms and
   product behavior allow it.
7. Save adapter config with `auth.provider = "supabase"`.
8. Mark flow ready.

If any required Supabase config is missing while `auth.provider = "supabase"`,
JSKIT seeding should fail with an adapter readiness error. Vibe64 should not
special-case that failure.

## MariaDB Config

Vibe64 may own the daemon-level MariaDB service lifecycle. JSKIT owns what that
means to a JSKIT app.

Correct boundary:

- Vibe64/studio-terminal runtime can provide a daemon-scoped managed MariaDB
  container and service data root.
- JSKIT adapter decides whether a JSKIT target uses the MariaDB runtime.
- JSKIT adapter names or maps project databases.
- JSKIT adapter materializes app env/config for MySQL.
- Vibe64 does not expose "MariaDB app config" as a generic Vibe64 setting.

Invariant:

```text
one daemon service root + jskit/mariadb/data = one JSKIT MariaDB container
```

Projects and sessions should not get separate MariaDB containers for the shared
JSKIT service. They should get separate app databases/config as needed.

## Seeding Behavior

Seeding should consume adapter config, not ask Vibe64 for provider-specific
answers.

For JSKIT auth:

- missing auth config: use local auth
- `auth.provider = "local"`: use local auth
- `auth.provider = "supabase"` with complete Supabase config: generate
  Supabase-backed auth
- `auth.provider = "supabase"` with incomplete Supabase config: fail with a
  JSKIT adapter readiness error

For JSKIT database:

- missing database config: use JSKIT defaults
- configured MariaDB runtime: use JSKIT adapter materialization for
  managed MariaDB
- no Vibe64-level MariaDB form should be required

## Migration Plan

1. Add adapter-owned hosted config contracts.
2. Add generic settings action endpoints and UI frame.
3. Move JSKIT Supabase status/config reads behind the JSKIT adapter.
4. Make local auth the JSKIT default when Supabase config is absent.
5. Move Supabase PAT handling out of Vibe64 Online management forms.
6. Keep workspace SMTP as a generic hosted setting only if still useful beyond
   Supabase.
7. Reimplement Supabase setup as a JSKIT adapter settings flow.
8. Update JSKIT seeding to consume adapter config.
9. Remove Vibe64-level Supabase-specific forms/routes once the adapter flow is
   complete.

## Tests

Practical tests should prove behavior, not implementation trivia:

- JSKIT project with no Supabase config seeds local auth.
- JSKIT project with complete Supabase config seeds Supabase auth.
- JSKIT project with incomplete Supabase config fails with adapter-owned error.
- Vibe64 project creation does not require Supabase.
- C++ or non-JSKIT project setup never sees Supabase requirements.
- Supabase PAT is stored as an adapter secret, not ordinary project env.
- Managed SMTP can be read by the JSKIT Supabase flow without making Supabase a
  Vibe64 setup dependency.
- JSKIT MariaDB app config is produced by the JSKIT adapter.

## Non-Goals

- Do not build a generic visual wizard framework.
- Do not make Vibe64 understand Supabase organizations, PATs, projects, or
  redirect APIs.
- Do not require Supabase for JSKIT.
- Do not require Supabase for Vibe64.
- Do not move daemon service lifecycle into JSKIT app code.

## Decision

Vibe64 should host adapter settings, but adapters should own adapter config.

Supabase and JSKIT MariaDB app setup move out of Vibe64 product setup and into
JSKIT adapter-owned hosted config. Local auth becomes the default JSKIT path.
Supabase becomes optional configuration that seeding uses only when present.
