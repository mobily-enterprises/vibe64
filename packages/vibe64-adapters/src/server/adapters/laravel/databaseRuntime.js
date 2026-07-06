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

const LARAVEL_DATABASE_RUNTIMES = new Set(["sqlite", "postgres", "mysql", "mariadb"]);
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
const LARAVEL_MYSQL_ROOT_PASSWORD = "laravel_root_password";
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
  if (runtime === "mysql") {
    return managedDatabaseConnection({
      adapterId: "laravel",
      databaseName,
      databaseNameFallback: "laravel_app",
      host: LARAVEL_DATABASE_HOST,
      port: laravelDatabaseHostPort("mysql"),
      rootPassword: LARAVEL_MYSQL_ROOT_PASSWORD,
      runtime,
      targetRoot
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
        VIBE64_MYSQL_USER: connection.username,
        MYSQL_DATABASE: connection.database,
        MYSQL_HOST: connection.host,
        MYSQL_PWD: connection.password,
        MYSQL_TCP_PORT: connection.port
      };
  const label = {
    mariadb: "Laravel MariaDB",
    mysql: "Laravel MySQL",
    postgres: "Laravel PostgreSQL"
  }[runtime] || "Laravel database";
  return managedDatabasePromptServiceFacts({
    id: `laravel-${runtime}`,
    label,
    runtime,
    terminalEnv
  });
}

function mysqlCompatibleLaravelRuntime(config = {}) {
  return ["mysql", "mariadb"].includes(selectedLaravelDatabaseRuntime(config));
}

function mysqlClientScript() {
  return [
    "set -e",
    "if command -v mysql >/dev/null 2>&1; then",
    "  exec mysql",
    "fi",
    "if command -v mariadb >/dev/null 2>&1; then",
    "  exec mariadb",
    "fi",
    "printf '[studio] No MySQL-compatible client was found on this host.\\n' >&2",
    "exit 127"
  ].join("\n");
}

function listLaravelDatabaseProjectTools({
  config = {},
  targetRoot = ""
} = {}) {
  if (!mysqlCompatibleLaravelRuntime(config)) {
    return [];
  }
  return [
    {
      id: "connect_mysql",
      label: "Connect to MySQL",
      description: "Open an interactive client for the configured Vibe64-managed MySQL or MariaDB service.",
      type: "command",
      parameters: [],
      async command() {
        return {
          args: [
            "-lc",
            mysqlClientScript()
          ],
          command: "bash",
          commandPreview: "mysql",
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
  mysqlCompatibleLaravelRuntime,
  selectedLaravelDatabaseRuntime
};
