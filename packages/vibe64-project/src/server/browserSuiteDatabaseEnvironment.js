import { isRecord, toText } from "@jskit-ai/kernel/shared/support/normalize";
import { resourceKindIsDatabase } from "./resourceEnvironment.js";

// What a browser suite's process opens instead of a database it must not reach: names that explain themselves in the
// error they cause, on a host that cannot resolve (`.invalid`), and an SQLite file in a folder that does not exist.
const NO_BROWSER_SUITE_DATABASE = "vibe64_no_database_in_browser_runs";
const NO_BROWSER_SUITE_DATABASE_HOST = "vibe64-no-database-in-browser-runs.invalid";
const NO_BROWSER_SUITE_SQLITE_FILE = `/nonexistent/${NO_BROWSER_SUITE_DATABASE}.sqlite`;
const DATABASE_NAME_SEMANTICS = new Set(["database", "testDatabase", "browserTestDatabase"]);
const URL_SCHEMES = Object.freeze({ mysql: "mysql", postgresql: "postgres" });

function objectRecord(value) {
  return isRecord(value) ? value : null;
}

function trimmedValue(environment = {}, name = "") {
  return typeof environment[name] === "string" ? environment[name].trim() : "";
}

function noBrowserSuiteDatabaseValue(kind = "", semantic = "") {
  const database = kind === "sqlite" ? NO_BROWSER_SUITE_SQLITE_FILE : NO_BROWSER_SUITE_DATABASE;
  if (DATABASE_NAME_SEMANTICS.has(semantic)) return database;
  if (semantic === "host") return NO_BROWSER_SUITE_DATABASE_HOST;
  if (semantic === "port") return "1";
  if (semantic === "url") {
    return kind === "sqlite" ? `file:${database}`
      : `${URL_SCHEMES[kind]}://${NO_BROWSER_SUITE_DATABASE}@${NO_BROWSER_SUITE_DATABASE_HOST}:1/${database}`;
  }
  return NO_BROWSER_SUITE_DATABASE;
}

/** A connection URL on another database of the same server, or null when the value is not one. */
function urlOnDatabase(value, database) {
  try {
    const url = new URL(value);
    url.pathname = `/${encodeURIComponent(database)}`;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * What a browser-test suite's own process gets for every name the Stack's databases bind (each alternative's, and
 * their test databases'), so that a spec that opens the database itself (a fixture through the app's knexfile, a
 * helper reading a URL) never reaches the development one. A process's own value wins over the app's generated .env:
 * Node's loadEnvFile, like dotenv, leaves a name the process has alone.
 * On a test-data target (`testData`) the suite opens its target's database: the browser-test database
 * (BROWSER_TEST_DB_NAME), which is the first app server's copy, on the server and with the credentials the session
 * has. Anywhere else, and for a database without its own browser-test database, every name refuses to connect and
 * says why.
 * @param {Array<{ resource?: object }>} resources
 * @param {Record<string, string>} environment the project's Env, as the suite's process would otherwise get it
 * @param {{ testData?: boolean }} [options]
 */
function browserSuiteDatabaseEnvironment(resources = [], environment = {}, { testData = false } = {}) {
  const output = {};
  for (const { resource } of Array.isArray(resources) ? resources : []) {
    if (!resourceKindIsDatabase(resource?.kind)) continue;
    const bindings = [
      ...(Array.isArray(resource.environmentAlternatives) ? resource.environmentAlternatives : [])
        .flatMap((alternative) => Object.entries(objectRecord(alternative?.bindings) || {})),
      ...Object.entries(objectRecord(resource.optionalBindings) || {})
    ].filter(([, name]) => toText(name));
    const developmentNames = bindings.filter(([semantic]) => semantic === "database")
      .map(([, name]) => trimmedValue(environment, name)).filter(Boolean);
    const copy = testData ? trimmedValue(environment, toText(objectRecord(resource.optionalBindings)?.browserTestDatabase)) : "";
    const testDatabase = copy && !developmentNames.includes(copy) ? copy : "";
    for (const [semantic, name] of bindings) {
      const value = typeof environment[name] === "string" ? environment[name] : null;
      // On the test database the server's address and credentials stay the session's: only the database differs.
      const onTestDatabase = !testDatabase ? null
        : DATABASE_NAME_SEMANTICS.has(semantic) ? testDatabase
          : semantic === "url" ? (value === null ? null : urlOnDatabase(value, testDatabase))
            : value;
      output[name] = onTestDatabase ?? noBrowserSuiteDatabaseValue(resource.kind, semantic);
    }
  }
  return output;
}

export { browserSuiteDatabaseEnvironment };
