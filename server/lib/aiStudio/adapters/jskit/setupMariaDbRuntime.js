import {
  shellQuote
} from "../../../shellCommands.js";
import {
  AI_STUDIO_RUNTIME_HOST_ALIAS,
  createRuntimeContainerRepair,
  runtimeContainerName,
  runtimeContainerNetworkDockerArgs
} from "../../runtimeContainers.js";
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

async function targetWantsJskitMariaDb(targetRoot = "", toolkit) {
  const lockJsonResult = await toolkit.readTargetJson(".jskit/lock.json", {
    targetRoot
  });
  const packageJson = await readTargetPackageJson(targetRoot, toolkit) || {};
  const lockJson = lockJsonResult.ok ? lockJsonResult.value : {};
  const names = allDependencyNames(packageJson, lockJson?.installedPackages || {});
  return [...names].some((name) => name.includes("database-runtime-mysql"));
}

function mariaDbCapabilitySql() {
  return [
    `CREATE DATABASE IF NOT EXISTS \`${JSKIT_MARIADB_PROBE_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`${JSKIT_MARIADB_PROBE_DATABASE}\`.\`${JSKIT_MARIADB_PROBE_TABLE}\` (id INT NOT NULL PRIMARY KEY)`,
    `DROP TABLE \`${JSKIT_MARIADB_PROBE_DATABASE}\`.\`${JSKIT_MARIADB_PROBE_TABLE}\``,
    `DROP DATABASE \`${JSKIT_MARIADB_PROBE_DATABASE}\``
  ].join("; ");
}

function jskitDatabaseDockerArgs(databaseHost = "", targetRoot = "") {
  if (String(databaseHost || "").trim() === JSKIT_MARIADB_HOST) {
    return runtimeContainerNetworkDockerArgs(targetRoot);
  }
  return [
    "--add-host",
    `${JSKIT_HOST_DATABASE_HOST}:host-gateway`
  ];
}

function jskitDatabaseDockerArgsForTarget(databaseHost = "", targetRoot = "") {
  return jskitDatabaseDockerArgs(databaseHost, targetRoot);
}

function createJskitMariaDbRuntimeContainer({
  required = true
} = {}) {
  return {
    aliases: [
      JSKIT_MARIADB_HOST
    ],
    checkId: "jskit-mariadb",
    env: {
      MARIADB_ROOT_PASSWORD: JSKIT_MARIADB_ROOT_PASSWORD
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
        mariaDbCapabilitySql()
      ],
      expected: "Managed JSKIT MariaDB can create/drop a temporary probe database.",
      explanation: "The MariaDB container is reachable, but Studio could not prove DDL rights.",
      observed: "Probe database and table created and dropped successfully."
    },
    readyExplanation: "The JSKIT managed MariaDB runtime is ready for target database setup.",
    required,
    secretEnv: [
      "MARIADB_ROOT_PASSWORD"
    ],
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
  return createRuntimeContainerRepair(createJskitMariaDbRuntimeContainer(), {
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
  jskitDatabaseDockerArgs,
  jskitDatabaseDockerArgsForTarget,
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
