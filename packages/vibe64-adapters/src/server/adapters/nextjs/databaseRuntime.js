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
  NEXTJS_DATABASE_RUNTIME_CONFIG
} from "./constants.js";

const NEXTJS_DATABASE_RUNTIMES = new Set(["none", "postgres", "mysql"]);
const NEXTJS_DATABASE_ENV_KEYS = Object.freeze([
  "DATABASE_URL"
]);
const NEXTJS_POSTGRES_HOST = "nextjs-postgres";
const NEXTJS_POSTGRES_HOST_PORT = "15432";
const NEXTJS_POSTGRES_PASSWORD = "nextjs_password";
const NEXTJS_POSTGRES_USER = "nextjs";
const NEXTJS_MYSQL_HOST = "nextjs-mysql";
const NEXTJS_MYSQL_HOST_PORT = "13307";
const NEXTJS_MYSQL_ROOT_PASSWORD = "nextjs_root_password";

function selectedNextjsDatabaseRuntime(config = {}) {
  return selectedConfigValue(config, NEXTJS_DATABASE_RUNTIME_CONFIG, NEXTJS_DATABASE_RUNTIMES, "postgres");
}

function databaseNameFromTargetRoot(targetRoot = "") {
  return managedDatabaseNameFromTargetRoot(targetRoot, {
    fallback: "nextjs_app"
  });
}

function nextjsPostgresDatabaseUrl(targetRoot = "", {
  databaseName = ""
} = {}) {
  return managedDatabaseConnection({
    adapterId: "nextjs",
    databaseName,
    databaseNameFallback: "nextjs_app",
    host: NEXTJS_POSTGRES_HOST,
    password: NEXTJS_POSTGRES_PASSWORD,
    runtime: "postgres",
    targetRoot,
    username: NEXTJS_POSTGRES_USER
  }).url;
}

function nextjsMysqlDatabaseUrl(targetRoot = "", {
  databaseName = ""
} = {}) {
  return managedDatabaseConnection({
    adapterId: "nextjs",
    databaseName,
    databaseNameFallback: "nextjs_app",
    host: NEXTJS_MYSQL_HOST,
    rootPassword: NEXTJS_MYSQL_ROOT_PASSWORD,
    runtime: "mysql",
    targetRoot
  }).url;
}

function expectedNextjsDatabaseUrl(runtime = "none", targetRoot = "", {
  databaseName = ""
} = {}) {
  if (runtime === "postgres") {
    return nextjsPostgresDatabaseUrl(targetRoot, {
      databaseName
    });
  }
  if (runtime === "mysql") {
    return nextjsMysqlDatabaseUrl(targetRoot, {
      databaseName
    });
  }
  return "";
}

function createNextjsPostgresRuntimeContainer(targetRoot = "", {
  databaseName = ""
} = {}) {
  return createManagedDatabaseRuntimeContainer({
    adapterId: "nextjs",
    checkId: "nextjs-postgres",
    databaseName,
    databaseNameFallback: "nextjs_app",
    host: NEXTJS_POSTGRES_HOST,
    hostPort: NEXTJS_POSTGRES_HOST_PORT,
    label: "Next.js PostgreSQL",
    password: NEXTJS_POSTGRES_PASSWORD,
    runtime: "postgres",
    targetRoot,
    username: NEXTJS_POSTGRES_USER
  });
}

function createNextjsMysqlRuntimeContainer(targetRoot = "", {
  databaseName = ""
} = {}) {
  return createManagedDatabaseRuntimeContainer({
    adapterId: "nextjs",
    checkId: "nextjs-mysql",
    databaseName,
    databaseNameFallback: "nextjs_app",
    host: NEXTJS_MYSQL_HOST,
    hostPort: NEXTJS_MYSQL_HOST_PORT,
    label: "Next.js MySQL",
    rootPassword: NEXTJS_MYSQL_ROOT_PASSWORD,
    runtime: "mysql",
    targetRoot
  });
}

function createNextjsRuntimeContainers({
  config = {},
  databaseName = "",
  targetRoot = ""
} = {}) {
  const runtime = selectedNextjsDatabaseRuntime(config);
  if (runtime === "postgres") {
    return [createNextjsPostgresRuntimeContainer(targetRoot, {
      databaseName
    })];
  }
  if (runtime === "mysql") {
    return [createNextjsMysqlRuntimeContainer(targetRoot, {
      databaseName
    })];
  }
  return [];
}

function nextjsRuntimeContainerName({
  config = {},
  targetRoot = ""
} = {}) {
  const runtime = selectedNextjsDatabaseRuntime(config);
  if (runtime === "postgres") {
    return runtimeContainerName({
      adapterId: "nextjs",
      containerId: "nextjs-postgres",
      targetRoot
    });
  }
  if (runtime === "mysql") {
    return runtimeContainerName({
      adapterId: "nextjs",
      containerId: "nextjs-mysql",
      targetRoot
    });
  }
  return "";
}

function startNextjsRuntimeRepair({
  config = {},
  targetRoot = ""
} = {}) {
  const [container] = createNextjsRuntimeContainers({
    config,
    targetRoot
  });
  return container
    ? createRuntimeContainerRepair(container, {
        adapterId: "nextjs",
        targetRoot
      })
    : null;
}

function nextjsDatabaseEnvLines({
  config = {},
  databaseName = "",
  targetRoot = ""
} = {}) {
  const runtime = selectedNextjsDatabaseRuntime(config);
  const databaseUrl = expectedNextjsDatabaseUrl(runtime, targetRoot, {
    databaseName
  });
  return databaseUrl ? [`DATABASE_URL=${databaseUrl}`] : [];
}

function nextjsDatabaseEnvWriteScript({
  config = {},
  targetRoot = ""
} = {}) {
  const lines = nextjsDatabaseEnvLines({
    config,
    targetRoot
  });
  return [
    envFileWriteScript({
      relativePath: ".env.local",
      removeKeys: NEXTJS_DATABASE_ENV_KEYS,
      replaceExisting: true,
      values: envValuesFromLines(lines)
    }),
    "echo 'Wrote Next.js database settings for Vibe64-managed runtime.'"
  ].join("\n");
}

export {
  NEXTJS_DATABASE_RUNTIMES,
  NEXTJS_MYSQL_HOST,
  NEXTJS_MYSQL_HOST_PORT,
  NEXTJS_POSTGRES_HOST,
  NEXTJS_POSTGRES_HOST_PORT,
  createNextjsRuntimeContainers,
  databaseNameFromTargetRoot,
  expectedNextjsDatabaseUrl,
  nextjsDatabaseEnvLines,
  nextjsDatabaseEnvWriteScript,
  nextjsRuntimeContainerName,
  selectedNextjsDatabaseRuntime,
  startNextjsRuntimeRepair
};
