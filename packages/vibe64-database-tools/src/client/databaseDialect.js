import {
  MariaSQL,
  PostgreSQL,
  SQLite
} from "@codemirror/lang-sql";

import { SQL_QUOTING } from "../shared/sqlQuoting.js";

/**
 * What the SQL editor and the Data view need from an engine: its CodeMirror dialect and its SQL quoting.
 * @typedef {object} DatabaseClientDialect
 * @property {import("@codemirror/lang-sql").SQLDialect} codeMirrorDialect
 * @property {(name: string) => string} quoteIdentifier
 * @property {(value: unknown) => string} stringLiteral
 */

/**
 * An engine's client dialect, frozen.
 * @param {DatabaseClientDialect} definition
 */
function defineDatabaseClientDialect(definition) {
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

/**
 * The client dialect of an engine; an engine the UI has no dialect for is refused.
 * @param {string} [engine]
 * @returns {DatabaseClientDialect}
 */
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
