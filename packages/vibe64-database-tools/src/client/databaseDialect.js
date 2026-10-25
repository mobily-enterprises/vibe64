import {
  MariaSQL,
  PostgreSQL,
  SQLite
} from "@codemirror/lang-sql";

import { SQL_QUOTING } from "../shared/sqlQuoting.js";

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
    ...SQL_QUOTING.sqlite,
    codeMirrorDialect: SQLite
  }),
  mysql: defineDatabaseClientDialect({
    ...SQL_QUOTING.mysql,
    codeMirrorDialect: MariaSQL
  }),
  postgresql: defineDatabaseClientDialect({
    ...SQL_QUOTING.postgresql,
    codeMirrorDialect: PostgreSQL
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
