import path from "node:path";

const MANAGED_DATABASE_RUNTIMES = new Set(["none", "sqlite", "postgres", "mariadb"]);
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
  MYSQL_PWD: "database password used by the MariaDB client",
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
  port = "",
  rootPassword = "",
  runtime = "sqlite",
  targetRoot = "",
  username = ""
} = {}) {
  const name = databaseName || managedDatabaseNameFromTargetRoot(targetRoot, {
    fallback: databaseNameFallback
  });
  if (runtime === "postgres") {
    const resolvedHost = host || "127.0.0.1";
    const resolvedPort = String(port || "5432");
    const resolvedUser = username || adapterId;
    const resolvedPassword = password || `${adapterId}_password`;
    return {
      database: name,
      host: resolvedHost,
      password: resolvedPassword,
      port: resolvedPort,
      runtime,
      url: `postgresql://${resolvedUser}:${resolvedPassword}@${resolvedHost}:${resolvedPort}/${name}`,
      username: resolvedUser
    };
  }
  if (runtime === "mariadb") {
    const resolvedHost = host || "127.0.0.1";
    const resolvedPort = String(port || "3306");
    const resolvedPassword = rootPassword || password || `${adapterId}_root_password`;
    return {
      database: name,
      host: resolvedHost,
      password: resolvedPassword,
      port: resolvedPort,
      runtime,
      url: `mysql://root:${resolvedPassword}@${resolvedHost}:${resolvedPort}/${name}`,
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

function terminalEnvHasKeys(terminalEnv = {}, keys = []) {
  return keys.every((key) => String(terminalEnv[key] || "").trim());
}

function mariaDbClient() {
  return "mariadb";
}

function managedMariaDbServicePromptFacts({
  id = "",
  label = "",
  runtime = "mariadb"
} = {}) {
  const client = mariaDbClient();
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
      `Run ${client} directly from the terminal.`,
      "In non-interactive command runners, pass SQL with --execute or pipe SQL to the client; do not start a bare interactive client and wait for input.",
      "The terminal environment already contains the connection values. Use those environment variables when passing database tokens or flags to framework generators."
    ],
    runtime
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
  terminalEnv = {}
} = {}) {
  if (terminalEnvHasKeys(terminalEnv, ["PGDATABASE", "PGHOST", "PGPASSWORD", "PGPORT", "PGUSER"])) {
    return managedPostgresServicePromptFacts({
      id,
      label
    });
  }
  if (terminalEnvHasKeys(terminalEnv, ["VIBE64_MYSQL_USER", "MYSQL_DATABASE", "MYSQL_HOST", "MYSQL_PWD", "MYSQL_TCP_PORT"])) {
    return managedMariaDbServicePromptFacts({
      id,
      label,
      runtime: "mariadb"
    });
  }
  return null;
}

export {
  MANAGED_DATABASE_RUNTIMES,
  managedDatabaseConnection,
  managedDatabaseNameFromTargetRoot,
  managedDatabasePromptServiceFacts,
  managedDatabaseRuntime
};
