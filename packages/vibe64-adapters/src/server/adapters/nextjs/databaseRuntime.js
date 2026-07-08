import {
  managedDatabaseConnection,
  managedDatabaseNameFromTargetRoot,
  managedDatabasePromptServiceFacts
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

const NEXTJS_DATABASE_RUNTIMES = new Set(["none", "postgres", "mariadb"]);
const NEXTJS_DATABASE_ENV_KEYS = Object.freeze([
  "DATABASE_URL"
]);
const NEXTJS_DATABASE_HOST = "127.0.0.1";
const NEXTJS_POSTGRES_PASSWORD = "nextjs_password";
const NEXTJS_POSTGRES_USER = "nextjs";
const NEXTJS_MARIADB_ROOT_PASSWORD = "nextjs_root_password";

function nextjsDatabaseHostPort(runtime = "postgres") {
  return runtime === "postgres" ? "5432" : "3306";
}

function selectedNextjsDatabaseRuntime(config = {}) {
  return selectedConfigValue(config, NEXTJS_DATABASE_RUNTIME_CONFIG, NEXTJS_DATABASE_RUNTIMES, "postgres");
}

function databaseNameFromTargetRoot(targetRoot = "") {
  return managedDatabaseNameFromTargetRoot(targetRoot, {
    fallback: "nextjs_app"
  });
}

function nextjsPostgresDatabaseConnection(targetRoot = "", {
  databaseName = ""
} = {}) {
  return managedDatabaseConnection({
    adapterId: "nextjs",
    databaseName,
    databaseNameFallback: "nextjs_app",
    host: NEXTJS_DATABASE_HOST,
    password: NEXTJS_POSTGRES_PASSWORD,
    port: nextjsDatabaseHostPort("postgres"),
    runtime: "postgres",
    targetRoot,
    username: NEXTJS_POSTGRES_USER
  });
}

function nextjsMariaDbDatabaseConnection(targetRoot = "", {
  databaseName = ""
} = {}) {
  return managedDatabaseConnection({
    adapterId: "nextjs",
    databaseName,
    databaseNameFallback: "nextjs_app",
    host: NEXTJS_DATABASE_HOST,
    port: nextjsDatabaseHostPort("mariadb"),
    rootPassword: NEXTJS_MARIADB_ROOT_PASSWORD,
    runtime: "mariadb",
    targetRoot
  });
}

function nextjsDatabaseConnection(runtime = "none", targetRoot = "", {
  databaseName = ""
} = {}) {
  if (runtime === "postgres") {
    return nextjsPostgresDatabaseConnection(targetRoot, {
      databaseName
    });
  }
  if (runtime === "mariadb") {
    return nextjsMariaDbDatabaseConnection(targetRoot, {
      databaseName
    });
  }
  return managedDatabaseConnection({
    adapterId: "nextjs",
    runtime,
    targetRoot
  });
}

function nextjsPostgresDatabaseUrl(targetRoot = "", options = {}) {
  return nextjsPostgresDatabaseConnection(targetRoot, options).url;
}

function nextjsMariaDbDatabaseUrl(targetRoot = "", options = {}) {
  return nextjsMariaDbDatabaseConnection(targetRoot, options).url;
}

function expectedNextjsDatabaseUrl(runtime = "none", targetRoot = "", {
  databaseName = ""
} = {}) {
  if (runtime === "postgres") {
    return nextjsPostgresDatabaseUrl(targetRoot, {
      databaseName
    });
  }
  if (runtime === "mariadb") {
    return nextjsMariaDbDatabaseUrl(targetRoot, {
      databaseName
    });
  }
  return "";
}

function nextjsDatabasePromptServiceFacts({
  config = {},
  targetRoot = ""
} = {}) {
  const runtime = selectedNextjsDatabaseRuntime(config);
  if (runtime === "none") {
    return null;
  }
  const connection = nextjsDatabaseConnection(runtime, targetRoot);
  const terminalEnv = runtime === "postgres"
    ? {
        PGDATABASE: connection.database,
        PGHOST: connection.host,
        PGPASSWORD: connection.password,
        PGPORT: connection.port,
        PGUSER: connection.username
      }
    : {
        DB_CLIENT: "mysql2",
        DB_HOST: connection.host,
        DB_NAME: connection.database,
        DB_PASSWORD: connection.password,
        DB_PORT: connection.port,
        DB_USER: connection.username
      };
  return managedDatabasePromptServiceFacts({
    id: `nextjs-${runtime}`,
    label: `Next.js ${runtime === "postgres" ? "PostgreSQL" : "MariaDB"}`,
    runtime,
    terminalEnv
  });
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
    "echo 'Wrote Next.js database settings for the selected host runtime.'"
  ].join("\n");
}

export {
  NEXTJS_DATABASE_RUNTIMES,
  databaseNameFromTargetRoot,
  nextjsDatabaseConnection,
  expectedNextjsDatabaseUrl,
  nextjsDatabaseEnvLines,
  nextjsDatabaseHostPort,
  nextjsDatabaseEnvWriteScript,
  nextjsDatabasePromptServiceFacts,
  selectedNextjsDatabaseRuntime
};
