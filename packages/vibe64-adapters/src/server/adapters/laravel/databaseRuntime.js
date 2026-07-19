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
  LARAVEL_DATABASE_RUNTIME_CONFIG
} from "./constants.js";

const LARAVEL_DATABASE_RUNTIMES = new Set(["sqlite", "postgres", "mariadb"]);
const LARAVEL_DATABASE_ENV_KEYS = Object.freeze([
  "DB_CONNECTION",
  "DB_HOST",
  "DB_PORT",
  "DB_DATABASE",
  "DB_USERNAME",
  "DB_PASSWORD"
]);
const LARAVEL_DATABASE_HOST = "127.0.0.1";
const LARAVEL_POSTGRES_PASSWORD = "laravel_password";
const LARAVEL_POSTGRES_USER = "laravel";
const LARAVEL_MARIADB_ROOT_PASSWORD = "laravel_root_password";

function laravelDatabaseHostPort(runtime = "sqlite") {
  return runtime === "postgres" ? "5432" : "3306";
}

function selectedLaravelDatabaseRuntime(config = {}) {
  return selectedConfigValue(config, LARAVEL_DATABASE_RUNTIME_CONFIG, LARAVEL_DATABASE_RUNTIMES, "sqlite");
}

function laravelDatabaseNameFromTargetRoot(targetRoot = "") {
  return managedDatabaseNameFromTargetRoot(targetRoot, {
    fallback: "laravel_app"
  });
}

function laravelDatabaseConnection(runtime = "sqlite", targetRoot = "", {
  databaseName = ""
} = {}) {
  if (runtime === "postgres") {
    return managedDatabaseConnection({
      adapterId: "laravel",
      databaseName,
      databaseNameFallback: "laravel_app",
      host: LARAVEL_DATABASE_HOST,
      password: LARAVEL_POSTGRES_PASSWORD,
      port: laravelDatabaseHostPort("postgres"),
      runtime,
      targetRoot,
      username: LARAVEL_POSTGRES_USER
    });
  }
  if (runtime === "mariadb") {
    return managedDatabaseConnection({
      adapterId: "laravel",
      databaseName,
      databaseNameFallback: "laravel_app",
      host: LARAVEL_DATABASE_HOST,
      port: laravelDatabaseHostPort("mariadb"),
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

function laravelDatabasePromptServiceFacts({
  config = {},
  targetRoot = ""
} = {}) {
  const runtime = selectedLaravelDatabaseRuntime(config);
  if (runtime === "sqlite") {
    return null;
  }
  const connection = laravelDatabaseConnection(runtime, targetRoot);
  const terminalEnv = runtime === "postgres"
    ? {
        PGDATABASE: connection.database,
        PGHOST: connection.host,
        PGPASSWORD: connection.password,
        PGPORT: connection.port,
        PGUSER: connection.username
      }
    : {
        DB_CLIENT: "mysql",
        DB_HOST: connection.host,
        DB_NAME: connection.database,
        DB_PASSWORD: connection.password,
        DB_PORT: connection.port,
        DB_USER: connection.username
      };
  const label = {
    mariadb: "Laravel MariaDB",
    postgres: "Laravel PostgreSQL"
  }[runtime] || "Laravel database";
  return managedDatabasePromptServiceFacts({
    id: `laravel-${runtime}`,
    label,
    runtime,
    terminalEnv
  });
}

function mariaDbLaravelRuntime(config = {}) {
  return selectedLaravelDatabaseRuntime(config) === "mariadb";
}

function mariaDbClientScript() {
  return [
    "set -e",
    "if ! command -v mariadb >/dev/null 2>&1; then",
    "  printf '[studio] mariadb client was not found on this host.\\n' >&2",
    "  exit 127",
    "fi",
    "exec mariadb --skip-ssl",
    "exit 127"
  ].join("\n");
}

function listLaravelDatabaseProjectTools({
  config = {},
  targetRoot = ""
} = {}) {
  if (!mariaDbLaravelRuntime(config)) {
    return [];
  }
  return [
    {
      id: "connect_mariadb",
      label: "Connect to MariaDB",
      description: "Open an interactive client for the configured Vibe64-managed MariaDB service.",
      type: "command",
      parameters: [],
      async command() {
        return {
          args: [
            "-lc",
            mariaDbClientScript()
          ],
          command: "bash",
          commandPreview: "mariadb --skip-ssl",
          cwd: targetRoot,
          ok: true
        };
      }
    }
  ];
}

function laravelDatabaseEnvLines({
  config = {},
  databaseName = "",
  targetRoot = ""
} = {}) {
  const runtime = selectedLaravelDatabaseRuntime(config);
  if (runtime === "sqlite") {
    return [
      "DB_CONNECTION=sqlite"
    ];
  }
  const connection = laravelDatabaseConnection(runtime, targetRoot, {
    databaseName
  });
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
    "echo 'Wrote Laravel database settings for the selected host runtime.'"
  ].join("\n");
}

export {
  LARAVEL_DATABASE_RUNTIMES,
  laravelDatabaseConnection,
  laravelDatabaseEnvLines,
  laravelDatabaseHostPort,
  laravelDatabaseEnvWriteScript,
  laravelDatabaseNameFromTargetRoot,
  laravelDatabasePromptServiceFacts,
  listLaravelDatabaseProjectTools,
  mariaDbLaravelRuntime,
  selectedLaravelDatabaseRuntime
};
