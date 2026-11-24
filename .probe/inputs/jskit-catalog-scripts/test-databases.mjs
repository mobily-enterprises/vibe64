import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { readTableResourceSources } from "./data-access.mjs";

// `jskit test --databases`: each test file running at once gets a database of its own, a copy of TEST_DB_NAME restored
// from a schema snapshot, from the application's installed @jskit-ai/database-runtime and its knexfile.js, which loads
// .env and fixes the dialect. JSKIT's catalog itself depends on no database package. What the knexfile loads into the
// environment is read for the databases only: the test files get the environment `jskit test` was given, plus their
// own database and its connection (DB_NAME, TEST_DB_NAME, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD). A knexfile whose
// schema the migrations alone do not build also exports `testDatabaseSchema` ({ files, build }, see testDatabases.js).
const OPTION = "--databases";
const KNEXFILES = Object.freeze(["knexfile.js", "knexfile.mjs", "knexfile.cjs"]);
const TEST_DATABASES = "@jskit-ai/database-runtime/server/testDatabases";
const RESOURCE_RUNTIME = "@jskit-ai/resource-runtime/server";
const TABLE_RESOURCES = "@jskit-ai/resource-core/shared/tableResource";
const GUIDE = "https://mobily-enterprises.github.io/jskit-ai/guide/framework/data-access#layer-1-the-table-resource";

/** Runs `load` and puts process.env back as it was, returning what `load` returned and the environment it saw. */
async function withOwnEnvironment(load) {
  const before = { ...process.env };
  try {
    const result = await load();
    return { result, environment: { ...process.env } };
  } finally {
    for (const name of Object.keys(process.env)) if (!Object.hasOwn(before, name)) delete process.env[name];
    Object.assign(process.env, before);
  }
}

// A module's exported table resources: each export, or each item of an exported list or object.
function exportedTableResources(namespace, isTableResource) {
  return Object.values(namespace).flatMap((value) => {
    if (isTableResource(value)) return [value];
    const items = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
    return items.filter((item) => isTableResource(item));
  });
}

const keyText = ({ tableName, columns, referencedTableName, referencedColumns }) =>
  `${tableName} (${columns.join(", ")}) -> ${referencedTableName} (${referencedColumns.join(", ")})`;

/**
 * Compares the foreignKeys the app's table resources and its @jskit-ai packages' declare with the keys TEST_DB_NAME
 * holds, once a run's databases are ready: json-rest-api relies on a declaration to skip work, so a declared key the
 * database lacks fails the run. A package's table that the database does not have is left out: node_modules can hold
 * a package whose migrations the app never runs (one only a devDependency brings, or one left behind), and the app
 * never reads that table. The app's own tables are always checked. A key of one of the app's own tables that nothing
 * declares is reported, as work json-rest-api could skip. It imports only the modules that declare foreignKeys; an app
 * without the resource runtime has nothing to check.
 * @param {string} cwd
 * @returns {(knex: object) => Promise<string>}
 */
function foreignKeyCheckFor(cwd) {
  return async (knex) => {
    const appRequire = createRequire(path.join(cwd, "package.json"));
    let runtime;
    let tableResources;
    try {
      [runtime, tableResources] = [appRequire.resolve(RESOURCE_RUNTIME), appRequire.resolve(TABLE_RESOURCES)];
    } catch {
      return "";
    }
    const sources = await readTableResourceSources({ projectRoot: cwd });
    const tables = sources.filter((source) => !source.framework && source.tableName).map((source) => source.tableName);
    const declaringFiles = [...new Set(sources.filter((source) => source.foreignKeys).map((source) => source.absolute))];
    if (tables.length < 1 && declaringFiles.length < 1) return "";
    const { isTableResource } = await import(pathToFileURL(tableResources).href);
    const resources = [];
    const absentPackageTables = new Set();
    for (const file of declaringFiles) {
      const declaring = sources.filter((entry) => entry.absolute === file && entry.foreignKeys);
      const exported = exportedTableResources(await import(pathToFileURL(file).href), isTableResource);
      for (const source of declaring) {
        if (!exported.some((resource) => resource.foreignKeys && resource.name === source.name)) {
          throw new Error(`${source.file}:${source.line} declares foreignKeys on a table resource the module does not export, so ` +
            `jskit test ${OPTION} cannot check them against the database: export the resource.`);
        }
      }
      for (const resource of exported.filter((entry) => entry.foreignKeys)) {
        if (declaring[0].framework && !(await knex.schema.hasTable(resource.tableName))) absentPackageTables.add(resource.tableName);
        else resources.push(resource);
      }
    }
    const { checkForeignKeys } = await import(pathToFileURL(runtime).href);
    const { missing, undeclared } = await checkForeignKeys({ knex, resources: [...new Set(resources)], tables });
    if (missing.length > 0) {
      throw new Error(`jskit test ${OPTION}: ${missing.length} declared foreign key(s) the test database does not hold. ` +
        `json-rest-api relies on a declared key, so a wrong one changes results: fix the declaration or add the key ` +
        `with a migration (${GUIDE}).\n` + missing.map((key) => `  ${key.resource}: ${keyText(key)}`).join("\n"));
    }
    const declared = [...new Set(resources)].reduce((count, resource) => count + resource.foreignKeys.length, 0);
    const checked = `foreign keys: ${declared} declared, all in the database` + (absentPackageTables.size < 1 ? "" :
      ` (${absentPackageTables.size} JSKIT package table(s) the database does not have are not checked)`);
    if (undeclared.length < 1) return checked;
    return `${checked}; ${undeclared.length} database key(s) on the app's tables are not declared, so json-rest-api cannot ` +
      `skip the work they would save (declare each on its table resource's foreignKeys): ${undeclared.map(keyText).join("; ")}`;
  };
}

/**
 * The run's databases for `count` files at once, or one file at a time on the connected database.
 * @param {number} count at most the run's test budget, and no more than its test files
 * @param {string} [cwd]
 * @returns {Promise<{ concurrency: number, env: Record<string, string>, preload: string, summary: string, cleanup(): void }>}
 */
async function testDatabaseRunFor(count, cwd = process.cwd()) {
  const knexfile = KNEXFILES.map((name) => path.join(cwd, name)).find((file) => existsSync(file));
  if (!knexfile) throw new Error(`jskit test ${OPTION} reads the application's knexfile.js, and ${cwd} has none.`);
  let testDatabases;
  try {
    testDatabases = createRequire(path.join(cwd, "package.json")).resolve(TEST_DATABASES);
  } catch {
    throw new Error(`jskit test ${OPTION} needs ${TEST_DATABASES}; install the application's JSKIT database driver.`);
  }
  const { result: { default: knexConfig, testDatabaseSchema: schema }, environment } = await withOwnEnvironment(async () =>
    import(pathToFileURL(knexfile).href));
  const { testDatabaseRun } = await import(pathToFileURL(testDatabases).href);
  return testDatabaseRun({ knexConfig, environment, count, schema, appRoot: cwd, checkDatabase: foreignKeyCheckFor(cwd) });
}

export { OPTION as DATABASES_OPTION, foreignKeyCheckFor, testDatabaseRunFor };
