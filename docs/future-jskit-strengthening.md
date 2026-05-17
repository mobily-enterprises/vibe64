# Future JSKIT Strengthening

This note records planned JSKIT adapter configuration. These values are not wired into runtime behavior yet.

The immediate goal is to make the future choices explicit without adding more moving parts while the JSKIT adapter is still being stabilized.

## Planned Adapter Config Values

Store each value as a single file under:

```text
.ai-studio/config/
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
- `mysql`: the JSKIT target should use the JSKIT MySQL runtime.
- `postgres`: the JSKIT target should use the JSKIT Postgres runtime.

### `jskit_tenancy_mode`

Allowed values should match JSKIT's own tenancy vocabulary.

Current expected values:

```text
none
single
multi
```

Meaning:

- `none`: no tenant model should be introduced.
- `single`: the app uses a single-tenant model if JSKIT supports that exact mode.
- `multi`: the app uses a multi-tenant model if JSKIT supports that exact mode.

Before implementation, confirm the exact JSKIT generator/runtime terms and use those terms verbatim.

## What These Values Will Affect

### Scaffold

The JSKIT scaffold command should eventually use these values when creating an app from an empty directory.

Affected area:

```text
server/lib/aiStudio/adapters/jskit/setupTargetChecks.js
```

Expected future behavior:

- `jskit_tenancy_mode` drives the JSKIT app generator tenancy flag.
- `jskit_database_runtime` drives the database/runtime package choice if JSKIT exposes that as a generator option.
- If JSKIT does not expose a direct generator option, the adapter should not invent one. It should call official JSKIT commands only.

### Setup Doctor

The JSKIT setup doctor should verify the target matches the selected values.

Affected areas:

```text
server/lib/aiStudio/adapters/jskit/setupDoctorPlugin.js
server/lib/aiStudio/adapters/jskit/setupTargetChecks.js
server/lib/aiStudio/adapters/jskit/setupMysqlRuntime.js
```

Expected future behavior:

- For `jskit_database_runtime=none`, fail or warn if database runtime packages/config are present unexpectedly.
- For `jskit_database_runtime=mysql`, require the expected JSKIT MySQL runtime package/config and managed MySQL readiness.
- For `jskit_database_runtime=postgres`, require the expected JSKIT Postgres runtime package/config and managed Postgres readiness.
- For `jskit_tenancy_mode`, verify the target metadata/config indicates the selected tenancy mode.

### Prompt Context

JSKIT prompts should include the selected values so Codex does not invent the wrong architecture.

Affected area:

```text
server/lib/aiStudio/adapters/jskit/adapter.js
```

Expected future prompt facts:

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
server/lib/aiStudio/adapters/jskit/prompts/
```

Expected future behavior:

- Database advice is specific to the selected runtime.
- Tenancy advice is specific to the selected tenancy mode.
- No generic prompt should recommend database or tenancy infrastructure that contradicts these config values.

### Runtime Services

Runtime service checks should eventually support both MySQL and Postgres.

Affected area:

```text
server/lib/aiStudio/adapters/jskit/setupTargetChecks.js
```

Current status:

- The JSKIT setup path has MySQL-specific code.
- Postgres should not be added by copying MySQL code blindly.
- The adapter should first define a small runtime-service boundary, then add MySQL/Postgres implementations behind it.

## Explicit Non-Goals For Now

- Do not implement these config values yet.
- Do not add a generic adapter config framework yet.
- Do not change scaffold behavior yet.
- Do not change setup doctor behavior yet.
- Do not add Postgres support yet.
- Do not change JSKIT prompts yet.

This document is only a map for future JSKIT adapter strengthening.
