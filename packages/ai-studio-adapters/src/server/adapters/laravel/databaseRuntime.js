import {
  createRuntimeContainerRepair,
  runtimeContainerName
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  createManagedDatabaseRuntimeContainer,
  managedDatabaseConnection,
  managedDatabaseNameFromTargetRoot
} from "@local/studio-terminal-core/server/managedDatabases";
import {
  selectedConfigValue
} from "../../configValues.js";
import {
  envFileWriteScript,
  envValuesFromLines
} from "../../adapterHelpers/setupEnvFiles.js";
import {
  LARAVEL_DATABASE_RUNTIME_CONFIG
} from "./constants.js";

const LARAVEL_DATABASE_RUNTIMES = new Set(["sqlite", "postgres", "mysql", "mariadb"]);
const LARAVEL_DATABASE_ENV_KEYS = Object.freeze([
  "DB_CONNECTION",
  "DB_HOST",
  "DB_PORT",
  "DB_DATABASE",
  "DB_USERNAME",
  "DB_PASSWORD"
]);
const LARAVEL_POSTGRES_HOST = "laravel-postgres";
const LARAVEL_POSTGRES_HOST_PORT = "15433";
const LARAVEL_POSTGRES_PASSWORD = "laravel_password";
const LARAVEL_POSTGRES_USER = "laravel";
const LARAVEL_MYSQL_HOST = "laravel-mysql";
const LARAVEL_MYSQL_HOST_PORT = "13308";
const LARAVEL_MYSQL_ROOT_PASSWORD = "laravel_root_password";
const LARAVEL_MARIADB_HOST = "laravel-mariadb";
const LARAVEL_MARIADB_HOST_PORT = "13309";
const LARAVEL_MARIADB_ROOT_PASSWORD = "laravel_root_password";

function selectedLaravelDatabaseRuntime(config = {}) {
  return selectedConfigValue(config, LARAVEL_DATABASE_RUNTIME_CONFIG, LARAVEL_DATABASE_RUNTIMES, "sqlite");
}

function laravelDatabaseNameFromTargetRoot(targetRoot = "") {
  return managedDatabaseNameFromTargetRoot(targetRoot, {
    fallback: "laravel_app"
  });
}

function laravelDatabaseConnection(runtime = "sqlite", targetRoot = "") {
  if (runtime === "postgres") {
    return managedDatabaseConnection({
      adapterId: "laravel",
      databaseNameFallback: "laravel_app",
      host: LARAVEL_POSTGRES_HOST,
      password: LARAVEL_POSTGRES_PASSWORD,
      runtime,
      targetRoot,
      username: LARAVEL_POSTGRES_USER
    });
  }
  if (runtime === "mysql") {
    return managedDatabaseConnection({
      adapterId: "laravel",
      databaseNameFallback: "laravel_app",
      host: LARAVEL_MYSQL_HOST,
      rootPassword: LARAVEL_MYSQL_ROOT_PASSWORD,
      runtime,
      targetRoot
    });
  }
  if (runtime === "mariadb") {
    return managedDatabaseConnection({
      adapterId: "laravel",
      databaseNameFallback: "laravel_app",
      host: LARAVEL_MARIADB_HOST,
      rootPassword: LARAVEL_MARIADB_ROOT_PASSWORD,
      runtime,
      targetRoot
    });
  }
  return managedDatabaseConnection({
    adapterId: "laravel",
    runtime: "sqlite",
    targetRoot
  });
}

function createLaravelRuntimeContainers({
  config = {},
  targetRoot = ""
} = {}) {
  const runtime = selectedLaravelDatabaseRuntime(config);
  if (runtime === "postgres") {
    return [
      createManagedDatabaseRuntimeContainer({
        adapterId: "laravel",
        checkId: "laravel-postgres",
        databaseNameFallback: "laravel_app",
        host: LARAVEL_POSTGRES_HOST,
        hostPort: LARAVEL_POSTGRES_HOST_PORT,
        label: "Laravel PostgreSQL",
        password: LARAVEL_POSTGRES_PASSWORD,
        runtime,
        targetRoot,
        username: LARAVEL_POSTGRES_USER
      })
    ];
  }
  if (runtime === "mysql") {
    return [
      createManagedDatabaseRuntimeContainer({
        adapterId: "laravel",
        checkId: "laravel-mysql",
        databaseNameFallback: "laravel_app",
        host: LARAVEL_MYSQL_HOST,
        hostPort: LARAVEL_MYSQL_HOST_PORT,
        label: "Laravel MySQL",
        rootPassword: LARAVEL_MYSQL_ROOT_PASSWORD,
        runtime,
        targetRoot
      })
    ];
  }
  if (runtime === "mariadb") {
    return [
      createManagedDatabaseRuntimeContainer({
        adapterId: "laravel",
        checkId: "laravel-mariadb",
        databaseNameFallback: "laravel_app",
        host: LARAVEL_MARIADB_HOST,
        hostPort: LARAVEL_MARIADB_HOST_PORT,
        label: "Laravel MariaDB",
        rootPassword: LARAVEL_MARIADB_ROOT_PASSWORD,
        runtime,
        targetRoot
      })
    ];
  }
  return [];
}

function laravelRuntimeContainerName({
  config = {},
  targetRoot = ""
} = {}) {
  const runtime = selectedLaravelDatabaseRuntime(config);
  if (!["postgres", "mysql", "mariadb"].includes(runtime)) {
    return "";
  }
  return runtimeContainerName({
    adapterId: "laravel",
    containerId: `laravel-${runtime}`,
    targetRoot
  });
}

function startLaravelRuntimeRepair({
  config = {},
  targetRoot = ""
} = {}) {
  const [container] = createLaravelRuntimeContainers({
    config,
    targetRoot
  });
  return container
    ? createRuntimeContainerRepair(container, {
        adapterId: "laravel",
        targetRoot
      })
    : null;
}

function laravelDatabaseEnvLines({
  config = {},
  targetRoot = ""
} = {}) {
  const runtime = selectedLaravelDatabaseRuntime(config);
  if (runtime === "sqlite") {
    return [
      "DB_CONNECTION=sqlite"
    ];
  }
  const connection = laravelDatabaseConnection(runtime, targetRoot);
  const driver = runtime === "postgres" ? "pgsql" : runtime;
  return [
    `DB_CONNECTION=${driver}`,
    `DB_HOST=${connection.host}`,
    `DB_PORT=${connection.port}`,
    `DB_DATABASE=${connection.database}`,
    `DB_USERNAME=${connection.username}`,
    `DB_PASSWORD=${connection.password}`
  ];
}

function laravelDatabaseEnvWriteScript({
  config = {},
  targetRoot = ""
} = {}) {
  const runtime = selectedLaravelDatabaseRuntime(config);
  const lines = laravelDatabaseEnvLines({
    config,
    targetRoot
  });
  return [
    envFileWriteScript({
      relativePath: ".env",
      removeKeys: LARAVEL_DATABASE_ENV_KEYS,
      replaceExisting: true,
      values: envValuesFromLines(lines)
    }),
    ...(runtime === "sqlite" ? [
      "mkdir -p database",
      "touch database/database.sqlite"
    ] : []),
    "echo 'Wrote Laravel database settings for AI Studio-managed runtime.'"
  ].join("\n");
}

export {
  LARAVEL_DATABASE_RUNTIMES,
  LARAVEL_MARIADB_HOST,
  LARAVEL_MARIADB_HOST_PORT,
  LARAVEL_MYSQL_HOST,
  LARAVEL_MYSQL_HOST_PORT,
  LARAVEL_POSTGRES_HOST,
  LARAVEL_POSTGRES_HOST_PORT,
  createLaravelRuntimeContainers,
  laravelDatabaseConnection,
  laravelDatabaseEnvLines,
  laravelDatabaseEnvWriteScript,
  laravelDatabaseNameFromTargetRoot,
  laravelRuntimeContainerName,
  selectedLaravelDatabaseRuntime,
  startLaravelRuntimeRepair
};
