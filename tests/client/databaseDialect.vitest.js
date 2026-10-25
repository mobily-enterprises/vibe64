import { describe, expect, it } from "vitest";

import {
  DATABASE_CLIENT_DIALECTS,
  databaseClientDialect,
  defineDatabaseClientDialect
} from "../../packages/vibe64-database-tools/src/client/databaseDialect.js";
import {
  SQL_QUOTING
} from "../../packages/vibe64-database-tools/src/shared/sqlQuoting.js";

describe("shared SQL quoting", () => {
  it("owns identifier and string-literal quoting for PostgreSQL, MySQL and SQLite", () => {
    expect(Object.keys(SQL_QUOTING).sort()).toEqual(["mysql", "postgresql", "sqlite"]);

    expect(SQL_QUOTING.postgresql.quoteIdentifier('odd"name')).toBe('"odd""name"');
    expect(SQL_QUOTING.postgresql.stringLiteral("O'Reilly\\books")).toBe("'O''Reilly\\books'");

    expect(SQL_QUOTING.mysql.quoteIdentifier("odd`name")).toBe("`odd``name`");
    expect(SQL_QUOTING.mysql.stringLiteral("O'Reilly\\books")).toBe("'O''Reilly\\\\books'");

    expect(SQL_QUOTING.sqlite.quoteIdentifier('odd"name')).toBe('"odd""name"');
    expect(SQL_QUOTING.sqlite.stringLiteral("O'Reilly\\books")).toBe("'O''Reilly\\books'");
  });

  it("refuses an empty identifier", () => {
    for (const engine of Object.keys(SQL_QUOTING)) {
      expect(() => SQL_QUOTING[engine].quoteIdentifier("")).toThrow(/identifier is missing/u);
      expect(() => DATABASE_CLIENT_DIALECTS[engine].quoteIdentifier("")).toThrow(TypeError);
    }
  });

  it("is the quoting the client dialects expose", () => {
    for (const engine of Object.keys(SQL_QUOTING)) {
      expect(DATABASE_CLIENT_DIALECTS[engine].quoteIdentifier).toBe(SQL_QUOTING[engine].quoteIdentifier);
      expect(DATABASE_CLIENT_DIALECTS[engine].stringLiteral).toBe(SQL_QUOTING[engine].stringLiteral);
    }
  });
});

describe("database client dialect registry", () => {
  it("adds the editor dialect for each engine", () => {
    for (const engine of ["mysql", "postgresql", "sqlite"]) {
      expect(databaseClientDialect(engine).codeMirrorDialect).toBeTruthy();
    }
  });

  it("fails visibly when the UI has no adapter for an engine", () => {
    expect(() => databaseClientDialect("unsupported")).toThrow(/Unsupported database client dialect/u);
    expect(() => defineDatabaseClientDialect({})).toThrow(/complete UI adapter contract/u);
  });
});
