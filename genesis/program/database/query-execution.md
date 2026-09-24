# Session SQL execution and cancellation

Manual SQL and database Copilot queries use the selected session's database
connection and share one query-ownership boundary.

## Sources

- `packages/vibe64-database-tools/src/server/service.js`
- `packages/vibe64-database-tools/src/server/assistant.js`
- `packages/vibe64-database-tools/src/client/composables/useVibe64DatabaseTools.js`
- `packages/vibe64-database-tools/src/server/queryExecutor.js`
- `packages/vibe64-database-tools/src/server/sqlPolicy.js`
- `packages/vibe64-database-tools/src/server/databaseDialect.js`
- `packages/vibe64-database-tools/src/server/sqliteClient.js`
- `packages/vibe64-database-tools/src/server/sqliteWorker.js`
- `packages/vibe64-database-tools/src/server/schemaInspector.js`

## Public contract

Database copilot embeds the shared JSKIT conversation element. Its adapter maps
SQL and table metadata into message actions, keeps configuration hidden and
server-owned, and uses its existing bounded schema/read-only query backend.
Copilot history remains transient in the database workspace; it is not copied
into the main project conversation.

Database access follows the host's project membership policy independently of
AI access. Members can inspect schema, browse data, arrange diagrams and run
manual SQL using the session's canonical database-tool connection. It accepts
one statement at a time.
Read-only execution uses the reader endpoint and a read-only transaction;
manual write execution requires the existing unlock and confirmation checks.
Copilot SQL remains read-only and uses the same execution owner as manual SQL.
Copilot resolves the workflow's Economy assignment for the submitting user before
inference. It may use a shared model in another orchestrator while the main chat
remains on the owner's personal model. Its availability and model label describe
that resolved destination, including Shared backup. Disabling Economy does not
prevent browsing or manual SQL. A person can still prepare a question in main
chat when its separate approval workflow is available.

Each question runs under the session's existing admission lock, with one active
question per user. Its bounded schema/query loop uses one isolated helper scope
with no project environment, tools or database credentials. The database owner
retains that scope, selection, native IDs and profile in
`database/assistant-tasks/<actor>.json`; it stores no question, answer or query
results there. Cleanup must confirm native deletion before removing ownership
and the scope directory. Failed cleanup prevents another question for that actor
and remains retryable on session close after restart. A late native start after
Close is still retained and cleaned up. Closing never re-resolves a destination
or starts inference. Helper Stop cannot stop the main conversation.

The client caches database workspace state per actor, project and session, and
refreshes it when AI connections or routing change. Switching actors remounts
the transient Copilot view. AI generation of the project's Data overview is a
separate Code task; it does not use Copilot's Economy availability.

SQLite uses an explicitly declared persistent filename. Hosted resources provide
an absolute filename; standalone projects may resolve a relative filename from
their source root. Reader and writer connections target the same file, with
native read-only mode and a SQLite authorizer enforcing reader access. Both modes
reject attached databases and extension loading. Schema inspection reads tables,
views, columns, usable keys, indexes and foreign keys into the common browser and
ERD model. Generated columns and views are not offered as editable fields.

Each SQLite connection runs Node's native SQLite API in a child process. Native
queries do not block the editor event loop; timeout or cancellation terminates
that connection. The release bundles its worker explicitly. Manual query results
have the same row/byte bounds as other engines, and internal schema queries are
also bounded. This is file-backed SQLite support, not access to another process's
in-memory database or arbitrary attached files.

A query id belongs to one project/session and is reserved before connection acquisition.
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
have connections. Copilot cancellation also prevents later SQL and releases a
connection acquired after cancellation without executing a statement. Manual SQL
keeps its existing contract: close does not abort pending acquisition or prevent
that pending manual query from subsequently executing.

## Implementation map

`executeSessionQuery()` resolves the current session query map when SQL starts,
including SQL requested after a Copilot provider turn. `executeDatabaseQuery()`
owns reservation, connection acquisition, transaction cleanup and connection
release. The reservation gains its cancellation callback only after acquisition;
it does not retain a second copy of connection metadata.
