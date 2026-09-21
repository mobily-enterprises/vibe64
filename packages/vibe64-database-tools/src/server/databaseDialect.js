import {
  vibe64Error
} from "@local/vibe64-core/server/core";

import {
  inspectMysqlSchema,
  inspectPostgresSchema,
  inspectSqliteSchema
} from "./schemaInspector.js";

function text(value = "") {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  return String(value ?? "").trim();
}

function quotedIdentifier(value = "", delimiter = "\"") {
  const name = String(value || "");
  if (!name) {
    throw vibe64Error(
      "A database identifier is missing.",
      "vibe64_database_identifier_missing"
    );
  }
  return `${delimiter}${name.replaceAll(delimiter, delimiter.repeat(2))}${delimiter}`;
}

function postgresEscapeStringAt(sql = "", index = 0) {
  if (index < 1 || !/[Ee]/u.test(sql[index - 1])) {
    return false;
  }
  const beforePrefix = sql[index - 2] || "";
  return !/[A-Za-z0-9_$]/u.test(beforePrefix);
}

function postgresOrigin(field = {}, maps = {}) {
  const table = maps.byId.get(text(field.tableID));
  if (!table || !Number(field.columnID)) {
    return null;
  }
  const column = table.columns.find((candidate) => (
    Number(candidate.databaseIdentity?.columnId) === Number(field.columnID)
  ));
  return column ? { column, table } : null;
}

function mysqlOrigin(field = {}, maps = {}) {
  const schemaName = text(field.db);
  const tableName = text(field.orgTable);
  const columnName = text(field.orgName);
  if (!tableName || !columnName) {
    return null;
  }
  const table = maps.byKey.get(`${schemaName}\u0000${tableName}`);
  const column = table?.columns.find((candidate) => candidate.name === columnName);
  return table && column ? { column, table } : null;
}

const DATABASE_DIALECT_FUNCTIONS = Object.freeze([
  "binaryLiteral",
  "commandResult",
  "connectionOptions",
  "databaseType",
  "fieldOrigin",
  "inspectSchema",
  "lookupSearch",
  "quoteIdentifier",
  "resultSet",
  "sanitizeConnectionUrl",
  "singleQuoteBackslashEscapes",
  "stringLiteral"
]);

function defineDatabaseDialect(definition = {}) {
  if (
    !text(definition.client) ||
    !text(definition.engine) ||
    !text(definition.label) ||
    !text(definition.readOnlyBeginSql) ||
    !Array.isArray(definition.urlProtocols) ||
    definition.urlProtocols.length < 1 ||
    !definition.queryOptions ||
    typeof definition.queryOptions !== "object" ||
    DATABASE_DIALECT_FUNCTIONS.some((name) => typeof definition[name] !== "function")
  ) {
    throw new TypeError("A database dialect must implement the complete server adapter contract.");
  }
  return Object.freeze(definition);
}

const POSTGRESQL_DIALECT = defineDatabaseDialect({
  binaryLiteral: (hex) => `decode('${hex}', 'hex')`,
  client: "pg",
  commandResult(raw = {}) {
    return {
      affectedRows: Number(raw?.rowCount || 0),
      command: text(raw?.command || "COMMAND"),
      kind: "command",
      warnings: []
    };
  },
  connectionOptions: () => ({}),
  databaseType: (field = {}) => `oid:${Number(field.dataTypeID || 0)}`,
  engine: "postgresql",
  fieldOrigin: postgresOrigin,
  inspectSchema: ({ connection, knex }) => inspectPostgresSchema(knex, connection),
  label: "PostgreSQL",
  lookupSearch(builder, method, column, pattern) {
    builder[method]("CAST(?? AS TEXT) ILIKE ?", [column, pattern]);
  },
  queryOptions: Object.freeze({ rowMode: "array" }),
  quoteIdentifier: (value) => quotedIdentifier(value, "\""),
  readOnlyBeginSql: "BEGIN READ ONLY",
  resultSet(raw = {}) {
    if (!Array.isArray(raw?.fields) || raw.fields.length < 1) {
      return null;
    }
    const rows = Array.isArray(raw.rows) ? raw.rows : [];
    return {
      command: text(raw.command),
      fields: raw.fields,
      fullRowCount: Number(raw.rowCount ?? rows.length),
      rows
    };
  },
  sanitizeConnectionUrl: (connectionUrl) => connectionUrl,
  singleQuoteBackslashEscapes: postgresEscapeStringAt,
  stringLiteral: (value) => `'${String(value).replaceAll("'", "''")}'`,
  urlProtocols: Object.freeze(["postgres", "postgresql"])
});

const MYSQL_DIALECT = defineDatabaseDialect({
  binaryLiteral: (hex) => `X'${hex}'`,
  client: "mysql2",
  commandResult(raw = {}, jsonSafeValue = (value) => value) {
    const response = Array.isArray(raw) ? raw[0] || {} : {};
    const warningCount = Number(response.warningStatus || response.warningCount || 0);
    return {
      affectedRows: Number(response.affectedRows || 0),
      command: text(response.constructor?.name || "COMMAND").replace(/Packet$/u, "").toUpperCase(),
      insertId: response.insertId == null ? null : jsonSafeValue(response.insertId),
      kind: "command",
      warnings: warningCount > 0
        ? [`The database reported ${warningCount} warning(s).`]
        : [],
      ...(text(response.info) ? { message: text(response.info) } : {})
    };
  },
  connectionOptions: () => ({
    bigNumberStrings: true,
    dateStrings: true,
    multipleStatements: false,
    supportBigNumbers: true
  }),
  databaseType: (field = {}) => `type:${Number(field.type || 0)}`,
  engine: "mysql",
  fieldOrigin: mysqlOrigin,
  inspectSchema: ({ connection, knex }) => inspectMysqlSchema(knex, connection),
  label: "MySQL / MariaDB",
  lookupSearch(builder, method, column, pattern) {
    builder[method]("CAST(?? AS CHAR) LIKE ?", [column, pattern]);
  },
  queryOptions: Object.freeze({ rowsAsArray: true }),
  quoteIdentifier: (value) => quotedIdentifier(value, "`"),
  readOnlyBeginSql: "START TRANSACTION READ ONLY",
  resultSet(raw = {}) {
    const rows = Array.isArray(raw) ? raw[0] : null;
    const fields = Array.isArray(raw) ? raw[1] : null;
    return Array.isArray(rows) && Array.isArray(fields)
      ? {
          command: "SELECT",
          fields,
          fullRowCount: rows.length,
          rows
        }
      : null;
  },
  sanitizeConnectionUrl(connectionUrl = "") {
    const parsed = new URL(connectionUrl);
    parsed.searchParams.delete("multipleStatements");
    return parsed.toString();
  },
  singleQuoteBackslashEscapes: () => true,
  stringLiteral: (value) => `'${String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "''")}'`,
  urlProtocols: Object.freeze(["maria", "mariadb", "mysql"])
});

const DATABASE_DIALECTS = Object.freeze({
  sqlite: defineDatabaseDialect({
    binaryLiteral: (hex) => `X'${hex}'`,
    client: "sqlite3",
    commandResult: (raw = {}, jsonSafeValue = (value) => value) => ({
      affectedRows: Number(raw.changes || 0),
      command: "COMMAND",
      insertId: jsonSafeValue(raw.lastInsertRowid ?? null),
      kind: "command",
      warnings: []
    }),
    connectionOptions: () => ({}),
    databaseType: (field = {}) => text(field.type),
    engine: "sqlite",
    fieldOrigin(field = {}, maps = {}) {
      const table = maps.byKey.get(`${text(field.database)}\u0000${text(field.table)}`);
      const column = table?.columns.find((entry) => entry.name === field.column);
      return table && column ? { table, column } : null;
    },
    inspectSchema: ({ connection, knex }) => inspectSqliteSchema(knex, connection),
    label: "SQLite",
    lookupSearch(builder, method, column, pattern) {
      builder[method]("CAST(?? AS TEXT) LIKE ?", [column, pattern]);
    },
    queryOptions: Object.freeze({ sqliteResultSet: true }),
    quoteIdentifier: (value) => quotedIdentifier(value),
    readOnlyBeginSql: "BEGIN",
    resultSet: (raw = {}) => raw.fields?.length ? {
      command: raw.command,
      fields: raw.fields,
      fullRowCount: raw.rows.length,
      rows: raw.rows
    } : null,
    sanitizeConnectionUrl: (value) => value,
    singleQuoteBackslashEscapes: () => false,
    stringLiteral: (value) => `'${String(value).replaceAll("'", "''")}'`,
    urlProtocols: Object.freeze(["file"])
  }),
  mysql: MYSQL_DIALECT,
  postgresql: POSTGRESQL_DIALECT
});

function databaseDialect(kind = "") {
  const candidate = text(kind).toLowerCase();
  const dialect = DATABASE_DIALECTS[candidate];
  if (dialect) {
    return dialect;
  }
  throw vibe64Error(
    candidate
      ? `The session database kind is not supported: ${candidate}.`
      : "The session has no canonical database-tool connection.",
    candidate
      ? "vibe64_session_database_client_unsupported"
      : "vibe64_session_database_unavailable"
  );
}

async function inspectDatabaseSchema({
  connection = {},
  knex
} = {}) {
  if (!knex) {
    throw new TypeError("inspectDatabaseSchema requires Knex.");
  }
  return databaseDialect(connection.engine).inspectSchema({ connection, knex });
}

export {
  DATABASE_DIALECTS,
  databaseDialect,
  defineDatabaseDialect,
  inspectDatabaseSchema
};
