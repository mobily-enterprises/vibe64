// The one home of SQL identifier and string-literal quoting for every engine
// the database tools support. The editor dialect and the local-server setup
// guide quote through these rules, and the editor and server build a table's
// default query here.

function quotedIdentifier(value = "", delimiter = "\"") {
  const name = String(value || "");
  if (!name) {
    throw new TypeError("A database identifier is missing.");
  }
  return `${delimiter}${name.replaceAll(delimiter, delimiter.repeat(2))}${delimiter}`;
}

function singleQuotedString(value = "") {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const SQL_QUOTING = Object.freeze({
  mysql: Object.freeze({
    quoteIdentifier: (value) => quotedIdentifier(value, "`"),
    // MySQL also treats a backslash inside a string literal as an escape.
    stringLiteral: (value) => singleQuotedString(String(value).replaceAll("\\", "\\\\"))
  }),
  postgresql: Object.freeze({
    quoteIdentifier: (value) => quotedIdentifier(value, "\""),
    stringLiteral: singleQuotedString
  }),
  sqlite: Object.freeze({
    quoteIdentifier: (value) => quotedIdentifier(value, "\""),
    stringLiteral: singleQuotedString
  })
});

// The query a table opens with. A MySQL table's schema is the connection's own
// database, so it is named without it; other engines, including an unknown
// one, qualify it by schema with standard double-quoted identifiers.
function defaultTableQuery(table = {}, engine = "") {
  const { quoteIdentifier } = SQL_QUOTING[engine] || SQL_QUOTING.postgresql;
  const parts = engine === "mysql" ? [table.name] : [table.schema, table.name];
  return `SELECT *\nFROM ${parts.filter(Boolean).map(quoteIdentifier).join(".")};`;
}

export {
  SQL_QUOTING,
  defaultTableQuery
};
