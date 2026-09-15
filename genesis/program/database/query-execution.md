# Session SQL execution and cancellation

Manual SQL and database Copilot queries use the selected session's database
connection and share one query-ownership boundary.

## Sources

- `packages/vibe64-database-tools/src/server/service.js`
- `packages/vibe64-database-tools/src/server/queryExecutor.js`
- `packages/vibe64-database-tools/src/server/sqlPolicy.js`
- `packages/vibe64-database-tools/src/server/databaseDialect.js`

## Public contract

Database copilot embeds the shared JSKIT conversation element. Its adapter maps
SQL and table metadata into message actions, keeps configuration hidden and
server-owned, and uses its existing bounded schema/read-only query backend.
Copilot history remains transient in the database workspace; it is not copied
into the main project conversation.

SQL execution requires the session's canonical database-tool connection and,
when a hosted user is present, owner access. It accepts one statement at a time.
Read-only execution uses the reader endpoint and a read-only transaction;
manual write execution requires the existing unlock and confirmation checks.
Copilot SQL remains read-only and uses the same execution owner as manual SQL.

A query id belongs to one session and is reserved before connection acquisition.
A second query with that id in the same session is rejected while the first is
pending or running. Acquisition failure releases the reservation so the id can
be retried. Another session may independently use the same id.

Cancel targets the exact session and query id. Before a connection is available,
it returns `cancelled: false` without discarding the pending query's ownership.
After acquisition it asks the database driver to cancel that connection's query.
An acknowledged cancellation is not proof that execution has settled. A failed
cancellation leaves the same query available for retry. Execution cleanup removes
only its own reservation and releases its acquired connection.

Service close makes a best-effort cancellation request for queries that already
have connections. It does not abort pending connection acquisition or prevent
that pending work from subsequently executing.

## Implementation map

`executeSessionQuery()` resolves the current session query map when SQL starts,
including SQL requested after a Copilot provider turn. `executeDatabaseQuery()`
owns reservation, connection acquisition, transaction cleanup and connection
release. The reservation gains its cancellation callback only after acquisition;
it does not retain a second copy of connection metadata.
