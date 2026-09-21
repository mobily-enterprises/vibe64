import {
  MariaSQL,
  PostgreSQL,
  SQLite
} from "@codemirror/lang-sql";

function quotedIdentifier(value = "", delimiter = "\"") {
  const name = String(value || "");
  if (!name) {
    throw new TypeError("A database identifier is missing.");
  }
  return `${delimiter}${name.replaceAll(delimiter, delimiter.repeat(2))}${delimiter}`;
}

function defineDatabaseClientDialect(definition = {}) {
  if (
    !definition.codeMirrorDialect ||
    typeof definition.quoteIdentifier !== "function" ||
    typeof definition.stringLiteral !== "function"
  ) {
    throw new TypeError("A database client dialect must implement the complete UI adapter contract.");
  }
  return Object.freeze(definition);
}

const DATABASE_CLIENT_DIALECTS = Object.freeze({
  sqlite: defineDatabaseClientDialect({
    codeMirrorDialect: SQLite,
    quoteIdentifier: (value) => quotedIdentifier(value),
    stringLiteral: (value) => `'${String(value).replaceAll("'", "''")}'`
  }),
  mysql: defineDatabaseClientDialect({
    codeMirrorDialect: MariaSQL,
    quoteIdentifier: (value) => quotedIdentifier(value, "`"),
    stringLiteral: (value) => `'${String(value)
      .replaceAll("\\", "\\\\")
      .replaceAll("'", "''")}'`
  }),
  postgresql: defineDatabaseClientDialect({
    codeMirrorDialect: PostgreSQL,
    quoteIdentifier: (value) => quotedIdentifier(value, "\""),
    stringLiteral: (value) => `'${String(value).replaceAll("'", "''")}'`
  })
});

function databaseClientDialect(engine = "") {
  const candidate = String(engine || "").trim().toLowerCase();
  const dialect = DATABASE_CLIENT_DIALECTS[candidate];
  if (!dialect) {
    throw new TypeError(`Unsupported database client dialect: ${candidate || "missing"}.`);
  }
  return dialect;
}

export {
  DATABASE_CLIENT_DIALECTS,
  databaseClientDialect,
  defineDatabaseClientDialect
};
