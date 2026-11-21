# Write the Staging data section

The `## Staging data` section of a project's `genesis/stack.md` says what the
project's Staging database holds: a database of Staging's own, empty or built
from a copy of production's data, or production's database itself. A project
without the section has its own empty Staging database.

## Who writes it

The section is part of the project's source. In a session, ask the coding agent
in the session's chat to write or change it, for example "Give Staging a
sampled copy of production's data: keep the last 90 days of orders". The agent
reads the exact grammar with `vibe64-helper spec staging-data` and writes the
section and the dump command it needs. Review
the change and **Save** the session as usual.

Which mode Staging uses is your decision: it decides whether Staging holds
production's data, or uses production's database itself. The agent drafts a
recipe for you to review, but never chooses a copy or a shared mode on its own.

Colleague can explain the modes and the recipe and help you choose; the
section itself is written in a session.

## Choose a mode

The section starts with the database and the mode, each on its own line:

```markdown
## Staging data

- Database: `database`
- Mode: own copy, empty
```

`- Database:` names the database in the Stack's `## Resources` by its id, in
backticks. It is usually `database`, the id **Add a service** gives a MySQL or
PostgreSQL database. Only a MySQL or PostgreSQL database can have Staging data;
a SQLite database, Redis or a files bucket is refused.

`- Mode:` is one of these phrases, written exactly, without backticks:

| Mode | Staging's database |
| --- | --- |
| `own copy, empty` | Its own, and empty: the Deployment's Migrate step makes its tables. This is what a project without the section has. |
| `own copy, full` | Its own, built from a whole copy of production's database. |
| `own copy, sampled` | Its own, built from part of production's data, chosen by a recipe in the section. |
| `shared with production` | Production's database itself. Nothing is copied, and what Staging changes, production has. |
| `shared with production, structure frozen` | Production's database itself, and Staging never changes its structure. |

- Choose an empty copy when Staging can start with no data, such as an app
  whose first account sets it up.
- Choose a full copy when production's data is small enough to copy whole.
- Choose a sampled copy when production's data is too big to copy, but Staging
  needs real data to check against.
- Choose shared only when Staging must work on production's own data. A host
  treats a Migrate on a shared Staging as a migration of production's database,
  because it is one.
- Choose shared with its structure frozen when production's database must never
  change shape from Staging: a host runs no Migrate on Staging at all, so the
  code you publish to Staging must work with production's tables as they are.

A host never copies production's data into Staging over a live connection, and
Staging never connects to production's database in an own copy.

## The dump command

A full or sampled copy is built from a dump of production's database that the
app's own command writes. Name it in a `- Source:` line:

```markdown
- Source: dump written by command with `nodejs` in `.`: `node` `scripts/production-dump.js` `{dump}`
```

- After `with` come the runtimes the command needs, then the folder it runs in,
  then the command and each of its arguments, each in its own backticks, as in
  the Stack's other commands.
- `{dump}` is the file the command writes the dump to. The host chooses the file
  and puts its path there. Pass `{dump}` exactly once, as an argument of its
  own: `--output` `{dump}` works, `--output={dump}` is refused. No other
  `{...}` placeholder is allowed.
- The host runs the command with the settings it gives the app's Staging.
  There, the database's own settings, such as `DB_HOST` and `DB_PASSWORD`,
  name Staging's own database, so the command reads how to reach production's
  dump, or production's database, from settings of its own, such as
  `PRODUCTION_DUMP_URL`, which the person adds to Staging's settings. Keep
  credentials out of the command line.
- The dump is one of these:
  - for MySQL or MariaDB: SQL text, as `mariadb-dump` or `mysqldump` writes
    it, plain or gzip-compressed, of one database's tables. Dump the database
    by name, never with `--databases` or `--all-databases`, which make the dump
    create its own database.
  - for PostgreSQL: `pg_dump`'s custom format, `pg_dump -Fc`.
- The programs the command runs, such as `mysqldump` or `pg_dump`, must be
  available where it runs: name them in the Deployment's Packages, as for any
  program a Deployment step runs.

An empty copy and the shared modes have no Source; the section refuses one.

## A sampled copy's recipe

A sampled copy also says, for each table, which rows Staging keeps. Put the
rules under `### Tables`:

```markdown
- Unlisted tables: all up to `10000` rows

### Tables

- `countries`: all
- `jobs`: recent by `created_at`, last `180` days
- `job_events`: recent by `id`, newest `200000` rows
- `messages`: recent by `sent_at`, last `90` days, newest `50000` rows
- `sessions`: none
```

- `all` keeps every row; `none` keeps the table empty, with its structure.
- `recent by` a column keeps the rows of the last `n` days by that column (1 to
  36500 days), the newest `n` rows by it (1 to 100000000), or both, in that
  order: the newest `n` rows of the last `n` days.
- `- Unlisted tables: all up to` `n` `rows` (1 to 10000000) is required: a table
  the rules don't name is copied whole while it has at most that many rows. A
  bigger one needs a rule of its own.
- Name each table once. Table and column names are letters, digits and `_`, up
  to 64, starting with a letter or `_`, each in backticks.

A host keeps the copy whole: every row a kept row refers to is kept too,
through the database's own foreign keys. Two more headings cover what the
foreign keys don't say:

```markdown
### Links

- `jobs.vessel_id` to `vessels.id`

### Keep together

- `invoices` keeps every `invoice_lines` row by `invoice_id`
```

- `### Links` names a column that refers to another table's column without a
  foreign key saying so, as `table.column` to `table.column`. The rows it
  refers to are kept like those of a foreign key. Name each column once.
- `### Keep together` goes the other way: for every kept row of the first table,
  every row of the second whose column refers to it is kept too, such as an
  invoice's lines. The column is the second table's. Name each table and column
  pair once.

Both are optional. A host loads the copy with the database's constraint checks
on, and checks after that no kept row refers to a row it left out.

## Contacts

A full or sampled copy holds real people's email addresses and phone numbers.
Name every column that holds one under `### Contacts`:

```markdown
### Contacts

- `users.email`: email
- `users.mobile`: phone
```

A host replaces those columns' values in Staging's copy with made-up ones, the
same at every build, so nothing Staging sends reaches a real person. When no
column holds one, write the heading with the one entry `- Nothing.`. A full or
sampled copy without `### Contacts` is refused, so a copy never leaves contacts
out by accident.

Only a full or sampled copy has `### Contacts`, and only a sampled copy has
`### Tables`, `### Links`, `### Keep together` and Unlisted tables. Headings
come after the Database, Mode, Source and Unlisted tables lines, in any order,
each once.

## A whole sampled section

```markdown
## Staging data

- Database: `database`
- Mode: own copy, sampled
- Source: dump written by command with `nodejs` in `.`: `node` `scripts/production-dump.js` `{dump}`
- Unlisted tables: all up to `10000` rows

### Tables

- `countries`: all
- `jobs`: recent by `created_at`, last `180` days
- `sessions`: none

### Links

- `jobs.vessel_id` to `vessels.id`

### Keep together

- `invoices` keeps every `invoice_lines` row by `invoice_id`

### Contacts

- `users.email`: email
- `users.mobile`: phone
```

A full copy is shorter:

```markdown
## Staging data

- Database: `database`
- Mode: own copy, full
- Source: dump written by command with `nodejs` in `.`: `node` `scripts/production-dump.js` `{dump}`

### Contacts

- Nothing.
```

## When the section is refused

A section Vibe64 can't read is refused as a whole: the message names the line
of the section, says what is wrong and ends with
`Exact grammar: vibe64-helper spec staging-data.` Ask the coding agent to fix
it, or fix that line yourself. The most common ones:

- **declares no Staging data**: the section holds only `- Nothing.`. Declare a
  mode, or remove the section to give Staging its own empty database.
- **needs a Mode** or **Unknown Staging data Mode**: write one of the five
  phrases exactly.
- **builds Staging's own database from a dump of production's: add - Source:
  ...**: a full or sampled copy needs its dump command.
- **must pass `{dump}`**, **passes `{dump}` inside** or **has the placeholder**:
  pass `{dump}` once, as an argument of its own.
- **has no Source**, **has no Unlisted tables** or **has no `### Tables`**: the
  mode doesn't take that line or heading; remove it, or choose the mode that
  does.
- **add `### Contacts`**: a copy names its contact columns, or says `- Nothing.`.
- **declares no resource** or **is a ... resource**: the Database line names a
  resource the Stack doesn't have, or one that isn't a MySQL or PostgreSQL
  database. Name the database's id from `## Resources`.

When and how a host builds or refreshes Staging's copy, and what it asks of you
before a shared Staging migrates, are in the host's own guides.
