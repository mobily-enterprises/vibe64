import { lstat } from "node:fs/promises";
import { DatabaseSync, constants } from "node:sqlite";

let database;
const forbiddenPragmas = new Set(["temp_store_directory", "data_store_directory", "writable_schema"]);
const readPragmas = new Set([
  "table_info", "table_xinfo", "table_list", "index_list", "index_info", "index_xinfo",
  "foreign_key_list", "foreign_key_check", "integrity_check", "quick_check", "database_list",
  "compile_options", "page_count", "freelist_count", "schema_version", "user_version",
  "journal_mode", "foreign_keys", "query_only"
]);

process.on("disconnect", () => {
  database?.close();
  process.exit(0);
});

process.on("message", async ({ id, operation, filename, readOnly, sql, bindings = [], resultSet = false }) => {
  try {
    let result;
    if (operation === "open") {
      if (!(await lstat(filename)).isFile()) throw new Error("SQLite database must be an existing regular file.");
      database = new DatabaseSync(filename, { readOnly, allowExtension: false, timeout: 5_000 });
      database.exec("PRAGMA foreign_keys = ON");
      database.limits.length = 4 * 1024 * 1024;
      database.limits.sqlLength = 512 * 1024;
      database.setAuthorizer((action, first, second) => {
        if ([constants.SQLITE_ATTACH, constants.SQLITE_DETACH].includes(action)) return constants.SQLITE_DENY;
        if (action === constants.SQLITE_PRAGMA) {
          const pragma = String(first || "").toLowerCase();
          if (forbiddenPragmas.has(pragma)) return constants.SQLITE_DENY;
          if (readOnly && (!readPragmas.has(pragma) ||
              (second !== null && !["table_info", "table_xinfo", "index_list", "index_info", "index_xinfo", "foreign_key_list"].includes(pragma)))) {
            return constants.SQLITE_DENY;
          }
        } else if (readOnly && ![
          constants.SQLITE_SELECT, constants.SQLITE_READ, constants.SQLITE_FUNCTION,
          constants.SQLITE_TRANSACTION, constants.SQLITE_SAVEPOINT, constants.SQLITE_RECURSIVE
        ].includes(action)) return constants.SQLITE_DENY;
        return constants.SQLITE_OK;
      });
      result = { ok: true };
    } else if (operation === "close") {
      database.close();
      database = null;
      result = { ok: true };
    } else if (operation === "query") {
      const statement = database.prepare(sql);
      const fields = statement.columns();
      statement.setReadBigInts(true);
      if (fields.length) {
        statement.setReturnArrays(resultSet);
        const rows = [];
        let bytes = 0;
        for (const row of statement.iterate(...bindings)) {
          bytes += Buffer.byteLength(JSON.stringify(row, (_key, value) => typeof value === "bigint" ? String(value) : value));
          rows.push(row);
          if (resultSet && (rows.length > 500 || bytes > 2 * 1024 * 1024)) break;
          if (rows.length > 100_000 || bytes > 16 * 1024 * 1024) throw new Error("SQLite inspection result is too large.");
        }
        result = { fields, rows, changes: 0, command: "SELECT" };
      } else {
        result = { ...statement.run(...bindings), fields: [], rows: [], command: "COMMAND" };
      }
    } else throw new Error("Unknown SQLite connection operation.");
    process.send({ id, result });
  } catch (error) {
    process.send({ id, error: { message: error.message, code: error.code } });
  }
});
