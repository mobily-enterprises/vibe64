import { fork } from "node:child_process";
import { createRequire } from "node:module";
import ClientSQLite from "knex/lib/dialects/sqlite3/index.js";

const require = createRequire(import.meta.url);

// SQLite runs synchronous native code. A connection process keeps that code off
// the server event loop and makes cancellation possible even inside a long query.
class SQLiteConnection {
  constructor() {
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
    this.child = fork(require.resolve("@local/vibe64-database-tools/server/sqlite-worker"), [], {
      execArgv: [],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
    this.exited = new Promise((resolve) => this.child.once("close", () => {
      this.fail(new Error("SQLite connection closed."));
      resolve();
    }));
    this.child.on("error", (error) => {
      this.fail(error);
      this.child.kill("SIGKILL");
    });
    this.child.on("message", ({ id, result, error }) => {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (error) pending.reject(Object.assign(new Error(error.message), { code: error.code }));
      else pending.resolve(result);
    });
  }

  fail(error) {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(operation, input = {}) {
    if (this.closed) return Promise.reject(new Error("SQLite connection is closed."));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(Object.assign(new Error("SQLite operation timed out."), { code: "SQLITE_INTERRUPT" }));
        this.child.kill("SIGKILL");
      }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.send({ id, operation, ...input }, (error) => {
        if (error) {
          this.fail(error);
          this.child.kill("SIGKILL");
        }
      });
    });
  }

  async cancel() {
    this.fail(Object.assign(new Error("SQLite query was cancelled."), { code: "SQLITE_INTERRUPT" }));
    this.child.kill("SIGKILL");
    await this.exited;
  }
}

class SQLiteClient extends ClientSQLite {
  _driver() { return {}; }

  async acquireRawConnection() {
    const connection = new SQLiteConnection();
    try {
      await connection.request("open", this.connectionSettings);
      return connection;
    } catch (error) {
      await connection.cancel();
      throw error;
    }
  }

  async destroyRawConnection(connection) {
    if (!connection.closed) {
      try { await connection.request("close"); } finally { await connection.cancel(); }
    } else {
      await connection.exited;
    }
  }

  validateConnection(connection) { return !connection.closed; }
  cancelQuery(connection) { return connection.cancel(); }

  async _query(connection, query) {
    const result = await connection.request("query", {
      sql: query.sql,
      bindings: (query.bindings || []).map((value) => (
        typeof value === "boolean" ? Number(value) : value instanceof Date ? value.toISOString() : value
      )),
      resultSet: query.options?.sqliteResultSet === true
    });
    query.response = query.method === "raw" ? result : result.rows;
    query.context = { changes: result.changes, lastID: result.lastInsertRowid };
    return query;
  }
}

SQLiteClient.prototype.canCancelQuery = true;

export { SQLiteClient };
