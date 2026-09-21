import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { withSessionKnex } from "../../packages/vibe64-database-tools/src/server/connection.js";
import { inspectDatabaseSchema } from "../../packages/vibe64-database-tools/src/server/databaseDialect.js";
import { cancelDatabaseQuery, executeDatabaseQuery, insertDatabaseRow, updateDatabaseCell, deleteDatabaseRow } from "../../packages/vibe64-database-tools/src/server/queryExecutor.js";

test("SQLite schema, results, edits, read isolation and cancellation use real databases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-sqlite-"));
  const filename = path.join(root, "development.sqlite");
  const setup = new DatabaseSync(filename);
  setup.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE people (id INTEGER PRIMARY KEY, team_id INTEGER REFERENCES teams(id), name TEXT NOT NULL,
      label TEXT GENERATED ALWAYS AS (upper(name)) STORED, data BLOB, visits INTEGER DEFAULT 5);
    CREATE UNIQUE INDEX person_name ON people(name) WHERE team_id IS NOT NULL;
    CREATE VIEW names AS SELECT name FROM people;
    CREATE TABLE locales (language TEXT, code TEXT, PRIMARY KEY (language, code));
    CREATE TABLE translations (language TEXT, code TEXT, FOREIGN KEY (language, code) REFERENCES locales);
    INSERT INTO teams(name) VALUES ('Editors');
    INSERT INTO people(team_id, name, data) VALUES (1, 'Alice', X'0102');
  `);
  setup.close();
  try {
    let schema;
    await withSessionKnex({ kind: "sqlite", database: filename, readOnly: true }, async ({ connection, knex }) => {
      schema = await inspectDatabaseSchema({ connection, knex });
      assert.equal(schema.engine, "sqlite");
      const people = schema.tables.find((table) => table.name === "people");
      assert.deepEqual(people.keys.map((key) => key.columns), [["id"]]);
      assert.equal(people.columns.find((column) => column.name === "label").immutable, true);
      assert.equal(schema.tables.find((table) => table.name === "names").updatable, false);
      assert.equal(schema.relationships[0].referencedTable, "main.teams");
      assert.deepEqual(schema.relationships.find((relation) => relation.sourceTable === "main.translations").referencedColumns, ["language", "code"]);
      const result = await executeDatabaseQuery({ connection, knex, schema, sql: "SELECT id, name, data FROM people" });
      assert.equal(result.kind, "result-set");
      assert.equal(result.rows[0][1], "Alice");
      assert.equal(result.rows[0][2].base64, "AQI=");
      assert.equal(result.columns[1].origin.table, "people");
      const quoted = await executeDatabaseQuery({ connection, knex, schema, sql: "SELECT name AS [name;label] FROM people" });
      assert.equal(quoted.rows[0][0], "Alice");
      const bounded = await executeDatabaseQuery({ connection, knex, schema, sql:
        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000) SELECT x FROM n" });
      assert.equal(bounded.rows.length, 500);
      assert.equal(bounded.truncated, true);
      for (const sql of ["DELETE FROM people", "PRAGMA query_only = OFF", "ATTACH DATABASE ':memory:' AS outside", "VACUUM INTO 'outside.sqlite'"]) {
        await assert.rejects(executeDatabaseQuery({ connection, knex, schema, sql }));
      }
    });
    await withSessionKnex({ kind: "sqlite", database: filename, readOnly: false }, async ({ connection, knex }) => {
      await updateDatabaseCell({ knex, schema, edit: {
        table: { schema: "main", name: "people" }, column: "name", key: { columns: [{ column: "id", value: "1" }] }, originalValue: "Alice"
      }, value: "Alicia" });
      await insertDatabaseRow({ knex, schema, table: { schema: "main", name: "people" }, values: {
        name: "Bob", team_id: 1, visits: { useDefault: true }
      } });
      const result = await executeDatabaseQuery({ connection, knex, schema, readOnly: false, sql: "SELECT name, visits FROM people ORDER BY id" });
      assert.deepEqual(result.rows, [["Alicia", "5"], ["Bob", "5"]]);
      await deleteDatabaseRow({ knex, schema, table: { schema: "main", name: "people" }, key: { columns: [{ column: "id", value: "2" }] }, confirmed: true });
      await assert.rejects(executeDatabaseQuery({ connection, knex, readOnly: false, sql: "ATTACH DATABASE ':memory:' AS outside" }));
    });
    await withSessionKnex({ kind: "sqlite", database: filename, readOnly: true }, async ({ connection, knex }) => {
      const activeQueries = new Map();
      const promise = executeDatabaseQuery({ connection, knex, activeQueries, queryId: "slow", sql:
        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n" });
      const rejected = assert.rejects(promise, /cancelled|closed|interrupt/iu);
      while (!activeQueries.get("slow")?.cancel) await new Promise((resolve) => setTimeout(resolve, 10));
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal((await cancelDatabaseQuery(activeQueries, "slow")).cancelled, true);
      await rejected;
      assert.equal(activeQueries.size, 0);
    });
    const check = new DatabaseSync(filename, { readOnly: true });
    assert.equal(check.prepare("SELECT count(*) AS count FROM people").get().count, 1);
    check.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
