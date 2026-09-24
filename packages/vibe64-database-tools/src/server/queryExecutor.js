import {
  isDeepStrictEqual
} from "node:util";

import {
  vibe64Error
} from "@local/vibe64-core/server/core";

import {
  databaseDialect
} from "./databaseDialect.js";
import {
  assertSingleStatement,
  queryId as normalizeQueryId
} from "./sqlPolicy.js";

const QUERY_TIMEOUT_MS = 20_000;
const QUERY_ROW_LIMIT = 500;
const QUERY_RESPONSE_BYTES = 2 * 1024 * 1024;

function text(value = "") {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf8");
  }
  return String(value ?? "").trim();
}

function tableKey(schema = "", name = "") {
  return `${text(schema)}\u0000${text(name)}`;
}

function tableMaps(schema = {}) {
  const tables = Array.isArray(schema?.tables) ? schema.tables : [];
  return {
    byId: new Map(tables.map((table) => [text(table.physicalId), table]).filter(([id]) => id)),
    byKey: new Map(tables.map((table) => [tableKey(table.schema, table.name), table]))
  };
}

function relationshipForColumn(schema = {}, table = {}, column = {}) {
  return (Array.isArray(schema?.relationships) ? schema.relationships : []).find((relationship) => (
    relationship.sourceTable === table.qualifiedName && relationship.columns.includes(column.name)
  )) || null;
}

function normalizedResultColumns(fields = [], schema = {}, engine = "postgresql") {
  const maps = tableMaps(schema);
  const dialect = databaseDialect(engine);
  return (Array.isArray(fields) ? fields : []).map((field, index) => {
    const origin = dialect.fieldOrigin(field, maps);
    const relationship = origin
      ? relationshipForColumn(schema, origin.table, origin.column)
      : null;
    return {
      databaseType: origin?.column?.nativeType || (
        dialect.databaseType(field)
      ),
      index,
      label: text(field.name) || `column_${index + 1}`,
      origin: origin ? {
        column: origin.column.name,
        schema: origin.table.schema,
        table: origin.table.name,
        tableKind: origin.table.kind,
        updatable: origin.table.updatable === true
      } : null,
      ...(relationship?.columns?.length === 1 ? {
        lookup: {
          composite: relationship.columns.length > 1,
          relationshipId: relationship.id,
          referencedColumns: relationship.referencedColumns,
          referencedTable: relationship.referencedTable,
          sourceColumns: relationship.columns
        }
      } : {}),
      source: origin || null
    };
  });
}

function jsonSafeValue(value, depth = 0) {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {
      base64: Buffer.from(value).toString("base64"),
      byteLength: value.length,
      kind: "binary"
    };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (depth > 20) {
    return "[value too deeply nested]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => jsonSafeValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      jsonSafeValue(entry, depth + 1)
    ]));
  }
  return String(value);
}

function databaseValue(value, column = {}) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.kind === "binary" &&
    typeof value.base64 === "string"
  ) {
    return Buffer.from(value.base64, "base64");
  }
  if (value && typeof value === "object" && /json/iu.test(column.nativeType || column.dataType || "")) {
    return JSON.stringify(value);
  }
  return value;
}

function boundedRows(rows = []) {
  const output = [];
  let bytes = 2;
  let responseLimited = false;
  for (const row of rows) {
    if (output.length >= QUERY_ROW_LIMIT) {
      break;
    }
    const normalized = (Array.isArray(row) ? row : Object.values(row || {})).map((value) => jsonSafeValue(value));
    const rowBytes = Buffer.byteLength(JSON.stringify(normalized), "utf8") + 1;
    if (bytes + rowBytes > QUERY_RESPONSE_BYTES) {
      responseLimited = true;
      break;
    }
    bytes += rowBytes;
    output.push(normalized);
  }
  return {
    bytes,
    responseLimited,
    rows: output,
    truncated: responseLimited || output.length < rows.length
  };
}

function representedColumns(columns = [], table = {}) {
  const represented = new Map();
  for (const column of columns) {
    if (
      column.source?.table?.qualifiedName === table.qualifiedName &&
      !represented.has(column.source.column.name)
    ) {
      represented.set(column.source.column.name, column.index);
    }
  }
  return represented;
}

function usableRowKey(row = [], columns = [], table = {}) {
  const represented = representedColumns(columns, table);
  let nullKey = false;
  for (const key of Array.isArray(table.keys) ? table.keys : []) {
    if (!key.columns.every((columnName) => represented.has(columnName))) {
      continue;
    }
    const values = key.columns.map((columnName) => row[represented.get(columnName)]);
    if (values.some((value) => value == null)) {
      nullKey = true;
      continue;
    }
    return {
      key,
      values: key.columns.map((column, index) => ({
        column,
        value: values[index]
      }))
    };
  }
  return {
    key: null,
    nullKey,
    values: []
  };
}

function missingKeyReason(table = {}, columns = []) {
  const represented = representedColumns(columns, table);
  const key = (Array.isArray(table.keys) ? table.keys : [])[0];
  if (!key) {
    return `The source ${table.kind === "view" ? "view" : "table"} has no primary or unique key.`;
  }
  const missing = key.columns.filter((column) => !represented.has(column));
  return missing.length
    ? `Include ${missing.map((column) => `${table.qualifiedName}.${column}`).join(", ")} in the query to edit this value.`
    : "This joined row has no non-null source identity.";
}

function ambiguousSourceTables(columns = []) {
  const occurrences = new Map();
  const ambiguous = new Set();
  for (const column of columns) {
    const table = column.source?.table;
    const sourceColumn = column.source?.column;
    if (!table || !sourceColumn) {
      continue;
    }
    const key = `${table.qualifiedName}\u0000${sourceColumn.name}`;
    if (occurrences.has(key)) {
      ambiguous.add(table.qualifiedName);
    } else {
      occurrences.set(key, true);
    }
  }
  return ambiguous;
}

function cellEditMetadata(row = [], columns = []) {
  const ambiguousTables = ambiguousSourceTables(columns);
  const identities = new Map();
  for (const resultColumn of columns) {
    const table = resultColumn.source?.table;
    if (table && !identities.has(table.qualifiedName)) {
      identities.set(table.qualifiedName, usableRowKey(row, columns, table));
    }
  }
  return columns.map((resultColumn) => {
    const source = resultColumn.source;
    if (!source) {
      return {
        editable: false,
        reason: "Calculated or derived results are read-only."
      };
    }
    if (ambiguousTables.has(source.table.qualifiedName)) {
      return {
        editable: false,
        reason: "This source table appears more than once or projects a physical column more than once, so its row identity is ambiguous."
      };
    }
    if (source.table.updatable !== true) {
      return {
        editable: false,
        reason: `The source ${source.table.kind === "view" ? "view" : "table"} is read-only.`
      };
    }
    if (source.column.immutable) {
      return {
        editable: false,
        reason: "Generated and identity columns are read-only."
      };
    }
    const identity = identities.get(source.table.qualifiedName);
    if (!identity?.key) {
      return {
        editable: false,
        reason: missingKeyReason(source.table, columns)
      };
    }
    return {
      column: source.column.name,
      editable: true,
      key: {
        columns: identity.values,
        name: identity.key.name,
        primary: identity.key.primary === true
      },
      originalValue: row[resultColumn.index],
      table: {
        name: source.table.name,
        schema: source.table.schema
      }
    };
  });
}

function rowEditMetadata(row = [], columns = []) {
  const ambiguousTables = ambiguousSourceTables(columns);
  const tables = new Map();
  for (const column of columns) {
    const table = column.source?.table;
    if (table && !tables.has(table.qualifiedName)) {
      tables.set(table.qualifiedName, table);
    }
  }
  return [...tables.values()].flatMap((table) => {
    const identity = usableRowKey(row, columns, table);
    if (
      !identity.key ||
      ambiguousTables.has(table.qualifiedName) ||
      !["foreign-table", "partitioned-table", "table"].includes(table.kind)
    ) {
      return [];
    }
    return [{
      key: {
        columns: identity.values,
        name: identity.key.name,
        primary: identity.key.primary === true
      },
      table: {
        name: table.name,
        schema: table.schema
      }
    }];
  });
}

function publicColumns(columns = []) {
  return columns.map(({ source: _source, ...column }) => column);
}

function normalizeRawResponse(raw, schema = {}, connection = {}) {
  const dialect = databaseDialect(connection.engine);
  const resultSet = dialect.resultSet(raw);
  if (resultSet) {
    const columns = normalizedResultColumns(resultSet.fields, schema, connection.engine);
    const bounded = boundedRows(resultSet.rows);
    return {
      ...bounded,
      cellMeta: bounded.rows.map((row) => cellEditMetadata(row, columns)),
      columns: publicColumns(columns),
      command: resultSet.command,
      fullRowCount: resultSet.fullRowCount,
      kind: "result-set",
      rowMeta: bounded.rows.map((row) => rowEditMetadata(row, columns))
    };
  }
  return dialect.commandResult(raw, jsonSafeValue);
}

async function beginReadOnly(knex, connection, engine = "postgresql") {
  await knex.raw(databaseDialect(engine).readOnlyBeginSql).connection(connection);
}

async function rollbackReadOnly(knex, connection) {
  await knex.raw("ROLLBACK").connection(connection).catch(() => null);
}

async function executeDatabaseQuery({
  activeQueries = new Map(),
  connection: descriptor = {},
  knex,
  queryId = "",
  readOnly = true,
  schema = {},
  sql = "",
  signal
} = {}) {
  if (!knex) {
    throw new TypeError("executeDatabaseQuery requires Knex.");
  }
  const statement = assertSingleStatement(sql, descriptor.engine);
  signal?.throwIfAborted();
  const normalizedId = normalizeQueryId(queryId);
  if (activeQueries.has(normalizedId)) {
    throw vibe64Error(
      "A database query with that id is already running.",
      "vibe64_database_query_id_active"
    );
  }
  const startedAt = Date.now();
  let connection = null;
  let readTransaction = false;
  const active = { cancel: null };
  activeQueries.set(normalizedId, active);
  try {
    connection = await knex.client.acquireConnection();
    signal?.throwIfAborted();
    active.cancel = () => knex.client.cancelQuery(connection);
    if (readOnly) {
      await beginReadOnly(knex, connection, descriptor.engine);
      readTransaction = true;
    }
    const options = databaseDialect(descriptor.engine).queryOptions;
    signal?.throwIfAborted();
    const raw = await knex.raw(statement)
      .options(options)
      .connection(connection)
      .timeout(QUERY_TIMEOUT_MS, { cancel: true });
    signal?.throwIfAborted();
    const result = normalizeRawResponse(raw, schema, descriptor);
    return {
      ...result,
      durationMs: Date.now() - startedAt,
      ok: true,
      queryId: normalizedId,
      readOnly
    };
  } finally {
    if (readTransaction) {
      await rollbackReadOnly(knex, connection);
    }
    if (activeQueries.get(normalizedId) === active) {
      activeQueries.delete(normalizedId);
    }
    if (connection) await knex.client.releaseConnection(connection);
  }
}

async function cancelDatabaseQuery(activeQueries = new Map(), value = "") {
  const normalizedId = normalizeQueryId(value);
  const active = activeQueries.get(normalizedId);
  if (!active?.cancel) {
    return {
      cancelled: false,
      ok: true,
      queryId: normalizedId
    };
  }
  await active.cancel();
  return {
    cancelled: true,
    ok: true,
    queryId: normalizedId
  };
}

function schemaTable(schema = {}, tableInput = {}) {
  const table = (Array.isArray(schema?.tables) ? schema.tables : []).find((candidate) => (
    candidate.schema === text(tableInput.schema) && candidate.name === text(tableInput.name)
  ));
  if (!table) {
    throw vibe64Error(
      "The source table is not present in the refreshed schema. Refresh and try again.",
      "vibe64_database_source_table_missing"
    );
  }
  return table;
}

function schemaColumn(table = {}, value = "") {
  const column = table.columns.find((candidate) => candidate.name === text(value));
  if (!column) {
    throw vibe64Error(
      "The source column is not present in the refreshed schema. Refresh and try again.",
      "vibe64_database_source_column_missing"
    );
  }
  return column;
}

function validatedKey(table = {}, input = {}) {
  const inputColumns = Array.isArray(input?.columns) ? input.columns : [];
  const names = inputColumns.map((entry) => text(entry?.column));
  const key = table.keys.find((candidate) => (
    candidate.columns.length === names.length && candidate.columns.every((name, index) => name === names[index])
  ));
  if (!key || inputColumns.some((entry) => entry?.value == null)) {
    throw vibe64Error(
      "The source row identity is incomplete or no longer valid.",
      "vibe64_database_row_identity_invalid"
    );
  }
  return inputColumns.map((entry) => {
    const column = schemaColumn(table, entry.column);
    return {
      column: column.name,
      value: databaseValue(entry.value, column)
    };
  });
}

function tableQuery(knex, table = {}) {
  return knex(table.name).withSchema(table.schema);
}

function applyWhere(query, values = []) {
  for (const entry of values) {
    if (entry.value == null) {
      query.whereNull(entry.column);
    } else {
      query.where(entry.column, entry.value);
    }
  }
  return query;
}

async function updateDatabaseCell({
  edit = {},
  knex,
  schema = {},
  value
} = {}) {
  const table = schemaTable(schema, edit.table);
  if (table.updatable !== true) {
    throw vibe64Error("The source table or view is read-only.", "vibe64_database_source_read_only");
  }
  const column = schemaColumn(table, edit.column);
  if (column.immutable) {
    throw vibe64Error("Generated and identity columns cannot be edited.", "vibe64_database_column_immutable");
  }
  const key = validatedKey(table, edit.key);
  if (isDeepStrictEqual(edit.originalValue, value)) {
    return { affectedRows: 0, changed: false, ok: true };
  }
  const originalValue = databaseValue(edit.originalValue, column);
  const nextValue = databaseValue(value, column);
  const query = applyWhere(tableQuery(knex, table), key);
  if (originalValue == null) {
    query.whereNull(column.name);
  } else {
    query.where(column.name, originalValue);
  }
  const affectedRows = Number(await query.update({ [column.name]: nextValue }) || 0);
  if (affectedRows !== 1) {
    throw vibe64Error(
      affectedRows === 0
        ? "The source value changed since this query ran. Rerun the query and try again."
        : "The edit matched more than one source row and was refused.",
      affectedRows === 0
        ? "vibe64_database_edit_conflict"
        : "vibe64_database_edit_ambiguous"
    );
  }
  return { affectedRows, changed: true, ok: true };
}

function insertRecord(table = {}, values = {}, knex) {
  const record = {};
  for (const [name, value] of Object.entries(values && typeof values === "object" ? values : {})) {
    const column = schemaColumn(table, name);
    if (column.immutable) {
      continue;
    }
    if (knex.client.dialect === "sqlite3" && value && typeof value === "object" && value.useDefault === true) {
      continue;
    }
    record[column.name] = value && typeof value === "object" && value.useDefault === true
      ? knex.raw("DEFAULT")
      : databaseValue(value, column);
  }
  return record;
}

async function insertDatabaseRow({
  knex,
  schema = {},
  table: tableInput = {},
  values = {}
} = {}) {
  const table = schemaTable(schema, tableInput);
  if (table.kind !== "table" && table.kind !== "partitioned-table" && table.kind !== "foreign-table") {
    throw vibe64Error("Insert requires a physical table.", "vibe64_database_insert_table_required");
  }
  const record = insertRecord(table, values, knex);
  if (Object.keys(record).length < 1) {
    throw vibe64Error("Enter at least one value to insert.", "vibe64_database_insert_values_required");
  }
  const result = await tableQuery(knex, table).insert(record);
  return {
    affectedRows: 1,
    insertedId: Array.isArray(result) ? jsonSafeValue(result[0]) : null,
    ok: true
  };
}

async function deleteDatabaseRow({
  confirmed = false,
  key = {},
  knex,
  schema = {},
  table: tableInput = {}
} = {}) {
  if (confirmed !== true) {
    throw vibe64Error("Confirm the source-row deletion first.", "vibe64_database_delete_confirmation_required");
  }
  const table = schemaTable(schema, tableInput);
  if (table.kind !== "table" && table.kind !== "partitioned-table" && table.kind !== "foreign-table") {
    throw vibe64Error("Delete requires a physical table.", "vibe64_database_delete_table_required");
  }
  const identity = validatedKey(table, key);
  const affectedRows = Number(await applyWhere(tableQuery(knex, table), identity).delete() || 0);
  if (affectedRows !== 1) {
    throw vibe64Error(
      affectedRows === 0 ? "The source row no longer exists." : "The delete matched more than one source row and was refused.",
      affectedRows === 0 ? "vibe64_database_delete_conflict" : "vibe64_database_delete_ambiguous"
    );
  }
  return { affectedRows, ok: true };
}

export {
  QUERY_RESPONSE_BYTES,
  QUERY_ROW_LIMIT,
  QUERY_TIMEOUT_MS,
  boundedRows,
  cancelDatabaseQuery,
  deleteDatabaseRow,
  databaseValue,
  executeDatabaseQuery,
  insertDatabaseRow,
  normalizeRawResponse,
  updateDatabaseCell,
  validatedKey
};
