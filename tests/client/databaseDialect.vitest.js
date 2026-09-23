import { describe, expect, it } from "vitest";

import {
  DATABASE_CLIENT_DIALECTS,
  databaseClientDialect,
  defineDatabaseClientDialect
} from "../../packages/vibe64-database-tools/src/client/databaseDialect.js";
import {
  DATABASE_DIALECTS
} from "../../packages/vibe64-database-tools/src/server/databaseDialect.js";

describe("database client dialect registry", () => {
  it("owns PostgreSQL, MySQL and SQLite editor and SQL literal behavior", () => {
    expect(Object.keys(DATABASE_CLIENT_DIALECTS).sort()).toEqual(["mysql", "postgresql", "sqlite"]);
    expect(Object.keys(DATABASE_CLIENT_DIALECTS).sort())
      .toEqual(Object.keys(DATABASE_DIALECTS).sort());

    const postgresql = databaseClientDialect("postgresql");
    expect(postgresql.codeMirrorDialect).toBeTruthy();
    expect(postgresql.quoteIdentifier('odd"name')).toBe('"odd""name"');
    expect(postgresql.stringLiteral("O'Reilly\\books")).toBe("'O''Reilly\\books'");

    const mysql = databaseClientDialect("mysql");
    expect(mysql.codeMirrorDialect).toBeTruthy();
    expect(mysql.quoteIdentifier("odd`name")).toBe("`odd``name`");
    expect(mysql.stringLiteral("O'Reilly\\books")).toBe("'O''Reilly\\\\books'");
  });

  it("fails visibly when the UI has no adapter for an engine", () => {
    expect(() => databaseClientDialect("unsupported")).toThrow(/Unsupported database client dialect/u);
    expect(() => defineDatabaseClientDialect({})).toThrow(/complete UI adapter contract/u);
  });
});
