import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  BoundedMysqlClient,
  BoundedPostgresClient
} from "../../packages/vibe64-database-tools/src/server/boundedResultClients.js";
import { __testables } from "../../packages/vibe64-database-tools/src/server/queryExecutor.js";

const { normalizeRawResponse } = __testables;
const RESULT_ROW_LIMIT = 501;

// The real pg Query, fed the protocol messages a server sends for a SELECT of
// `rowTotal` integers. It records how many rows the driver itself kept.
function postgresConnection(rowTotal, observed) {
  return {
    query(query) {
      setImmediate(() => {
        query.handleRowDescription({
          fields: [{ columnID: 0, dataTypeID: 23, format: "text", name: "x", tableID: 0 }]
        });
        for (let row = 1; row <= rowTotal; row += 1) {
          query.handleDataRow({ fields: [String(row)] });
        }
        query.handleCommandComplete({ text: `SELECT ${rowTotal}` }, {});
        observed.driverRows = query._result.rows.length;
        query.handleReadyForQuery({});
      });
    }
  };
}

// mysql2's streaming events for a query without a callback.
function mysqlConnection(rowTotal) {
  return {
    query(options, bindings) {
      assert.deepEqual(options, { rowsAsArray: true, sql: "SELECT x FROM numbers" });
      assert.deepEqual(bindings, []);
      const query = new EventEmitter();
      setImmediate(() => {
        query.emit("fields", [{ name: "x", type: 3 }]);
        for (let row = 1; row <= rowTotal; row += 1) {
          query.emit("result", [row], 0);
        }
        query.emit("end");
      });
      return query;
    }
  };
}

async function postgresRead(rowTotal) {
  const client = new BoundedPostgresClient({ client: "pg", connection: {}, pool: { max: 0 } });
  try {
    const observed = {};
    const obj = await client._query(postgresConnection(rowTotal, observed), {
      bindings: [],
      options: { resultRowLimit: RESULT_ROW_LIMIT, rowMode: "array" },
      sql: "SELECT x FROM numbers"
    });
    return { observed, raw: obj.response };
  } finally {
    await client.destroy();
  }
}

async function mysqlRead(rowTotal) {
  const client = new BoundedMysqlClient({ client: "mysql2", connection: {}, pool: { max: 0 } });
  try {
    const obj = await client._query(mysqlConnection(rowTotal), {
      bindings: [],
      options: { resultRowLimit: RESULT_ROW_LIMIT, rowsAsArray: true },
      sql: "SELECT x FROM numbers"
    });
    return obj.response;
  } finally {
    await client.destroy();
  }
}

test("a PostgreSQL result keeps the same rows in memory at 1,000 and 20,000 rows and counts them all", async () => {
  const kept = [];
  for (const rowTotal of [1_000, 20_000]) {
    const { observed, raw } = await postgresRead(rowTotal);
    assert.equal(observed.driverRows, 0, "pg must not keep rows a row listener receives");
    kept.push(raw.rows.length + observed.driverRows);
    assert.deepEqual(raw.rows.slice(0, 2), [[1], [2]]);
    const result = normalizeRawResponse(raw, { tables: [] }, { engine: "postgresql" }, "SELECT x FROM numbers");
    assert.equal(result.rows.length, 500);
    assert.equal(result.truncated, true);
    assert.equal(result.fullRowCount, rowTotal);
  }
  assert.deepEqual(kept, [RESULT_ROW_LIMIT, RESULT_ROW_LIMIT], "rows held in memory must not grow with the result");
});

test("a MySQL result keeps the same rows in memory at 1,000 and 20,000 rows and counts them all", async () => {
  const kept = [];
  for (const rowTotal of [1_000, 20_000]) {
    const raw = await mysqlRead(rowTotal);
    kept.push(raw[0].length);
    assert.equal(raw[2], rowTotal);
    const result = normalizeRawResponse(raw, { tables: [] }, { engine: "mysql" }, "SELECT x FROM numbers");
    assert.equal(result.rows.length, 500);
    assert.equal(result.truncated, true);
    assert.equal(result.fullRowCount, rowTotal);
    assert.equal(result.command, "SELECT");
  }
  assert.deepEqual(kept, [RESULT_ROW_LIMIT, RESULT_ROW_LIMIT], "rows held in memory must not grow with the result");
});

test("a small streamed result is complete, and a MySQL statement keeps its own OK result", async () => {
  const { raw } = await postgresRead(3);
  const small = normalizeRawResponse(raw, { tables: [] }, { engine: "postgresql" }, "SELECT x FROM numbers");
  assert.deepEqual(small.rows, [[1], [2], [3]]);
  assert.equal(small.truncated, false);
  assert.equal(small.fullRowCount, 3);

  const client = new BoundedMysqlClient({ client: "mysql2", connection: {}, pool: { max: 0 } });
  try {
    const header = { affectedRows: 2, insertId: 0, warningStatus: 0 };
    const obj = await client._query({
      query() {
        const query = new EventEmitter();
        setImmediate(() => {
          query.emit("fields", undefined);
          query.emit("result", header, 0);
          query.emit("end");
        });
        return query;
      }
    }, { bindings: [], options: { resultRowLimit: RESULT_ROW_LIMIT, rowsAsArray: true }, sql: "DELETE FROM numbers" });
    assert.deepEqual(obj.response, [header, undefined]);
    assert.equal(normalizeRawResponse(obj.response, {}, { engine: "mysql" }, "DELETE FROM numbers").affectedRows, 2);
  } finally {
    await client.destroy();
  }
});

test("a MySQL OK packet, which mysql2 emits without a result index, stays its own result", async () => {
  const client = new BoundedMysqlClient({ client: "mysql2", connection: {}, pool: { max: 0 } });
  const run = (emit) => client._query({
    query() {
      const query = new EventEmitter();
      setImmediate(() => {
        emit(query);
        query.emit("end");
      });
      return query;
    }
  }, { bindings: [], options: { resultRowLimit: RESULT_ROW_LIMIT, rowsAsArray: true }, sql: "CALL numbers()" });
  try {
    const header = { affectedRows: 2, insertId: 0, warningStatus: 0 };
    const write = await run((query) => {
      query.emit("fields", undefined);
      query.emit("result", header);
    });
    assert.deepEqual(write.response, [header, undefined]);

    // A procedure's result set, then the OK packet that ends its CALL.
    const fields = [{ name: "x", type: 3 }];
    const call = await run((query) => {
      query.emit("fields", fields);
      for (let row = 1; row <= 600; row += 1) query.emit("result", [row], 0);
      query.emit("fields", undefined);
      query.emit("result", header);
    });
    const [results, fieldSets] = call.response;
    assert.equal(results.length, 2);
    assert.equal(results[0].length, RESULT_ROW_LIMIT);
    assert.deepEqual(results[0].at(-1), [RESULT_ROW_LIMIT], "the OK packet is not a row of the result set");
    assert.equal(results[1], header);
    assert.deepEqual(fieldSets, [fields, undefined]);
  } finally {
    await client.destroy();
  }
});

test("a streamed query reports its driver error", async () => {
  const client = new BoundedMysqlClient({ client: "mysql2", connection: {}, pool: { max: 0 } });
  try {
    await assert.rejects(client._query({
      query() {
        const query = new EventEmitter();
        setImmediate(() => {
          query.emit("error", Object.assign(new Error("Table 'numbers' doesn't exist"), { code: "ER_NO_SUCH_TABLE" }));
          query.emit("end");
        });
        return query;
      }
    }, { bindings: [], options: { resultRowLimit: RESULT_ROW_LIMIT }, sql: "SELECT x FROM numbers" }), {
      code: "ER_NO_SUCH_TABLE"
    });
  } finally {
    await client.destroy();
  }
});
