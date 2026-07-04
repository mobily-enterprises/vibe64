import path from "node:path";

const MANAGED_DATABASE_RUNTIMES = new Set(["none", "sqlite", "postgres", "mysql", "mariadb"]);
const MYSQL_GENERATOR_TOKEN_HINTS = Object.freeze({
  database: "$MYSQL_DATABASE",
  host: "$MYSQL_HOST",
  password: "$MYSQL_PWD",
  port: "$MYSQL_TCP_PORT",
  username: "$VIBE64_MYSQL_USER"
});
const MYSQL_ENVIRONMENT_VARIABLES = Object.freeze({
  VIBE64_MYSQL_USER: "database username",
  MYSQL_DATABASE: "database name",
  MYSQL_HOST: "database host reachable from the terminal",
  MYSQL_PWD: "database password used by mysql and mariadb clients",
  MYSQL_TCP_PORT: "database TCP port"
});
const POSTGRES_GENERATOR_TOKEN_HINTS = Object.freeze({
  database: "$PGDATABASE",
  host: "$PGHOST",
  password: "$PGPASSWORD",
  port: "$PGPORT",
  username: "$PGUSER"
});
const POSTGRES_ENVIRONMENT_VARIABLES = Object.freeze({
  PGDATABASE: "database name",
  PGHOST: "database host reachable from the terminal",
  PGPASSWORD: "database password used by psql",
  PGPORT: "database TCP port",
  PGUSER: "database username"
});
const MAX_DATABASE_NAME_LENGTH = 64;

function normalizeManagedDatabaseNamePart(value = "") {
  return String(value || "")
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function managedProjectNamePartsFromTargetRoot(targetRoot = "") {
  const root = String(targetRoot || "").trim();
  if (!root) {
    return [];
  }
  const parts = path.resolve(root).split(path.sep).filter(Boolean);
  const vibe64Index = parts.lastIndexOf("vibe64");
  const projectIndex = vibe64Index >= 0
    ? parts.indexOf("projects", vibe64Index + 2)
    : -1;
  if (vibe64Index >= 0 && projectIndex >= 0 && parts[vibe64Index + 1] && parts[projectIndex + 1]) {
    return [
      parts[vibe64Index + 1],
      parts[projectIndex + 1]
    ].map(normalizeManagedDatabaseNamePart).filter(Boolean);
  }
  return [normalizeManagedDatabaseNamePart(path.basename(root))].filter(Boolean);
}

function managedDatabaseNameFromTargetRoot(targetRoot = "", {
  fallback = "app",
  suffix = ""
} = {}) {
  const normalizedFallback = normalizeManagedDatabaseNamePart(fallback) || "app";
  const normalizedSuffix = normalizeManagedDatabaseNamePart(suffix);
  const suffixText = normalizedSuffix ? `_${normalizedSuffix}` : "";
  const parts = managedProjectNamePartsFromTargetRoot(targetRoot);
  const base = parts.join("_") || normalizedFallback;
  const maxBaseLength = Math.max(1, MAX_DATABASE_NAME_LENGTH - suffixText.length);
  const clippedBase = base.slice(0, maxBaseLength).replace(/_+$/gu, "") || normalizedFallback.slice(0, maxBaseLength) || "app";
  return `${clippedBase}${suffixText}`;
}

function managedDatabaseRuntime(value = "", {
  fallback = "sqlite"
} = {}) {
  const runtime = String(value || fallback).trim();
  return MANAGED_DATABASE_RUNTIMES.has(runtime) ? runtime : fallback;
}

function managedDatabaseConnection({
  adapterId = "app",
  databaseName = "",
  databaseNameFallback = "app",
  host = "",
  password = "",
  rootPassword = "",
  runtime = "sqlite",
  targetRoot = "",
  username = ""
} = {}) {
  const name = databaseName || managedDatabaseNameFromTargetRoot(targetRoot, {
    fallback: databaseNameFallback
  });
  if (runtime === "postgres") {
    const resolvedHost = host || `${adapterId}-postgres`;
    const resolvedUser = username || adapterId;
    const resolvedPassword = password || `${adapterId}_password`;
    return {
      database: name,
      host: resolvedHost,
      password: resolvedPassword,
      port: "5432",
      runtime,
      url: `postgresql://${resolvedUser}:${resolvedPassword}@${resolvedHost}:5432/${name}`,
      username: resolvedUser
    };
  }
  if (runtime === "mysql") {
    const resolvedHost = host || `${adapterId}-mysql`;
    const resolvedPassword = rootPassword || password || `${adapterId}_root_password`;
    return {
      database: name,
      host: resolvedHost,
      password: resolvedPassword,
      port: "3306",
      runtime,
      url: `mysql://root:${resolvedPassword}@${resolvedHost}:3306/${name}`,
      username: "root"
    };
  }
  if (runtime === "mariadb") {
    const resolvedHost = host || `${adapterId}-mariadb`;
    const resolvedPassword = rootPassword || password || `${adapterId}_root_password`;
    return {
      database: name,
      host: resolvedHost,
      password: resolvedPassword,
      port: "3306",
      runtime,
      url: `mysql://root:${resolvedPassword}@${resolvedHost}:3306/${name}`,
      username: "root"
    };
  }
  return {
    database: "",
    host: "",
    password: "",
    port: "",
    runtime,
    url: "",
    username: ""
  };
}

function managedPostgresTerminalEnv(connection = {}) {
  return {
    PGDATABASE: connection.database,
    PGHOST: connection.host,
    PGPASSWORD: connection.password,
    PGPORT: connection.port,
    PGUSER: connection.username
  };
}

function managedMysqlTerminalEnv(connection = {}) {
  return {
    VIBE64_MYSQL_USER: connection.username,
    MYSQL_DATABASE: connection.database,
    MYSQL_HOST: connection.host,
    MYSQL_PWD: connection.password,
    MYSQL_TCP_PORT: connection.port
  };
}

function terminalEnvHasKeys(terminalEnv = {}, keys = []) {
  return keys.every((key) => String(terminalEnv[key] || "").trim());
}

function mysqlCompatibleClient() {
  return "mysql";
}

function mysqlCompatibleAlternateClient() {
  return "mariadb";
}

function managedMysqlServicePromptFacts({
  id = "",
  label = "",
  runtime = "mysql"
} = {}) {
  const client = mysqlCompatibleClient();
  const alternateClient = mysqlCompatibleAlternateClient();
  return {
    client,
    checkCommand: `${client} --host="$MYSQL_HOST" --port="\${MYSQL_TCP_PORT:-3306}" --user="\${VIBE64_MYSQL_USER:-root}" --password="$MYSQL_PWD" "$MYSQL_DATABASE" --execute="SELECT 1"`,
    command: `${client} --host="$MYSQL_HOST" --port="\${MYSQL_TCP_PORT:-3306}" --user="\${VIBE64_MYSQL_USER:-root}" --password="$MYSQL_PWD" "$MYSQL_DATABASE" --execute="<SQL>"`,
    environment: MYSQL_ENVIRONMENT_VARIABLES,
    generatorTokenHints: MYSQL_GENERATOR_TOKEN_HINTS,
    id,
    interactiveCommand: `${client} --host="$MYSQL_HOST" --port="\${MYSQL_TCP_PORT:-3306}" --user="\${VIBE64_MYSQL_USER:-root}" --password="$MYSQL_PWD" "$MYSQL_DATABASE"`,
    kind: "database",
    label,
    notes: [
      `Run ${client} directly from the terminal. If ${client} is not installed but ${alternateClient} is available, use the alternate command with the same environment variables.`,
      "In non-interactive command runners, pass SQL with --execute or pipe SQL to the client; do not start a bare interactive client and wait for input.",
      "The terminal environment already contains the connection values. Use those environment variables when passing database tokens or flags to framework generators."
    ],
    runtime,
    alternateClient,
    alternateCheckCommand: `${alternateClient} --host="$MYSQL_HOST" --port="\${MYSQL_TCP_PORT:-3306}" --user="\${VIBE64_MYSQL_USER:-root}" --password="$MYSQL_PWD" "$MYSQL_DATABASE" --execute="SELECT 1"`,
    alternateCommand: `${alternateClient} --host="$MYSQL_HOST" --port="\${MYSQL_TCP_PORT:-3306}" --user="\${VIBE64_MYSQL_USER:-root}" --password="$MYSQL_PWD" "$MYSQL_DATABASE" --execute="<SQL>"`
  };
}

function managedPostgresServicePromptFacts({
  id = "",
  label = ""
} = {}) {
  return {
    checkCommand: 'psql --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT 1"',
    client: "psql",
    command: 'psql --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --dbname="$PGDATABASE" --command="<SQL>"',
    environment: POSTGRES_ENVIRONMENT_VARIABLES,
    generatorTokenHints: POSTGRES_GENERATOR_TOKEN_HINTS,
    id,
    interactiveCommand: 'psql --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --dbname="$PGDATABASE"',
    kind: "database",
    label,
    notes: [
      "Run psql directly from the terminal.",
      "In non-interactive command runners, pass SQL with --command or pipe SQL to psql; do not start a bare interactive client and wait for input.",
      "The terminal environment already contains the connection values. Use those environment variables when passing database tokens or flags to framework generators."
    ],
    runtime: "postgres"
  };
}

function managedDatabasePromptServiceFacts({
  id = "",
  label = "",
  runtime = "",
  terminalEnv = {}
} = {}) {
  if (terminalEnvHasKeys(terminalEnv, ["PGDATABASE", "PGHOST", "PGPASSWORD", "PGPORT", "PGUSER"])) {
    return managedPostgresServicePromptFacts({
      id,
      label
    });
  }
  if (terminalEnvHasKeys(terminalEnv, ["VIBE64_MYSQL_USER", "MYSQL_DATABASE", "MYSQL_HOST", "MYSQL_PWD", "MYSQL_TCP_PORT"])) {
    return managedMysqlServicePromptFacts({
      id,
      label,
      runtime: runtime === "mariadb" ? "mariadb" : "mysql"
    });
  }
  return null;
}

function managedPostgresContainer({
  adapterId = "app",
  checkId = "",
  databaseName = "",
  databaseNameFallback = "app",
  host = "",
  hostPort = "",
  label = "",
  password = "",
  targetRoot = "",
  username = ""
} = {}) {
  const connection = managedDatabaseConnection({
    adapterId,
    databaseName,
    databaseNameFallback,
    host,
    password,
    runtime: "postgres",
    targetRoot,
    username
  });
  return {
    aliases: [
      connection.host
    ],
    checkId: checkId || `${adapterId}-postgres`,
    env: {
      POSTGRES_DB: connection.database,
      POSTGRES_PASSWORD: connection.password,
      POSTGRES_USER: connection.username
    },
    expected: `Managed PostgreSQL is running when selected for this ${adapterId} target.`,
    health: {
      command: [
        "pg_isready",
        "-U",
        connection.username,
        "-d",
        connection.database
      ],
      interval: "5s",
      retries: 20,
      timeout: "3s"
    },
    id: `${adapterId}-postgres`,
    image: "postgres:17-alpine",
    label: label || `${adapterId} PostgreSQL`,
    ports: hostPort
      ? [
          {
            container: 5432,
            host: "127.0.0.1",
            hostPort
          }
        ]
      : [],
    readyExplanation: `The managed PostgreSQL runtime is ready for ${adapterId} setup and launch targets.`,
    secretEnv: [
      "POSTGRES_PASSWORD"
    ],
    terminalEnv: managedPostgresTerminalEnv(connection),
    volumes: [
      {
        id: "data",
        target: "/var/lib/postgresql/data"
      }
    ]
  };
}

function managedMysqlContainer({
  adapterId = "app",
  checkId = "",
  databaseName = "",
  databaseNameFallback = "app",
  host = "",
  hostPort = "",
  image = "mysql:8.4",
  label = "",
  rootPassword = "",
  runtime = "mysql",
  targetRoot = ""
} = {}) {
  const connection = managedDatabaseConnection({
    adapterId,
    databaseName,
    databaseNameFallback,
    host,
    rootPassword,
    runtime,
    targetRoot
  });
  const passwordEnvKey = runtime === "mariadb" ? "MARIADB_ROOT_PASSWORD" : "MYSQL_ROOT_PASSWORD";
  const databaseEnvKey = runtime === "mariadb" ? "MARIADB_DATABASE" : "MYSQL_DATABASE";
  return {
    aliases: [
      connection.host
    ],
    checkId: checkId || `${adapterId}-${runtime}`,
    env: {
      [databaseEnvKey]: connection.database,
      [passwordEnvKey]: connection.password
    },
    expected: `Managed ${runtime === "mariadb" ? "MariaDB" : "MySQL"} is running when selected for this ${adapterId} target.`,
    health: {
      command: [
        runtime === "mariadb" ? "mariadb-admin" : "mysqladmin",
        "ping",
        "-uroot",
        `-p${connection.password}`,
        "--silent"
      ],
      interval: "5s",
      retries: 30,
      timeout: "3s"
    },
    id: `${adapterId}-${runtime}`,
    image,
    label: label || `${adapterId} ${runtime === "mariadb" ? "MariaDB" : "MySQL"}`,
    ports: hostPort
      ? [
          {
            container: 3306,
            host: "127.0.0.1",
            hostPort
          }
        ]
      : [],
    readyExplanation: `The managed ${runtime === "mariadb" ? "MariaDB" : "MySQL"} runtime is ready for ${adapterId} setup and launch targets.`,
    secretEnv: [
      passwordEnvKey
    ],
    terminalEnv: managedMysqlTerminalEnv(connection),
    volumes: [
      {
        id: "data",
        target: "/var/lib/mysql"
      }
    ]
  };
}

function createManagedDatabaseRuntimeContainer({
  adapterId = "app",
  checkId = "",
  databaseName = "",
  databaseNameFallback = "app",
  host = "",
  hostPort = "",
  label = "",
  password = "",
  rootPassword = "",
  runtime = "none",
  targetRoot = "",
  username = ""
} = {}) {
  if (runtime === "postgres") {
    return managedPostgresContainer({
      adapterId,
      checkId,
      databaseName,
      databaseNameFallback,
      host,
      hostPort,
      label,
      password,
      targetRoot,
      username
    });
  }
  if (runtime === "mysql") {
    return managedMysqlContainer({
      adapterId,
      checkId,
      databaseName,
      databaseNameFallback,
      host,
      hostPort,
      label,
      rootPassword,
      runtime,
      targetRoot
    });
  }
  if (runtime === "mariadb") {
    return managedMysqlContainer({
      adapterId,
      checkId,
      databaseName,
      databaseNameFallback,
      host,
      hostPort,
      image: "mariadb:12.0.2",
      label,
      rootPassword,
      runtime,
      targetRoot
    });
  }
  return null;
}

export {
  MANAGED_DATABASE_RUNTIMES,
  createManagedDatabaseRuntimeContainer,
  managedDatabaseConnection,
  managedDatabaseNameFromTargetRoot,
  managedDatabasePromptServiceFacts,
  managedDatabaseRuntime
};
