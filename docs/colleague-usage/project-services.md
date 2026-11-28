# The AI and the project's servers

Where the host runs the project's servers (its database server, MariaDB or
PostgreSQL, a cache such as Redis, and the like), a session's AI reads them and
acts on them when the work needs it, with `vibe64-helper services`. It works on
the project's development by default, and with `--staging` on its Staging app,
only while you let AI sessions use the project's Staging.

- `vibe64-helper services list` shows each server's id, what it is, its state,
  and whether every project on the workspace shares it (a database server
  does).
- `vibe64-helper services logs <service> [--lines N]` shows its recent log
  lines, newest first: 100 unless `--lines` says how many, at most 2000.
- `vibe64-helper services restart|stop|start <service>` restarts, stops or
  starts it. A restart keeps its data; every connection to it drops and
  reconnects by itself. A server a running Staging app needs is not stopped.
  With `--staging`, `app` is the project's Staging app, which restarts the way
  the host's own Restart of it does; taking it offline stays yours.
- `vibe64-helper services db sessions` lists the connections on the session's
  own databases (its development and test databases, or with `--staging` the
  project's Staging database): each one's id, database, how long, its state with
  what it waits on, and the start of its statement.
- `vibe64-helper services db locks` shows which of them waits on which. A
  blocker on another project's database is only counted, never shown.
- `vibe64-helper services db end <id>` ends one of those connections. The host
  ends it only after checking it is on the session's own databases.
- `vibe64-helper services db restart` restarts the project's database server.

The AI never gets a database login or a password. The host reads and ends
connections itself, as its administrator, and gives the AI only the rows on the
session's own databases. It acts only on the servers its session's project uses,
and a restart or stop waits while a Staging operation (Publish to staging,
Restore, Repair or Take Staging offline, with its migration) runs.

## A server every project shares

A database server is shared by every project on the workspace, so a restart or
stop of it interrupts them all. The AI restarts or stops one only while its
session's **Need help** is raised, and never while real people use a Staging
app that depends on it. What it did is added to the session's Need help, so you
see it there.

## What the AI does, and when

When a statement waits on a lock that never clears (a schema change waiting on
a metadata or table lock, or a query holding rows for minutes), the AI:

1. finds the holder with `vibe64-helper services db locks`;
2. ends it with `vibe64-helper services db end <id>`;
3. looks again after a few seconds.

A MariaDB connection that stays `Killed` keeps its lock until the server
restarts. Only then, as the last resort, the AI raises Need help saying what it
will restart and why, and runs `vibe64-helper services db restart`.

## What you see

The AI's commands and their answers show in the session's chat as it runs
them. The host records each restart, stop, start and ended connection with the
session, the person it acted for, the server and the time, where the host shows
its people (on a hosted workspace, the owner's Workspace services card).

## Without a host

Where Vibe64 runs on your own computer it runs none of the project's servers:
the database server and any other server it uses are your own, reached with the
connection values in its Env. `vibe64-helper services list` says so, every other
command is refused with why, and the AI asks you before it restarts or stops one
of your servers. The app and its App Services run in Preview
(`vibe64-helper preview`).
