import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  createDoctorRepair
} from "../../../doctorCheckItems.js";
import {
  dockerCommand,
  shellQuote
} from "../../../shellCommands.js";

const JSKIT_MARIADB_CONTAINER = "ai-studio-jskit-mariadb";
const JSKIT_MARIADB_HOST = "ai-studio-mariadb";
const JSKIT_MARIADB_HOST_PORT = "13306";
const JSKIT_MARIADB_IMAGE = "mariadb:12.0.2";
const JSKIT_MARIADB_NETWORK = "ai-studio-jskit";
const JSKIT_MARIADB_ROOT_PASSWORD = "ai_studio_jskit_root";
const JSKIT_MARIADB_VOLUME = "ai_studio_jskit_mariadb_data";
const JSKIT_MARIADB_PROBE_DATABASE = "ai_studio_jskit_probe";
const JSKIT_MARIADB_PROBE_TABLE = "capability_probe";
const JSKIT_HOST_DATABASE_HOST = "ai-studio-host";

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

function managedMariaDbRunArgs(maskPassword = false) {
  const password = maskPassword ? "*****" : JSKIT_MARIADB_ROOT_PASSWORD;
  return [
    "run",
    "-d",
    "--name",
    JSKIT_MARIADB_CONTAINER,
    "--network",
    JSKIT_MARIADB_NETWORK,
    "--network-alias",
    JSKIT_MARIADB_HOST,
    "-p",
    `127.0.0.1:${JSKIT_MARIADB_HOST_PORT}:3306`,
    "-e",
    `MARIADB_ROOT_PASSWORD=${password}`,
    "-v",
    `${JSKIT_MARIADB_VOLUME}:/var/lib/mysql`,
    "--health-cmd",
    `mariadb-admin ping -uroot -p${password} --silent`,
    "--health-interval",
    "5s",
    "--health-timeout",
    "3s",
    "--health-retries",
    "20",
    JSKIT_MARIADB_IMAGE
  ];
}

function jskitDatabaseDockerArgs(databaseHost = "") {
  const args = [
    "--add-host",
    `${JSKIT_HOST_DATABASE_HOST}:host-gateway`
  ];
  if (String(databaseHost || "").trim() === JSKIT_MARIADB_HOST) {
    return [
      "--network",
      JSKIT_MARIADB_NETWORK,
      ...args
    ];
  }
  return args;
}

function startJskitMariaDbRepair() {
  return createDoctorRepair({
    actionId: "start-jskit-mariadb",
    command: [
      `${dockerCommand(["network", "create", JSKIT_MARIADB_NETWORK])} || true`,
      dockerCommand(["volume", "create", JSKIT_MARIADB_VOLUME]),
      dockerCommand(managedMariaDbRunArgs(true)),
      `docker exec ${JSKIT_MARIADB_CONTAINER} mariadb-admin ping -uroot -p***** --silent`
    ].join("\n"),
    kind: "terminal",
    label: "Start JSKIT MariaDB"
  });
}

function startJskitMariaDbScript() {
  return [
    "set -e",
    `MARIADB_ROOT_PASSWORD=${shellQuote(JSKIT_MARIADB_ROOT_PASSWORD)}`,
    `MARIADB_CONTAINER=${shellQuote(JSKIT_MARIADB_CONTAINER)}`,
    `MARIADB_NETWORK=${shellQuote(JSKIT_MARIADB_NETWORK)}`,
    `MARIADB_HOST=${shellQuote(JSKIT_MARIADB_HOST)}`,
    `echo '$ ${dockerCommand(["network", "create", JSKIT_MARIADB_NETWORK])} || true'`,
    `docker network create ${shellQuote(JSKIT_MARIADB_NETWORK)} >/dev/null 2>&1 || true`,
    `echo '$ ${dockerCommand(["volume", "create", JSKIT_MARIADB_VOLUME])}'`,
    `docker volume create ${shellQuote(JSKIT_MARIADB_VOLUME)}`,
    `if ! docker inspect ${shellQuote(JSKIT_MARIADB_CONTAINER)} >/dev/null 2>&1; then`,
    `  echo '$ ${dockerCommand(managedMariaDbRunArgs(true))}'`,
    `  docker run -d --name ${shellQuote(JSKIT_MARIADB_CONTAINER)} --network "$MARIADB_NETWORK" --network-alias "$MARIADB_HOST" -p ${shellQuote(`127.0.0.1:${JSKIT_MARIADB_HOST_PORT}:3306`)} -e MARIADB_ROOT_PASSWORD="$MARIADB_ROOT_PASSWORD" -v ${shellQuote(`${JSKIT_MARIADB_VOLUME}:/var/lib/mysql`)} --health-cmd "mariadb-admin ping -uroot -p$MARIADB_ROOT_PASSWORD --silent" --health-interval 5s --health-timeout 3s --health-retries 20 ${shellQuote(JSKIT_MARIADB_IMAGE)}`,
    "else",
    `  if [ "$(docker inspect ${shellQuote(JSKIT_MARIADB_CONTAINER)} --format '{{.State.Running}}')" != "true" ]; then`,
    `    echo '$ ${dockerCommand(["start", JSKIT_MARIADB_CONTAINER])}'`,
    `    docker start ${shellQuote(JSKIT_MARIADB_CONTAINER)}`,
    "  fi",
    `  if ! docker inspect ${shellQuote(JSKIT_MARIADB_CONTAINER)} --format '{{json .NetworkSettings.Networks}}' | grep -q "\"$MARIADB_NETWORK\""; then`,
    "    docker network connect --alias \"$MARIADB_HOST\" \"$MARIADB_NETWORK\" \"$MARIADB_CONTAINER\" || true",
    "  fi",
    "fi",
    "for attempt in $(seq 1 40); do",
    `  echo '$ docker exec ${JSKIT_MARIADB_CONTAINER} mariadb-admin ping -uroot -p***** --silent'`,
    `  if docker exec ${shellQuote(JSKIT_MARIADB_CONTAINER)} mariadb-admin ping -uroot -p"$MARIADB_ROOT_PASSWORD" --silent; then`,
    "    exit 0",
    "  fi",
    "  sleep 1.5",
    "done",
    "echo 'Timed out waiting for JSKIT MariaDB to accept connections.' >&2",
    "exit 1"
  ].join("\n");
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

function createManagedDatabaseDockerArgs(databaseName) {
  const escaped = escapeMariaDbIdentifier(databaseName);
  return [
    "exec",
    "-it",
    JSKIT_MARIADB_CONTAINER,
    "mariadb",
    "-uroot",
    `-p${JSKIT_MARIADB_ROOT_PASSWORD}`,
    "-e",
    `CREATE DATABASE IF NOT EXISTS \`${escaped}\`; SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${databaseName}';`
  ];
}

function createManagedDatabaseRepair(databaseName) {
  return createDoctorRepair({
    actionId: "terminal-create-app-db",
    command: dockerCommand(createManagedDatabaseDockerArgs(databaseName)),
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

function managedMariaDbAccessInstructions(databaseName = "") {
  const database = String(databaseName || "").trim();
  const databaseArg = database ? ` ${shellQuote(database)}` : "";
  return [
    `Container: docker exec -it ${JSKIT_MARIADB_CONTAINER} mariadb -uroot -p${databaseArg}`,
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

function databaseHostFromEnvText(text = "") {
  for (const line of String(text || "").split(/\r?\n/u)) {
    const host = parseDotEnvValue(line, "DB_HOST");
    if (host) {
      return host;
    }
  }
  return "";
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
  createManagedDatabaseDockerArgs,
  createManagedDatabaseRepair,
  databaseHostFromEnvText,
  jskitDatabaseDockerArgs,
  JSKIT_HOST_DATABASE_HOST,
  JSKIT_MARIADB_CONTAINER,
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_HOST_PORT,
  JSKIT_MARIADB_ROOT_PASSWORD,
  managedMariaDbAccessInstructions,
  mariaDbCapabilitySql,
  readDatabaseHostFromDotEnv,
  startJskitMariaDbRepair,
  startJskitMariaDbScript,
  targetWantsJskitMariaDb,
  validateDatabaseName
};
