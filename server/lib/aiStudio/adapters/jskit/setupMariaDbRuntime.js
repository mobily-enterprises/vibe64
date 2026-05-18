import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  createDoctorRepair
} from "../../../doctorCheckItems.js";
import {
  dockerCommand,
  shellQuote
} from "../../../shellCommands.js";
import {
  AI_STUDIO_RUNTIME_HOST_ALIAS,
  createRuntimeContainerRepair,
  runtimeContainerName,
  runtimeContainerNetworkDockerArgs
} from "../../runtimeContainers.js";

const JSKIT_MARIADB_CONTAINER_ID = "jskit-mariadb";
const JSKIT_MARIADB_HOST = "ai-studio-mariadb";
const JSKIT_MARIADB_HOST_PORT = "13306";
const JSKIT_MARIADB_IMAGE = "mariadb:12.0.2";
const JSKIT_MARIADB_ROOT_PASSWORD = "ai_studio_jskit_root";
const JSKIT_MARIADB_PROBE_DATABASE = "ai_studio_jskit_probe";
const JSKIT_MARIADB_PROBE_TABLE = "capability_probe";
const JSKIT_HOST_DATABASE_HOST = AI_STUDIO_RUNTIME_HOST_ALIAS;

function packageDependencyNames(packageJson = {}) {
  const sections = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies
  ];
  return new Set(sections.flatMap((section) => {
    return section && typeof section === "object" && !Array.isArray(section)
      ? Object.keys(section)
      : [];
  }));
}

async function targetWantsJskitMariaDb(targetRoot = "", toolkit) {
  const packageJsonResult = await toolkit.readTargetJson("package.json", {
    targetRoot
  });
  const lockJsonResult = await toolkit.readTargetJson(".jskit/lock.json", {
    targetRoot
  });
  const packageJson = packageJsonResult.ok ? packageJsonResult.value : {};
  const lockJson = lockJsonResult.ok ? lockJsonResult.value : {};
  const names = new Set([
    ...packageDependencyNames(packageJson),
    ...Object.keys(lockJson?.installedPackages || {})
  ]);
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
    ports: [
      {
        container: 3306,
        host: "127.0.0.1",
        hostPort: JSKIT_MARIADB_HOST_PORT
      }
    ],
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

function escapeMariaDbIdentifier(value) {
  return String(value).replaceAll("`", "``");
}

function validateDatabaseName(value) {
  const databaseName = String(value || "").trim();
  if (!/^[A-Za-z0-9_]+$/u.test(databaseName)) {
    return {
      databaseName,
      ok: false
    };
  }
  return {
    databaseName,
    ok: true
  };
}

function createManagedDatabaseDockerArgs(databaseName, targetRoot = "") {
  const escaped = escapeMariaDbIdentifier(databaseName);
  return [
    "exec",
    "-it",
    jskitMariaDbContainerName(targetRoot),
    "mariadb",
    "-uroot",
    `-p${JSKIT_MARIADB_ROOT_PASSWORD}`,
    "-e",
    `CREATE DATABASE IF NOT EXISTS \`${escaped}\`; SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${databaseName}';`
  ];
}

function createManagedDatabaseRepair(databaseName, targetRoot = "") {
  return createDoctorRepair({
    actionId: "terminal-create-app-db",
    autoRun: true,
    command: dockerCommand(createManagedDatabaseDockerArgs(databaseName, targetRoot)),
    fields: [
      {
        defaultValue: databaseName,
        id: "databaseName",
        label: "Database name",
        required: true,
        type: "text"
      }
    ],
    label: "Create app database"
  });
}

function managedMariaDbAccessInstructions(databaseName = "", targetRoot = "") {
  const database = String(databaseName || "").trim();
  const databaseArg = database ? ` ${shellQuote(database)}` : "";
  return [
    `Container: docker exec -it ${jskitMariaDbContainerName(targetRoot)} mariadb -uroot -p${databaseArg}`,
    `Host: mariadb -h 127.0.0.1 -P ${JSKIT_MARIADB_HOST_PORT} -uroot -p${databaseArg}`
  ].join("\n");
}

function parseDotEnvValue(line = "", key = "") {
  const match = new RegExp(`^${key}=(.*)$`, "u").exec(String(line || "").trim());
  if (!match) {
    return "";
  }
  const rawValue = match[1].trim();
  if ((rawValue.startsWith("\"") && rawValue.endsWith("\"")) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

function databaseHostFromUrl(url = "") {
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

function databaseHostFromEnvText(text = "") {
  let databaseUrl = "";
  for (const line of String(text || "").split(/\r?\n/u)) {
    const host = parseDotEnvValue(line, "DB_HOST");
    if (host) {
      return host;
    }
    databaseUrl ||= parseDotEnvValue(line, "DATABASE_URL");
  }
  return databaseHostFromUrl(databaseUrl);
}

async function readDatabaseHostFromDotEnv(targetRoot = "") {
  try {
    return databaseHostFromEnvText(await readFile(path.join(targetRoot, ".env"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export {
  createJskitMariaDbRuntimeContainer,
  createManagedDatabaseDockerArgs,
  createManagedDatabaseRepair,
  databaseHostFromEnvText,
  jskitDatabaseDockerArgs,
  jskitDatabaseDockerArgsForTarget,
  jskitMariaDbContainerName,
  JSKIT_HOST_DATABASE_HOST,
  JSKIT_MARIADB_CONTAINER_ID,
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_HOST_PORT,
  JSKIT_MARIADB_ROOT_PASSWORD,
  managedMariaDbAccessInstructions,
  mariaDbCapabilitySql,
  readDatabaseHostFromDotEnv,
  startJskitMariaDbRepair,
  targetWantsJskitMariaDb,
  validateDatabaseName
};
