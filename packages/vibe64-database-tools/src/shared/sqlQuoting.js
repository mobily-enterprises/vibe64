// The one home of SQL identifier and string-literal quoting for every engine
// the database tools support. The server dialect, the editor dialect and the
// local-server setup guide all quote through these rules.

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

export {
  SQL_QUOTING
};
