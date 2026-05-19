import path from "node:path";

const MANAGED_DATABASE_RUNTIMES = new Set(["none", "sqlite", "postgres", "mysql", "mariadb"]);

function managedDatabaseNameFromTargetRoot(targetRoot = "", {
  fallback = "app"
} = {}) {
  return String(path.basename(targetRoot) || fallback)
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "") || fallback;
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
    AI_STUDIO_MYSQL_USER: connection.username,
    MYSQL_DATABASE: connection.database,
    MYSQL_HOST: connection.host,
    MYSQL_PWD: connection.password,
    MYSQL_TCP_PORT: connection.port
  };
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
  managedDatabaseRuntime
};
