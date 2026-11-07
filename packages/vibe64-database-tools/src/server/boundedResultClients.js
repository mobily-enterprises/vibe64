import ClientMySQL2 from "knex/lib/dialects/mysql2/index.js";
import ClientPG from "knex/lib/dialects/postgres/index.js";

// A query run with the `resultRowLimit` option streams its rows from the driver
// and keeps only that many, so a large result never sits whole in the editor's
// memory. The database still runs the whole statement, so a write is never cut
// short, and the result still counts every row it returned.

class BoundedPostgresClient extends ClientPG {
  _query(connection, obj) {
    const { resultRowLimit, ...options } = obj.options || {};
    if (!resultRowLimit) {
      return super._query(connection, obj);
    }
    if (!obj.sql) {
      throw new Error("The query is empty");
    }
    return new Promise((resolve, reject) => {
      const rows = [];
      let streamed = 0;
      // A Query with a row listener and no callback does not keep its rows.
      const query = new this.driver.Query({ text: obj.sql, values: obj.bindings || [], ...options });
      query.on("row", (row) => {
        streamed += 1;
        if (rows.length < resultRowLimit) {
          rows.push(row);
        }
      });
      query.on("error", reject);
      query.once("end", (result) => {
        result.rows = rows;
        // The command tag counts a SELECT's rows; a statement without one
        // counts the rows that streamed.
        result.rowCount ??= streamed;
        obj.response = result;
        resolve(obj);
      });
      connection.query(query);
    });
  }
}

class BoundedMysqlClient extends ClientMySQL2 {
  _query(connection, obj) {
    const { resultRowLimit, ...options } = obj.options || {};
    if (!resultRowLimit) {
      return super._query(connection, obj);
    }
    if (!obj.sql) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      // A query without a callback emits its rows and does not keep them. It
      // emits `fields` once per result, undefined for a statement's OK packet,
      // and that OK packet's `result` without an index: it is the latest result.
      const query = connection.query({ sql: obj.sql, ...options }, obj.bindings);
      const results = [];
      const fieldSets = [];
      const rowCounts = [];
      query.on("fields", (fields) => {
        const index = fieldSets.length;
        fieldSets.push(fields);
        if (fields) {
          results[index] = [];
          rowCounts[index] = 0;
        }
      });
      query.on("result", (row, index = fieldSets.length - 1) => {
        if (!fieldSets[index]) {
          results[index] = row;
          return;
        }
        rowCounts[index] += 1;
        if (results[index].length < resultRowLimit) {
          results[index].push(row);
        }
      });
      query.on("error", reject);
      query.once("end", () => {
        // The driver's own [rows, fields] callback values; a single result
        // set also carries the count of every row it returned.
        obj.response = results.length === 1
          ? [results[0], fieldSets[0], ...(fieldSets[0] ? [rowCounts[0]] : [])]
          : [results, fieldSets];
        resolve(obj);
      });
    });
  }
}

export {
  BoundedMysqlClient,
  BoundedPostgresClient
};
