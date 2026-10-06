# Session SQL execution and cancellation

Manual SQL and database Copilot queries use the selected session's database
connection and share one query-ownership boundary.

## Sources

- `packages/vibe64-core/src/server/actionContext.js`
- `packages/vibe64-database-tools/src/server/actions.js`
- `packages/vibe64-database-tools/src/server/assistantContracts.js`
- `tests/server/vibe64DatabaseActionTools.unit.test.js`
- `tests/server/databaseTools.unit.test.js`
- `packages/vibe64-database-tools/src/server/inputSchemas.js`
- `packages/vibe64-database-tools/src/server/registerRoutes.js`
- `tests/server/vibe64DatabaseActionDispatch.unit.test.js`

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

All thirteen database HTTP operations invoke their named actions. Those actions
own the input contract, including required session/query identities and explicit
read-only/confirmation fields. The shared host context resolves project access
and the acting person for HTTP and automation; request bodies cannot choose an
actor or override the session in the URL. Services retain query ownership,
confirmation, conflict and mutation checks. Conflict responses retain their
existing HTTP status. These action contracts do not expose SQL, row editing or
schema investigation as Colleague tools; Colleague delegates engineering work.

Colleague can use the existing state-read, schema-refresh and query-cancel actions.
Their assistant presentations whitelist database identity, development scope,
schema object/schema counts and refresh time. State includes at most 50 current
query reservations with exact ID, read-only flag, start time and whether the
cancellation callback is available; total count and truncation are explicit.
Names are bounded to 512 characters. SQL, rows, full schema, connection credentials,
layout and workspace contents remain outside these tool results. Native service
failures retain a bounded code with a generic message directing the person to
Database; raw driver errors remain in the normal UI result. HTTP retains its full
result, with added runtime query metadata.

State can inspect and save the normal schema snapshot on its first read; later
reads may use that snapshot. An explicit refresh uses the existing reader metadata
inspection and snapshot/event path. Neither result proves application readiness
or a freshly verified connection. Query activity is limited to manual and Copilot
SQL owned by this project/session, not coding agents or other database clients.
It is derived from the executor's existing reservation map, with no new persistence.
Cancellation uses that same map and current project/session authority; success
acknowledges the driver request, not settled execution, rollback or undone changes.


Database copilot uses the bounded-task mode of JSKIT's supplied conversation
binding and the shared element. The original HTTP command owns admission,
pending state and errors; JSKIT owns the moved local draft, ordered request
history, submission and late-result fence. Vibe64 supplies the existing endpoint,
input/final-row mappings, captured table and SQL result placement. It keeps
configuration hidden and server-owned and uses the same bounded schema/read-only
backend. Copilot history remains transient in the mounted workspace, with no
canonical chat receipt or live subscription. It is not copied into Main history.
Session hydration clears history but retains the draft; hiding the panel does not
cancel an admitted question. Modifier-Enter submits, while ordinary Enter adds a
line. The same command exception remains visible without automatic resend.

`runDatabaseAssistant()` delegates the original response-count and abort ordering
and the structured reply/tool protocol to JSKIT's `runBoundedAssistantToolLoop()`.
It permits four completed responses, each with the existing 90-second Helper
deadline; SQL execution stays outside that response timer. A response may finish
the answer or request one schema/read-query operation. Operation four completes
and its result is bounded before the original limit error; no fifth response or
automatic recovery is attempted. Vibe64 supplies database instructions, a final
answer schema and its two authorized actions. It retains schema and SQL
permissions, result summaries, failure presentation and cleanup.
The scoped Helper runner enters the same JSKIT runtime's original
`runScopedTurn()` coordinator and retains one native conversation across responses.
JSKIT derives closed final-or-tool response alternatives from that final schema
and the existing action catalogue, validates the completed response, selects and
executes one action through `createConversationTools()`, and constructs the next
untrusted-result prompt. Vibe64 no longer parses an action envelope or builds
result prompts. The existing strict schema validator bounds the largest
alternative within the unchanged Helper profile; it does not add their sizes.
The private catalogue closes over the admitted schema and reader function; it is
not exposed to HTTP, general automation or native Helper tools. Native tools stay
disabled. The action callbacks retain original lookup/read order, summaries and
result bounds and return data. Strict execution retains the safe in-memory call
result then rethrows the original host exception, with no additional response.
This explicit transient mode creates no authored turn, durable tool journal or
restart replay. The existing parent cleanup artifact and query reservation owner
remain the only application lifetime authorities. Canonical JSKIT tool consumers
continue requiring their durable reservation and result writes.

Database access follows the host's project membership policy independently of
AI access. Members can inspect schema, browse data, arrange diagrams and run
manual SQL using the session's canonical database-tool connection. It accepts
one statement at a time.
Read-only execution uses the reader endpoint and a read-only transaction;
manual write execution requires the existing unlock and confirmation checks.
Copilot SQL remains read-only and uses the same execution owner as manual SQL.
Copilot resolves the workflow's Helper assignment for the submitting user before
inference. It may use a shared model in another orchestrator while the main chat
remains on the owner's personal model. Its availability and model label describe
that resolved destination, including Shared backup. Disabling Helper does not
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
separate Junior task; it does not use Copilot's Helper availability.

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
