# Stack piece: jskit-postgresql

## Description

JSKIT PostgreSQL runtime, live-schema CRUD generation, and persistence conventions.

## Requires

- `jskit`
- `postgresql`

## Conflicts

- `jskit-mysql`

## Environment defaults

- Default `DB_CLIENT`: `pg`

## Resources

```json genesis-resource
{
  "id": "database",
  "kind": "postgresql",
  "environmentAlternatives": [
    {
      "bindings": {
        "database": "DB_NAME",
        "host": "DB_HOST",
        "password": "DB_PASSWORD",
        "port": "DB_PORT",
        "username": "DB_USER"
      },
      "allowEmpty": ["password"],
      "preferred": true
    },
    {
      "bindings": {
        "url": "DATABASE_URL"
      }
    }
  ],
  "optionalBindings": {
    "browserTestDatabase": "BROWSER_TEST_DB_NAME",
    "testDatabase": "TEST_DB_NAME"
  }
}
```

## Adoption

- Confirm that the application's effective PostgreSQL environment alternatives
  and driver match this Resource declaration; add a project Resource contract
  when the existing application legitimately differs.
- Verify from source that the database preparation path discovers every
  package-owned migration, preserves the existing ledger, orders cross-package
  constraints safely, and invokes an app-owned idempotent seed. Do not execute
  it during adoption.

## Guidance

- Use the application-owned JSKIT database preparation command only after the
  app implements it. Record that exact command in the project's Workspace
  setup and Deployment contracts when database preparation is part of those
  operations; do not copy a command that the application does not provide.

- Apply the inherited JSKIT integration guidance to `integrations.json`.
  Keep connection/payment records in the app's selected database through its
  existing migration and transaction owner. Test scoped uniqueness, duplicate
  webhooks and concurrent credit debits on this driver before claiming database
  correctness; provider calls and app authorization remain outside the database.
- Sanity checks with JSKIT and PostgreSQL: the jskit and postgresql pieces'
  checks apply.

## Deslop

- Use the installed JSKIT database runtime and generated resource/repository
  seams; do not add a second client, connection factory, CRUD transport, or
  file-persistence fallback.
- Keep environment normalization, transactions, row mapping, and database
  error translation at one established persistence boundary.
- Never compete with or rewrite a generator-owned baseline migration. Preserve
  retained migration history and data semantics.

## Data pass

- Apply the PostgreSQL part of JSKIT's data pass page at
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/data-pass#postgresql`:
  concurrent index builds in a migration without a transaction, constraints
  added `NOT VALID` and validated afterwards on large tables, and
  `EXPLAIN (ANALYZE, BUFFERS)` on the test database at realistic size.
