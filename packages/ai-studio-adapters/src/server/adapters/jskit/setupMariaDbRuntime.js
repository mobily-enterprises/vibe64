import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  managedDatabaseNameFromTargetRoot
} from "@local/studio-terminal-core/server/managedDatabases";
import {
  AI_STUDIO_RUNTIME_HOST_ALIAS,
  createRuntimeContainerRepair,
  runtimeContainerName
} from "@local/studio-terminal-core/server/runtimeContainers";
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

const JSKIT_MARIADB_CONTAINER_ID = "jskit-mariadb";
const JSKIT_MARIADB_HOST = "ai-studio-mariadb";
const JSKIT_MARIADB_IMAGE = "mariadb:12.0.2";
const JSKIT_MARIADB_ROOT_PASSWORD = "ai_studio_jskit_root";
const JSKIT_MARIADB_PROBE_DATABASE = "ai_studio_jskit_probe";
const JSKIT_MARIADB_PROBE_TABLE = "capability_probe";
const JSKIT_HOST_DATABASE_HOST = AI_STUDIO_RUNTIME_HOST_ALIAS;
const JSKIT_MARIADB_PROBE_SQL_VARIABLE = "@ai_studio_jskit_probe_sql";
const JSKIT_MARIADB_PROBE_STATEMENT = "ai_studio_jskit_probe_statement";

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
  const probeDatabaseVariable = "@ai_studio_jskit_probe_database";
  const probeIdentifierVariable = "@ai_studio_jskit_probe_identifier";
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

function createJskitMariaDbRuntimeContainer({
  databaseName = "",
  required = true,
  targetRoot = ""
} = {}) {
  const configuredDatabaseName = String(databaseName || "").trim();
  const terminalDatabaseName = (contextTargetRoot = "") => {
    return configuredDatabaseName || jskitMariaDbDatabaseName(targetRoot || contextTargetRoot);
  };
  return {
    aliases: [
      JSKIT_MARIADB_HOST
    ],
    checkId: "jskit-mariadb",
    env: ({ targetRoot: contextTargetRoot = "" } = {}) => {
      return {
        MARIADB_DATABASE: terminalDatabaseName(contextTargetRoot),
        MARIADB_ROOT_PASSWORD: JSKIT_MARIADB_ROOT_PASSWORD
      };
    },
    expected: "Managed JSKIT MariaDB is ready when the target declares a MySQL-compatible runtime.",
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
    label: "JSKIT MariaDB",
    notRequiredExplanation: "Managed MariaDB starts only when the JSKIT target selects the Studio-managed database endpoint.",
    ports: [],
    readyCheck: {
      command: [
        "mariadb",
        "-uroot",
        `-p${JSKIT_MARIADB_ROOT_PASSWORD}`,
        "-e",
        mariaDbCapabilitySql({
          appDatabaseName: terminalDatabaseName()
        })
      ],
      expected: "Managed JSKIT MariaDB can create the app database and create/drop a temporary probe database.",
      explanation: "The MariaDB container is reachable, but Studio could not prove DDL rights.",
      observed: "App database is present. Probe database and table created and dropped successfully."
    },
    readyExplanation: "The JSKIT managed MariaDB runtime is ready for target database setup.",
    required,
    secretEnv: [
      "MARIADB_ROOT_PASSWORD",
      "MYSQL_PWD"
    ],
    terminalEnv: ({ targetRoot: contextTargetRoot = "" } = {}) => {
      return {
        AI_STUDIO_MYSQL_USER: "root",
        MYSQL_DATABASE: terminalDatabaseName(contextTargetRoot),
        MYSQL_HOST: JSKIT_MARIADB_HOST,
        MYSQL_PWD: JSKIT_MARIADB_ROOT_PASSWORD,
        MYSQL_TCP_PORT: "3306"
      };
    },
    volumes: [
      {
        id: "data",
        target: "/var/lib/mysql"
      }
    ]
  };
}

function jskitMariaDbContainerName(targetRoot = "") {
  return runtimeContainerName({
    adapterId: "jskit",
    containerId: JSKIT_MARIADB_CONTAINER_ID,
    targetRoot
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

function createManagedDatabaseDockerArgs(databaseName, targetRoot = "") {
  return mariaDbCreateDatabaseDockerArgs({
    containerName: jskitMariaDbContainerName(targetRoot),
    databaseName,
    rootPassword: JSKIT_MARIADB_ROOT_PASSWORD
  });
}

function createManagedDatabaseRepair(databaseName, targetRoot = "") {
  return mariaDbCreateDatabaseRepair({
    containerName: jskitMariaDbContainerName(targetRoot),
    databaseName,
    rootPassword: JSKIT_MARIADB_ROOT_PASSWORD
  });
}

function managedMariaDbAccessInstructions(databaseName = "", targetRoot = "") {
  const database = String(databaseName || "").trim();
  const databaseArg = database ? ` ${shellQuote(database)}` : "";
  return `Container: docker exec -it ${jskitMariaDbContainerName(targetRoot)} mariadb -uroot -p${databaseArg}`;
}

async function readDatabaseHostFromDotEnv(targetRoot = "") {
  return readDatabaseHostFromEnvFile(targetRoot, {
    relativePath: ".env"
  });
}

export {
  createJskitMariaDbRuntimeContainer,
  createManagedDatabaseDockerArgs,
  createManagedDatabaseRepair,
  jskitMariaDbDatabaseName,
  jskitMariaDbContainerName,
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
