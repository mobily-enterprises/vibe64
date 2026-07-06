import {
  managedDatabaseNameFromTargetRoot
} from "@local/studio-terminal-core/server/managedDatabases";
import {
  readDatabaseHostFromEnvFile
} from "../../adapterHelpers/setupDatabaseConnections.js";
import {
  defaultValidateDatabaseName as validateDatabaseName
} from "../../adapterHelpers/setupMariaDbChecks.js";
import {
  allDependencyNames,
  readTargetPackageJson
} from "../../adapterHelpers/setupNodePackages.js";

const JSKIT_MARIADB_HOST = "127.0.0.1";
const JSKIT_MARIADB_ROOT_PASSWORD = "vibe64_jskit_root";
const JSKIT_MARIADB_PROBE_DATABASE = "vibe64_mariadb_probe";
const JSKIT_MARIADB_PROBE_TABLE = "capability_probe";
const JSKIT_MARIADB_PROBE_SQL_VARIABLE = "@vibe64_mariadb_probe_sql";
const JSKIT_MARIADB_PROBE_STATEMENT = "vibe64_mariadb_probe_statement";

async function targetWantsJskitMariaDb(targetRoot = "", toolkit) {
  const lockJsonResult = await toolkit.readTargetJson(".jskit/lock.json", {
    targetRoot
  });
  const packageJson = await readTargetPackageJson(targetRoot, toolkit) || {};
  const lockJson = lockJsonResult.ok ? lockJsonResult.value : {};
  const names = allDependencyNames(packageJson, lockJson?.installedPackages || {});
  return [...names].some((name) => name.includes("database-runtime-mysql"));
}

function mariaDbIdentifier(value = "") {
  return String(value || "").replaceAll("`", "``");
}

function mariaDbPreparedStatement(sqlExpression = "") {
  return [
    `SET ${JSKIT_MARIADB_PROBE_SQL_VARIABLE} = ${sqlExpression}`,
    `PREPARE ${JSKIT_MARIADB_PROBE_STATEMENT} FROM ${JSKIT_MARIADB_PROBE_SQL_VARIABLE}`,
    `EXECUTE ${JSKIT_MARIADB_PROBE_STATEMENT}`,
    `DEALLOCATE PREPARE ${JSKIT_MARIADB_PROBE_STATEMENT}`
  ];
}

function mariaDbTemporaryProbeSql() {
  const probeDatabaseVariable = "@vibe64_mariadb_probe_database";
  const probeIdentifierVariable = "@vibe64_mariadb_probe_identifier";
  return [
    `SET ${probeDatabaseVariable} = CONCAT('${JSKIT_MARIADB_PROBE_DATABASE}_', REPLACE(UUID(), '-', ''))`,
    `SET ${probeIdentifierVariable} = REPLACE(${probeDatabaseVariable}, '\`', '\`\`')`,
    ...mariaDbPreparedStatement(`CONCAT('CREATE DATABASE \`', ${probeIdentifierVariable}, '\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')`),
    ...mariaDbPreparedStatement(`CONCAT('CREATE TABLE \`', ${probeIdentifierVariable}, '\`.\`${JSKIT_MARIADB_PROBE_TABLE}\` (id INT NOT NULL PRIMARY KEY)')`),
    ...mariaDbPreparedStatement(`CONCAT('DROP TABLE IF EXISTS \`', ${probeIdentifierVariable}, '\`.\`${JSKIT_MARIADB_PROBE_TABLE}\`')`),
    ...mariaDbPreparedStatement(`CONCAT('DROP DATABASE IF EXISTS \`', ${probeIdentifierVariable}, '\`')`)
  ];
}

function mariaDbCapabilitySql({
  appDatabaseName = ""
} = {}) {
  const database = String(appDatabaseName || "").trim();
  return [
    ...(database
      ? [
          `CREATE DATABASE IF NOT EXISTS \`${mariaDbIdentifier(database)}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        ]
      : []),
    ...mariaDbTemporaryProbeSql()
  ].join("; ");
}

function jskitMariaDbDatabaseName(targetRoot = "") {
  return managedDatabaseNameFromTargetRoot(targetRoot, {
    fallback: "jskit_app"
  });
}

function jskitMariaDbHostPort() {
  return "3306";
}

function managedMariaDbAccessInstructions(databaseName = "") {
  const database = String(databaseName || "").trim();
  const databaseArg = database ? ` ${database}` : "";
  return `Host MariaDB: mariadb --protocol=TCP --host=${JSKIT_MARIADB_HOST} --port=${jskitMariaDbHostPort()} --user=root${databaseArg}`;
}

async function readDatabaseHostFromDotEnv(targetRoot = "") {
  return readDatabaseHostFromEnvFile(targetRoot, {
    relativePath: ".env"
  });
}

export {
  jskitMariaDbDatabaseName,
  jskitMariaDbHostPort,
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_ROOT_PASSWORD,
  managedMariaDbAccessInstructions,
  mariaDbCapabilitySql,
  readDatabaseHostFromDotEnv,
  targetWantsJskitMariaDb,
  validateDatabaseName
};
