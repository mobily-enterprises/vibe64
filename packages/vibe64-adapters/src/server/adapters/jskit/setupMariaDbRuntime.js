import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  managedDatabaseNameFromTargetRoot
} from "@local/studio-terminal-core/server/managedDatabases";
import {
  VIBE64_RUNTIME_HOST_ALIAS,
  createRuntimeContainerRepair
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  runtimeNamespace
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  readDatabaseHostFromEnvFile
} from "../../adapterHelpers/setupDatabaseConnections.js";
import {
  defaultValidateDatabaseName as validateDatabaseName,
  mariaDbCreateDatabaseDockerArgs,
  mariaDbCreateDatabaseRepair
} from "../../adapterHelpers/setupMariaDbChecks.js";
import {
  allDependencyNames,
  readTargetPackageJson
} from "../../adapterHelpers/setupNodePackages.js";

const JSKIT_MARIADB_CONTAINER_ID = "mariadb";
const JSKIT_MARIADB_HOST = "vibe64-mariadb";
const JSKIT_MARIADB_IMAGE = "mariadb:12.0.2";
const JSKIT_MARIADB_ROOT_PASSWORD = "vibe64_jskit_root";
const JSKIT_MARIADB_PROBE_DATABASE = "vibe64_mariadb_probe";
const JSKIT_MARIADB_PROBE_TABLE = "capability_probe";
const JSKIT_HOST_DATABASE_HOST = VIBE64_RUNTIME_HOST_ALIAS;
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

function jskitRuntimeNamespaceNamePart() {
  return runtimeNamespace();
}

function jskitRuntimeNamespaceVolumePart() {
  return jskitRuntimeNamespaceNamePart().replaceAll("-", "_");
}

function jskitMariaDbContainerName() {
  return [
    "vibe64",
    jskitRuntimeNamespaceNamePart(),
    "mariadb"
  ].filter(Boolean).join("-");
}

function jskitMariaDbVolumeName() {
  return [
    "vibe64",
    jskitRuntimeNamespaceVolumePart(),
    "mariadb",
    "data"
  ].filter(Boolean).join("_");
}

function createJskitMariaDbRuntimeContainer({
  databaseName = "",
  ensureProjectDatabase = true,
  manageProjectDatabase = true,
  required = true,
  targetRoot = ""
} = {}) {
  const configuredDatabaseName = String(databaseName || "").trim();
  const terminalDatabaseName = (contextTargetRoot = "") => {
    if (!manageProjectDatabase) {
      return "";
    }
    return configuredDatabaseName || jskitMariaDbDatabaseName(targetRoot || contextTargetRoot);
  };
  return {
    aliases: [
      JSKIT_MARIADB_HOST
    ],
    checkId: "mariadb",
    containerName: jskitMariaDbContainerName(),
    networkScope: "tenant",
    env: ({ targetRoot: contextTargetRoot = "" } = {}) => {
      const appDatabaseName = terminalDatabaseName(contextTargetRoot);
      return {
        ...(ensureProjectDatabase && appDatabaseName ? { MARIADB_DATABASE: appDatabaseName } : {}),
        MARIADB_ROOT_PASSWORD: JSKIT_MARIADB_ROOT_PASSWORD
      };
    },
    expected: "Shared MariaDB is ready for tenant project databases.",
    health: {
      command: [
        "mariadb-admin",
        "ping",
        "-uroot",
        `-p${JSKIT_MARIADB_ROOT_PASSWORD}`,
        "--silent"
      ],
      interval: "5s",
      retries: 20,
      timeout: "3s"
    },
    id: JSKIT_MARIADB_CONTAINER_ID,
    image: JSKIT_MARIADB_IMAGE,
    label: "MariaDB",
    notRequiredExplanation: "Managed MariaDB starts only when a target selects the Studio-managed database endpoint.",
    ports: [],
    readyCheck: ({ targetRoot: contextTargetRoot = "" } = {}) => {
      const appDatabaseName = ensureProjectDatabase
        ? terminalDatabaseName(contextTargetRoot)
        : "";
      return {
        command: [
          "mariadb",
          "-uroot",
          `-p${JSKIT_MARIADB_ROOT_PASSWORD}`,
          "-e",
          mariaDbCapabilitySql({
            appDatabaseName
          })
        ],
        expected: ensureProjectDatabase
          ? "Managed MariaDB can create the app database and create/drop a temporary probe database."
          : "Shared MariaDB can create/drop a temporary probe database.",
        explanation: "The MariaDB container is reachable, but Studio could not prove DDL rights.",
        observed: ensureProjectDatabase
          ? "App database is present. Probe database and table created and dropped successfully."
          : "Probe database and table created and dropped successfully."
      };
    },
    readyExplanation: manageProjectDatabase
      ? "The managed MariaDB runtime is ready for target database setup."
      : "The shared MariaDB runtime is ready for project databases.",
    required,
    secretEnv: [
      "MARIADB_ROOT_PASSWORD",
      "MYSQL_PWD"
    ],
    terminalEnv: ({ targetRoot: contextTargetRoot = "" } = {}) => {
      const appDatabaseName = terminalDatabaseName(contextTargetRoot);
      return {
        VIBE64_MYSQL_USER: "root",
        ...(appDatabaseName ? { MYSQL_DATABASE: appDatabaseName } : {}),
        MYSQL_HOST: JSKIT_MARIADB_HOST,
        MYSQL_PWD: JSKIT_MARIADB_ROOT_PASSWORD,
        MYSQL_TCP_PORT: "3306"
      };
    },
    volumes: [
      {
        id: "data",
        source: jskitMariaDbVolumeName(),
        target: "/var/lib/mysql"
      }
    ]
  };
}

function createJskitTenantMariaDbRuntimeContainer(options = {}) {
  return createJskitMariaDbRuntimeContainer({
    ...options,
    manageProjectDatabase: false
  });
}

function startJskitMariaDbRepair(targetRoot = "") {
  return createRuntimeContainerRepair(createJskitMariaDbRuntimeContainer({
    targetRoot
  }), {
    adapterId: "jskit",
    targetRoot
  });
}

function createManagedDatabaseDockerArgs(databaseName) {
  return mariaDbCreateDatabaseDockerArgs({
    containerName: jskitMariaDbContainerName(),
    databaseName,
    rootPassword: JSKIT_MARIADB_ROOT_PASSWORD
  });
}

function createManagedDatabaseRepair(databaseName) {
  return mariaDbCreateDatabaseRepair({
    containerName: jskitMariaDbContainerName(),
    databaseName,
    rootPassword: JSKIT_MARIADB_ROOT_PASSWORD
  });
}

function managedMariaDbAccessInstructions(databaseName = "") {
  const database = String(databaseName || "").trim();
  const databaseArg = database ? ` ${shellQuote(database)}` : "";
  return `Container: docker exec -it ${jskitMariaDbContainerName()} mariadb -uroot -p${databaseArg}`;
}

async function readDatabaseHostFromDotEnv(targetRoot = "") {
  return readDatabaseHostFromEnvFile(targetRoot, {
    relativePath: ".env"
  });
}

export {
  createJskitMariaDbRuntimeContainer,
  createJskitTenantMariaDbRuntimeContainer,
  createManagedDatabaseDockerArgs,
  createManagedDatabaseRepair,
  jskitMariaDbDatabaseName,
  jskitMariaDbContainerName,
  jskitMariaDbVolumeName,
  JSKIT_HOST_DATABASE_HOST,
  JSKIT_MARIADB_CONTAINER_ID,
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_ROOT_PASSWORD,
  managedMariaDbAccessInstructions,
  mariaDbCapabilitySql,
  readDatabaseHostFromDotEnv,
  startJskitMariaDbRepair,
  targetWantsJskitMariaDb,
  validateDatabaseName
};
