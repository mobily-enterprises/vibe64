# Future JSKIT Adapter Strengthening

This note records planned behavior for JSKIT adapter configuration that already
exists in Vibe64.

The current config screen can save these values and pass them into prompt and
adapter context. JSKIT seeding already uses the selected tenancy value. The
remaining work is to make JSKIT-specific database setup, doctor, and prompt
behavior actively use the selected values.

## Adapter Config Values

Store each value as a single file under:

```text
.vibe64/config/
```

### `jskit_database_runtime`

Allowed values:

```text
none
mysql
postgres
```

Meaning:

- `none`: the JSKIT target should not use a managed database runtime.
- `mysql`: the JSKIT target should use JSKIT's MySQL-compatible runtime backed by MariaDB in Studio.
- `postgres`: the JSKIT target should use the JSKIT Postgres runtime.

### `jskit_tenancy_mode`

Allowed values should match JSKIT's own tenancy vocabulary.

Current expected values:

```text
none
personal
workspaces
```

Meaning:

- `none`: no tenant model should be introduced.
- `personal`: the app uses JSKIT's personal tenancy mode.
- `workspaces`: the app uses JSKIT's workspace tenancy mode.

These values match the current `@jskit-ai/create-app --tenancy-mode` vocabulary.

## What These Values Will Affect

### Seed

The JSKIT seed command uses these values when creating an app from an empty directory.

Affected area:

```text
server/lib/vibe64/adapters/jskit/setupProjectChecks.js
```

Current behavior:

- `jskit_tenancy_mode` drives the JSKIT app generator tenancy flag.

Expected future behavior:

- `jskit_database_runtime` drives the database/runtime package choice if JSKIT exposes that as a generator option.
- If JSKIT does not expose a direct generator option, the adapter should not invent one. It should call official JSKIT commands only.

### Setup Doctor

The JSKIT setup doctor should verify the target matches the selected values.

Affected areas:

```text
server/lib/vibe64/adapters/jskit/setupDoctorPlugin.js
server/lib/vibe64/adapters/jskit/setupProjectChecks.js
server/lib/vibe64/adapters/jskit/setupMariaDbRuntime.js
```

Expected future behavior:

- For `jskit_database_runtime=none`, fail or warn if database runtime packages/config are present unexpectedly.
- For `jskit_database_runtime=mysql`, require the expected JSKIT MySQL-compatible runtime package/config and managed MariaDB readiness.
- For `jskit_database_runtime=postgres`, require the expected JSKIT Postgres runtime package/config and managed Postgres readiness.
- For `jskit_tenancy_mode`, verify the target metadata/config indicates the selected tenancy mode.

### Prompt Context

JSKIT prompts should include the selected values so Codex does not invent the wrong architecture.

Affected area:

```text
server/lib/vibe64/adapters/jskit/adapter.js
```

Expected prompt facts:

```json
{
  "jskit_database_runtime": "mysql",
  "jskit_tenancy_mode": "none"
}
```

Prompt guidance should then be specific:

- `none` database: do not introduce persistence unless the user explicitly asks.
- `mysql` or `postgres`: use the matching JSKIT runtime assumptions.
- `none` tenancy: do not introduce tenant boundaries.
- tenant-enabled modes: preserve tenant scoping rules everywhere.

### Deslop And Architecture Prompts

The JSKIT prompt pack should use these values when giving architecture/deslop instructions.

Affected area:

```text
server/lib/vibe64/adapters/jskit/prompts/
```

Expected future behavior:

- Database advice is specific to the selected runtime.
- Tenancy advice is specific to the selected tenancy mode.
- No generic prompt should recommend database or tenancy infrastructure that contradicts these config values.

### Runtime Services

Runtime service checks should eventually support both MariaDB-compatible JSKIT runtimes and Postgres.

Affected area:

```text
server/lib/vibe64/adapters/jskit/setupProjectChecks.js
```

Current status:

- The JSKIT setup path currently supports the MySQL-compatible runtime through MariaDB.
- Postgres should not be added by copying MariaDB code blindly.
- The adapter should first define a small runtime-service boundary, then add MariaDB/Postgres implementations behind it.

## Explicit Non-Goals For Now

- Leave Postgres setup doctor behavior untouched for now.
- Do not add Postgres support yet.
- Do not make JSKIT prompts enforce database or tenancy choices until the
  matching setup checks are also implemented.

This document is the map for the remaining JSKIT adapter strengthening work.
