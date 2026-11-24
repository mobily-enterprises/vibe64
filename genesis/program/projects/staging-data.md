# Interpret Staging data

Vibe64 turns a project's opaque Stack `Staging data` section into an exact,
machine-readable statement of what Staging's database holds, and for a copy of
production's data the recipe a host builds it by, without AI interpretation or
schema guessing.

## Sources

- `packages/vibe64-genesis/src/server/index.js`
- Main: `packages/vibe64-genesis/src/server/stagingData.js`
- `packages/vibe64-genesis/src/server/stackOperation.js`
- `packages/vibe64-genesis/src/server/agentSpecs.js`

## Public contract

`inspectVibe64StagingData()` asks Genesis for the exact composed Stack section
named `Staging data` and for the Stack's environment inspection in parallel,
validates the section under the Vibe64-owned `vibe64.staging-data.v1` contract
and checks it against the Stack's declared resources. `parseVibe64StagingDataLines()`
validates the lines alone, without the resource check, and
`vibe64StagingDataInspection()` is the pure step that binds them.
`STAGING_DATA_MODES` maps each mode phrase to its name and
`STAGING_DATA_ENTRY_FORMS` lists every entry form, which the section's agent
spec (`vibe64 spec staging-data`) prints.

An absent section is `unconfigured`: Staging has its own empty database, mode
`empty`. A Genesis diagnostic, such as two components proposing the section,
is `blocked`, and the section is not read. Otherwise every refusal throws
`VIBE64_STAGING_DATA_INVALID` at `genesis/stack.md#Staging data`, naming the
line of the section it is about and the expected form; a refusal never becomes
a diagnostic, as in Deployment. A section of only `- Nothing.` is refused: it
declares a mode, or is left out.

## Grammar

The section's own entries come first, each at most once:

- `` - Database: `id` `` (always) names the database resource of the Stack's
  `## Resources` whose Staging data this is. The inspection refuses an id the
  Stack does not declare, and a resource whose kind is not `mysql` or
  `postgresql`, naming the Stack's database resources or saying it has none.
- `- Mode: <phrase>` (always), exactly one of `own copy, empty`,
  `own copy, full`, `own copy, sampled`, `shared with production` and
  `shared with production, structure frozen`.
- `- Source: production backup` says the host takes production's dump itself,
  from the backups of the database it runs production with, written exactly so:
  any other words are refused, naming both forms. Or
  `` - Source: dump written by command with `runtime` in `workdir`: `command` ... ``
  is the Integration setup command shape, read by the same helpers. Its
  arguments pass `{dump}` exactly once, as an argument of its own, and no other
  `{name}` placeholder. One Source, of either form, is required for a full or
  sampled copy, and refused otherwise.
- `` - Unlisted tables: all up to `n` rows `` (1 to 10000000). Required for a
  sampled copy, refused otherwise.

Then the headings `### Tables`, `### Links`, `### Keep together` and
`### Contacts`, each at most once, in any order; any other heading is refused.
Tables, Links and Keep together are a sampled copy's alone, and Tables is
required there with at least one entry. Contacts is required for a full or
sampled copy, with entries or the one entry `- Nothing.`, and refused for the
other modes. A heading with no entries is refused.

- Tables: `` - `table`: all ``, `` - `table`: none `` or
  `` - `table`: recent by `column` `` followed by `` , last `n` days `` (1 to
  36500), `` , newest `n` rows `` (1 to 100000000), or both in that order. A
  table at most once.
- Links: `` - `table.column` to `table.column` ``, a column that refers to
  another without a foreign key saying so; a from-column at most once, never
  itself.
- Keep together: `` - `parent` keeps every `child` row by `column` ``, the
  column being the child's; parent and child differ, and a (child, column) pair
  at most once.
- Contacts: `` - `table.column`: email `` or `` - `table.column`: phone ``; a
  column at most once.

Table and column names are `[A-Za-z_][A-Za-z0-9_]{0,63}` in backticks;
`table.column` joins two with one dot.

## Normalized result

The inspection returns `contract`, `status` (`ready`, `unconfigured` or
`blocked`), `stackHash`, `recipeHash`, `source`, `components` and
`diagnostics`, with the recipe: `database` (`""` unless ready), `engine` (the
named resource's kind, `mysql` or `postgresql`, or `""`), `mode` (`empty`,
`full`, `sampled`, `shared` or `frozen`), `dumpSource` (`{ productionBackup:
true }`, `{ argv, workdir, runtimeRequirements }` or `null`), `unlistedTables` (`{ maxRows }` or `null`),
`tables` (`{ table, rule: "all" | "none" }` or `{ table, rule: "recent", by,
days, rows }`, a missing number `null`), `links` (`{ from: { table, column },
to: { table, column } }`), `keepTogether` (`{ parent, child, column }`) and
`contacts` (`{ table, column, kind }`), each list in the section's order.
`recipeHash` is `stackOperationHash` of the recipe and its version, `""` unless
ready: blank lines, the order of headings and entries' places in the Stack do
not change it; every rule, number, name, the Source and the engine do.

## What each mode asks of a host

- An own copy is a database of Staging's own. `own copy, empty` starts it
  empty, and the Deployment's Migrate makes its structure. For `own copy, full`
  and `own copy, sampled` a host runs the Source command with the settings it
  gives the app's Staging (where the database's own settings name Staging's
  database, so the command reaches production's dump through settings of its
  own), and builds Staging's own database from the one dump file it writes to
  `{dump}`; Staging never connects to production's database. The dump is SQL text from `mariadb-dump` or
  `mysqldump`, plain or gzip-compressed, of one database's tables (not
  `--databases`), for `mysql`, and `pg_dump -Fc` custom format for
  `postgresql`.
- A sampled copy keeps each table's rows by its rule, copies a table the recipe
  doesn't list whole while it has at most Unlisted tables' rows, keeps every row
  a kept row refers to, through the database's foreign keys and the Links, and
  for every kept parent row the child rows Keep together names. A host loads
  the copy with the database's constraint checks on and checks for orphans
  after.
- In a full or sampled copy a host replaces each Contacts column's values with
  made-up ones, the same at every build, so that Staging reaches no real person.
- `shared with production`: Staging uses production's database itself and
  nothing is copied; a host treats a Migrate on Staging as a migration of
  production's database.
- `shared with production, structure frozen`: as shared, and a host runs no
  Migrate on Staging at all.

Genesis does not know what Staging data means; it transports the section's
exact text. Vibe64 reads no database and infers no recipe from the selected
technologies: the application owns the dump command, and the person owns the
mode.

## Implementation map

- `parseVibe64StagingDataLines()` — validates the consumer-owned section without the Stack's resources.
- `vibe64StagingDataInspection()` — binds the parsed recipe to the exact Stack and its database resource.
- `inspectVibe64StagingData()` — reads the section and the environment inspection from one Stack.
