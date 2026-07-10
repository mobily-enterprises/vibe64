import crypto from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  managedDatabaseNameFromTargetRoot
} from "@local/studio-terminal-core/server/managedDatabases";
import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  VIBE64_NIXPKGS_PIN,
  runtimePackage,
  runtimeShellCommandArgs,
  stableRuntimeJson
} from "@local/vibe64-core/server/runtimeToolchain";
import {
  readDatabaseHostFromEnvFile
} from "../../adapterHelpers/setupDatabaseConnections.js";
import {
  defaultValidateDatabaseName as validateDatabaseName
} from "../../adapterHelpers/setupMariaDbChecks.js";
import {
  allDependencyNames,
  readTargetPackageJson
} from "../../adapterHelpers/setupNodePackages.js";

const JSKIT_MARIADB_HOST = "127.0.0.1";
const JSKIT_MARIADB_APP_USER = "vibe64_dev_app";
const JSKIT_MARIADB_ROOT_PASSWORD = "vibe64_jskit_root";
const JSKIT_MARIADB_PUBLISHED_APP_USER_MAX_LENGTH = 32;
const JSKIT_MANAGED_MARIADB_RUNTIME_ID = "mariadb";
const JSKIT_MANAGED_MARIADB_PORT_BASE = 23060;
const JSKIT_MANAGED_MARIADB_PORT_RANGE = 20000;
const JSKIT_MARIADB_PROBE_DATABASE = "vibe64_mariadb_probe";
const JSKIT_MARIADB_PROBE_TABLE = "capability_probe";
const JSKIT_MARIADB_PROBE_SQL_VARIABLE = "@vibe64_mariadb_probe_sql";
const JSKIT_MARIADB_PROBE_STATEMENT = "vibe64_mariadb_probe_statement";
const JSKIT_MANAGED_MARIADB_METADATA_FILE = "metadata.json";
const JSKIT_MANAGED_MARIADB_SECRETS_FILE = "secrets.json";
const JSKIT_MANAGED_MARIADB_SERVICE_SCHEMA = "vibe64.jskit-managed-mariadb-service";
const JSKIT_MANAGED_MARIADB_SERVICE_SCHEMA_VERSION = 1;

async function targetWantsJskitMariaDb(targetRoot = "", toolkit) {
  const lockJsonResult = await toolkit.readTargetJson(".jskit/lock.json", {
    targetRoot
  });
  const packageJson = await readTargetPackageJson(targetRoot, toolkit) || {};
  const lockJson = lockJsonResult.ok ? lockJsonResult.value : {};
  const names = allDependencyNames(packageJson, lockJson?.installedPackages || {});
  return [...names].some((name) => name.includes("database-runtime-mysql"));
}

function mariaDbIdentifier(value = "") {
  return String(value || "").replaceAll("`", "``");
}

function mariaDbPreparedStatement(sqlExpression = "") {
  return [
    `SET ${JSKIT_MARIADB_PROBE_SQL_VARIABLE} = ${sqlExpression}`,
    `PREPARE ${JSKIT_MARIADB_PROBE_STATEMENT} FROM ${JSKIT_MARIADB_PROBE_SQL_VARIABLE}`,
    `EXECUTE ${JSKIT_MARIADB_PROBE_STATEMENT}`,
    `DEALLOCATE PREPARE ${JSKIT_MARIADB_PROBE_STATEMENT}`
  ];
}

function mariaDbTemporaryProbeSql() {
  const probeDatabaseVariable = "@vibe64_mariadb_probe_database";
  const probeIdentifierVariable = "@vibe64_mariadb_probe_identifier";
  return [
    `SET ${probeDatabaseVariable} = CONCAT('${JSKIT_MARIADB_PROBE_DATABASE}_', REPLACE(UUID(), '-', ''))`,
    `SET ${probeIdentifierVariable} = REPLACE(${probeDatabaseVariable}, '\`', '\`\`')`,
    ...mariaDbPreparedStatement(`CONCAT('CREATE DATABASE \`', ${probeIdentifierVariable}, '\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')`),
    ...mariaDbPreparedStatement(`CONCAT('CREATE TABLE \`', ${probeIdentifierVariable}, '\`.\`${JSKIT_MARIADB_PROBE_TABLE}\` (id INT NOT NULL PRIMARY KEY)')`),
    ...mariaDbPreparedStatement(`CONCAT('DROP TABLE IF EXISTS \`', ${probeIdentifierVariable}, '\`.\`${JSKIT_MARIADB_PROBE_TABLE}\`')`),
    ...mariaDbPreparedStatement(`CONCAT('DROP DATABASE IF EXISTS \`', ${probeIdentifierVariable}, '\`')`)
  ];
}

function mariaDbCapabilitySql({
  appDatabaseName = ""
} = {}) {
  const database = String(appDatabaseName || "").trim();
  return [
    ...(database
      ? [
          `CREATE DATABASE IF NOT EXISTS \`${mariaDbIdentifier(database)}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        ]
      : []),
    ...mariaDbTemporaryProbeSql()
  ].join("; ");
}

function jskitMariaDbDatabaseName(targetRoot = "") {
  return managedDatabaseNameFromTargetRoot(targetRoot, {
    fallback: "jskit_app"
  });
}

function normalizeMariaDbNamePart(value = "") {
  return String(value || "")
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function normalizeManagedMariaDbServiceDataRoot(serviceDataRoot = "") {
  const root = String(serviceDataRoot || "").trim();
  return root ? path.resolve(root) : "";
}

function jskitMariaDbTenantName(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const serviceRoot = normalizeManagedMariaDbServiceDataRoot(serviceDataRoot);
  if (serviceRoot) {
    const serviceRootParent = path.basename(path.dirname(serviceRoot));
    const tenant = normalizeMariaDbNamePart(serviceRootParent);
    if (tenant && tenant !== "vibe64") {
      return tenant;
    }
  }
  const root = String(targetRoot || "").trim();
  if (!root) {
    return "";
  }
  const parts = path.resolve(root).split(path.sep).filter(Boolean);
  const vibe64Index = parts.lastIndexOf("vibe64");
  if (vibe64Index >= 0 && parts[vibe64Index + 1]) {
    return normalizeMariaDbNamePart(parts[vibe64Index + 1]);
  }
  return "";
}

function jskitMariaDbTenantDatabaseGrantPattern(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const tenant = jskitMariaDbTenantName(targetRoot, {
    serviceDataRoot
  });
  return tenant ? `${tenant}\\_%` : jskitMariaDbDatabaseName(targetRoot);
}

function jskitManagedMariaDbServiceSeed(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const serviceRoot = normalizeManagedMariaDbServiceDataRoot(serviceDataRoot);
  if (serviceRoot) {
    return serviceRoot;
  }
  const root = String(targetRoot || "").trim();
  return root ? path.resolve(root) : "jskit-managed-mariadb";
}

function jskitMariaDbHostPort(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  if (!String(targetRoot || "").trim() && !String(serviceDataRoot || "").trim()) {
    return "3306";
  }
  const hash = crypto
    .createHash("sha256")
    .update(jskitManagedMariaDbServiceSeed(targetRoot, {
      serviceDataRoot
    }))
    .digest();
  return String(JSKIT_MANAGED_MARIADB_PORT_BASE + (hash.readUInt32BE(0) % JSKIT_MANAGED_MARIADB_PORT_RANGE));
}

function jskitMariaDbAppPassword(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const hash = crypto
    .createHash("sha256")
    .update(`${jskitManagedMariaDbServiceSeed(targetRoot, {
      serviceDataRoot
    })}:vibe64-dev-app-user`)
    .digest("hex");
  return `v64_${hash.slice(0, 32)}`;
}

function jskitMariaDbPublishedAppUser(databaseName = "") {
  const normalized = normalizeMariaDbNamePart(databaseName).toLowerCase() || "jskit";
  const suffix = "_app";
  const raw = `${normalized}${suffix}`;
  if (raw.length <= JSKIT_MARIADB_PUBLISHED_APP_USER_MAX_LENGTH) {
    return raw;
  }
  const hash = crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 8);
  const prefixLength = JSKIT_MARIADB_PUBLISHED_APP_USER_MAX_LENGTH - suffix.length - hash.length - 1;
  return `${normalized.slice(0, Math.max(1, prefixLength))}_${hash}${suffix}`;
}

function jskitMariaDbPublishedAppPassword(databaseName = "", {
  targetRoot = ""
} = {}) {
  const seedDatabase = normalizeMariaDbNamePart(databaseName).toLowerCase() || "jskit";
  const seedRoot = String(targetRoot || "").trim() ? path.resolve(targetRoot) : "jskit-published";
  const hash = crypto
    .createHash("sha256")
    .update(`${seedDatabase}:${seedRoot}:published-app-user`)
    .digest("hex");
  return `v64_${hash.slice(0, 32)}`;
}

function jskitManagedMariaDbRuntimeRoot({
  serviceDataRoot = ""
} = {}) {
  const root = normalizeManagedMariaDbServiceDataRoot(serviceDataRoot);
  return root ? path.join(root, JSKIT_MANAGED_MARIADB_RUNTIME_ID) : "";
}

function jskitManagedMariaDbServicePaths(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  void targetRoot;
  const runtimeRoot = jskitManagedMariaDbRuntimeRoot({
    serviceDataRoot
  });
  if (!runtimeRoot) {
    return {
      dataDir: "",
      logDir: "",
      metadataFile: "",
      pidFile: "",
      runDir: "",
      runtimeRoot: "",
      secretsFile: "",
      socketFile: ""
    };
  }
  return {
    dataDir: path.join(runtimeRoot, "data"),
    logDir: path.join(runtimeRoot, "log"),
    metadataFile: path.join(runtimeRoot, JSKIT_MANAGED_MARIADB_METADATA_FILE),
    pidFile: path.join(runtimeRoot, "run", "mariadbd.pid"),
    runDir: path.join(runtimeRoot, "run"),
    runtimeRoot,
    secretsFile: path.join(runtimeRoot, JSKIT_MANAGED_MARIADB_SECRETS_FILE),
    socketFile: path.join(runtimeRoot, "run", "mariadb.sock")
  };
}

function jskitManagedMariaDbPackageNixRecord() {
  const entry = runtimePackage(JSKIT_MANAGED_MARIADB_RUNTIME_ID);
  return {
    attr: entry?.nix?.attr || "mariadb",
    flakeRef: entry?.nix?.flakeRef || VIBE64_NIXPKGS_PIN.flakeRef,
    nixpkgsPin: entry?.nix?.pin || VIBE64_NIXPKGS_PIN.id,
    rev: VIBE64_NIXPKGS_PIN.rev
  };
}

function jskitManagedMariaDbServiceMetadata({
  databaseName = "",
  recordedAt = "",
  serviceDataRoot = "",
  status = "configured",
  targetRoot = ""
} = {}) {
  const paths = jskitManagedMariaDbServicePaths(targetRoot, {
    serviceDataRoot
  });
  return {
    connection: {
      host: JSKIT_MARIADB_HOST,
      port: jskitMariaDbHostPort(targetRoot, {
        serviceDataRoot
      }),
      socket: paths.socketFile
    },
    database: {
      name: String(databaseName || jskitMariaDbDatabaseName(targetRoot)).trim()
    },
    nix: jskitManagedMariaDbPackageNixRecord(),
    paths: {
      dataDir: paths.dataDir,
      logDir: paths.logDir,
      pidFile: paths.pidFile,
      runDir: paths.runDir,
      socketFile: paths.socketFile
    },
    recordedAt: String(recordedAt || new Date().toISOString()),
    schema: JSKIT_MANAGED_MARIADB_SERVICE_SCHEMA,
    schemaVersion: JSKIT_MANAGED_MARIADB_SERVICE_SCHEMA_VERSION,
    service: {
      catalogEntryId: JSKIT_MANAGED_MARIADB_RUNTIME_ID,
      id: "mariadb",
      label: "MariaDB",
      version: "10.11"
    },
    status: String(status || "configured")
  };
}

function jskitManagedMariaDbServiceSecrets({
  databaseName = "",
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  return {
    admin: {
      password: JSKIT_MARIADB_ROOT_PASSWORD,
      username: "root"
    },
    app: {
      password: jskitMariaDbAppPassword(targetRoot, {
        serviceDataRoot
      }),
      username: JSKIT_MARIADB_APP_USER
    },
    database: {
      name: String(databaseName || jskitMariaDbDatabaseName(targetRoot)).trim()
    },
    schema: `${JSKIT_MANAGED_MARIADB_SERVICE_SCHEMA}.secrets`,
    schemaVersion: JSKIT_MANAGED_MARIADB_SERVICE_SCHEMA_VERSION,
    service: {
      catalogEntryId: JSKIT_MANAGED_MARIADB_RUNTIME_ID,
      id: "mariadb"
    }
  };
}

function mariaDbSingleQuoted(value = "") {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("'", "''");
}

function mariaDbBacktickQuoted(value = "") {
  return String(value || "").replaceAll("`", "``");
}

function jskitManagedMariaDbStartScript({
  databaseName = "",
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  const runtimeRoot = jskitManagedMariaDbRuntimeRoot({
    serviceDataRoot
  });
  if (!runtimeRoot) {
    throw new Error("JSKIT managed MariaDB requires Vibe64 serviceDataRoot.");
  }
  const port = jskitMariaDbHostPort(targetRoot, {
    serviceDataRoot
  });
  const database = String(databaseName || jskitMariaDbDatabaseName(targetRoot)).trim();
  const tenantDatabaseGrantPattern = jskitMariaDbTenantDatabaseGrantPattern(targetRoot, {
    serviceDataRoot
  });
  const createDatabaseSql = `CREATE DATABASE IF NOT EXISTS \`${mariaDbBacktickQuoted(database)}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`;
  const appUserSql = mariaDbSingleQuoted(JSKIT_MARIADB_APP_USER);
  const appPasswordSql = mariaDbSingleQuoted(jskitMariaDbAppPassword(targetRoot, {
    serviceDataRoot
  }));
  const metadataStartingJson = stableRuntimeJson(jskitManagedMariaDbServiceMetadata({
    databaseName: database,
    serviceDataRoot,
    status: "starting",
    targetRoot
  }));
  const metadataRunningJson = stableRuntimeJson(jskitManagedMariaDbServiceMetadata({
    databaseName: database,
    serviceDataRoot,
    status: "running",
    targetRoot
  }));
  const secretsJson = stableRuntimeJson(jskitManagedMariaDbServiceSecrets({
    databaseName: database,
    serviceDataRoot,
    targetRoot
  }));
  const grantSql = [
    createDatabaseSql,
    `CREATE USER IF NOT EXISTS '${appUserSql}'@'localhost' IDENTIFIED BY '${appPasswordSql}'`,
    `ALTER USER '${appUserSql}'@'localhost' IDENTIFIED BY '${appPasswordSql}'`,
    `GRANT ALL PRIVILEGES ON \`${mariaDbBacktickQuoted(tenantDatabaseGrantPattern)}\`.* TO '${appUserSql}'@'localhost'`,
    `CREATE USER IF NOT EXISTS '${appUserSql}'@'127.0.0.1' IDENTIFIED BY '${appPasswordSql}'`,
    `ALTER USER '${appUserSql}'@'127.0.0.1' IDENTIFIED BY '${appPasswordSql}'`,
    `GRANT ALL PRIVILEGES ON \`${mariaDbBacktickQuoted(tenantDatabaseGrantPattern)}\`.* TO '${appUserSql}'@'127.0.0.1'`,
    "FLUSH PRIVILEGES"
  ].join("; ");
  const rootPasswordSql = mariaDbSingleQuoted(JSKIT_MARIADB_ROOT_PASSWORD);
  return [
    "set -euo pipefail",
    `runtime_root=${shellQuote(runtimeRoot)}`,
    `mariadb_port=${shellQuote(port)}`,
    `mariadb_password=${shellQuote(JSKIT_MARIADB_ROOT_PASSWORD)}`,
    `app_user=${shellQuote(JSKIT_MARIADB_APP_USER)}`,
    `app_password=${shellQuote(jskitMariaDbAppPassword(targetRoot, {
      serviceDataRoot
    }))}`,
    `database_name=${shellQuote(database)}`,
    `tenant_database_grant_pattern=${shellQuote(tenantDatabaseGrantPattern)}`,
    `create_database_sql=${shellQuote(createDatabaseSql)}`,
    `grant_sql=${shellQuote(grantSql)}`,
    `metadata_starting_json=${shellQuote(metadataStartingJson)}`,
    `metadata_running_json=${shellQuote(metadataRunningJson)}`,
    `secrets_json=${shellQuote(secretsJson)}`,
    "data_dir=\"$runtime_root/data\"",
    "run_dir=\"$runtime_root/run\"",
    "log_dir=\"$runtime_root/log\"",
    "metadata_file=\"$runtime_root/metadata.json\"",
    "secrets_file=\"$runtime_root/secrets.json\"",
    "pid_file=\"$run_dir/mariadbd.pid\"",
    "socket_file=\"$run_dir/mariadb.sock\"",
    "mkdir -p \"$data_dir\" \"$run_dir\" \"$log_dir\"",
    "chmod 700 \"$runtime_root\" \"$data_dir\" \"$run_dir\" \"$log_dir\"",
    "cd \"$runtime_root\"",
    "write_service_state() {",
    "  printf '%s' \"$1\" > \"$metadata_file\"",
    "  printf '%s' \"$secrets_json\" > \"$secrets_file\"",
    "  chmod 600 \"$metadata_file\" \"$secrets_file\"",
    "}",
    "write_service_state \"$metadata_starting_json\"",
    "mariadb_root_password() {",
    "  mariadb --no-defaults --protocol=TCP --host=127.0.0.1 --port=\"$mariadb_port\" --user=root --password=\"$mariadb_password\" \"$@\"",
    "}",
    "mariadb_root_open() {",
    "  mariadb --no-defaults --protocol=TCP --host=127.0.0.1 --port=\"$mariadb_port\" --user=root \"$@\"",
    "}",
    "mariadb_app_password() {",
    "  mariadb --no-defaults --protocol=TCP --host=127.0.0.1 --port=\"$mariadb_port\" --user=\"$app_user\" --password=\"$app_password\" \"$database_name\" \"$@\"",
    "}",
    "mariadb_ready_with_password() {",
    "  mariadb_root_password --execute=\"SELECT 1\" >/dev/null 2>&1",
    "}",
    "mariadb_ready_without_password() {",
    "  mariadb_root_open --execute=\"SELECT 1\" >/dev/null 2>&1",
    "}",
    "if [ -s \"$pid_file\" ] && kill -0 \"$(cat \"$pid_file\")\" 2>/dev/null; then",
    "  if mariadb_ready_with_password; then",
    "    mariadb_root_password --execute=\"$grant_sql\"",
    "    mariadb_app_password --execute=\"SELECT 1\" >/dev/null",
    "    write_service_state \"$metadata_running_json\"",
    "    printf '[studio] JSKIT MariaDB is already running on 127.0.0.1:%s.\\n' \"$mariadb_port\"",
    "    exit 0",
    "  fi",
    "fi",
    "rm -f \"$socket_file\"",
    "mariadb_initialize_data_dir() {",
    "  find \"$data_dir\" -mindepth 1 -maxdepth 1 -exec rm -rf {} +",
    "  mariadb-install-db --no-defaults --datadir=\"$data_dir\" --auth-root-authentication-method=normal --skip-test-db >\"$log_dir/init.log\" 2>&1",
    "}",
    "mariadb_start_server() {",
    "  mariadb_start_args=(--no-defaults --datadir=\"$data_dir\" --socket=\"$socket_file\" --pid-file=\"$pid_file\" --port=\"$mariadb_port\" --bind-address=127.0.0.1 --log-error=\"$log_dir/mariadb.log\")",
    "  mariadbd \"${mariadb_start_args[@]}\" >/dev/null 2>&1 &",
    "}",
    "if [ ! -d \"$data_dir/mysql\" ]; then",
    "  mariadb_initialize_data_dir",
    "fi",
    "mariadb_start_server",
    "for _attempt in $(seq 1 120); do",
    "  if mariadb_ready_with_password || mariadb_ready_without_password; then",
    "    break",
    "  fi",
    "  sleep 0.25",
    "done",
    "if mariadb_ready_without_password; then",
    `  mariadb_root_open --execute="ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPasswordSql}'; FLUSH PRIVILEGES;"`,
    "fi",
    "if ! mariadb_ready_with_password; then",
    "  printf '[studio] JSKIT MariaDB did not become ready. See %s.\\n' \"$log_dir/mariadb.log\" >&2",
    "  exit 1",
    "fi",
    "mariadb_root_password --execute=\"$grant_sql\"",
    "mariadb_app_password --execute=\"SELECT 1\" >/dev/null",
    "write_service_state \"$metadata_running_json\"",
    "printf '[studio] JSKIT MariaDB is ready on 127.0.0.1:%s.\\n' \"$mariadb_port\""
  ].join("\n");
}

function jskitManagedMariaDbStartCommandArgs({
  databaseName = "",
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  return runtimeShellCommandArgs(
    [JSKIT_MANAGED_MARIADB_RUNTIME_ID],
    jskitManagedMariaDbStartScript({
      databaseName,
      serviceDataRoot,
      targetRoot
    }),
    {
      preferSharedRuntimePacks: true
    }
  );
}

function jskitPublishedMariaDbGrantSql({
  databaseName = "",
  targetRoot = ""
} = {}) {
  const database = String(databaseName || jskitMariaDbDatabaseName(targetRoot)).trim();
  const appUserSql = mariaDbSingleQuoted(jskitMariaDbPublishedAppUser(database));
  const appPasswordSql = mariaDbSingleQuoted(jskitMariaDbPublishedAppPassword(database, {
    targetRoot
  }));
  return [
    `CREATE DATABASE IF NOT EXISTS \`${mariaDbBacktickQuoted(database)}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE USER IF NOT EXISTS '${appUserSql}'@'localhost' IDENTIFIED BY '${appPasswordSql}'`,
    `ALTER USER '${appUserSql}'@'localhost' IDENTIFIED BY '${appPasswordSql}'`,
    `GRANT ALL PRIVILEGES ON \`${mariaDbBacktickQuoted(database)}\`.* TO '${appUserSql}'@'localhost'`,
    `CREATE USER IF NOT EXISTS '${appUserSql}'@'127.0.0.1' IDENTIFIED BY '${appPasswordSql}'`,
    `ALTER USER '${appUserSql}'@'127.0.0.1' IDENTIFIED BY '${appPasswordSql}'`,
    `GRANT ALL PRIVILEGES ON \`${mariaDbBacktickQuoted(database)}\`.* TO '${appUserSql}'@'127.0.0.1'`,
    "FLUSH PRIVILEGES"
  ].join("; ");
}

function jskitPublishedMariaDbPrepareScript({
  databaseName = "",
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  const database = String(databaseName || jskitMariaDbDatabaseName(targetRoot)).trim();
  const port = jskitMariaDbHostPort(targetRoot, {
    serviceDataRoot
  });
  const appUser = jskitMariaDbPublishedAppUser(database);
  const appPassword = jskitMariaDbPublishedAppPassword(database, {
    targetRoot
  });
  const grantSql = jskitPublishedMariaDbGrantSql({
    databaseName: database,
    targetRoot
  });
  return [
    "set -euo pipefail",
    "printf '\\n[studio] Preparing JSKIT production database.\\n'",
    "(",
    jskitManagedMariaDbStartScript({
      databaseName: database,
      serviceDataRoot,
      targetRoot
    }),
    ")",
    `mariadb_port=${shellQuote(port)}`,
    `database_name=${shellQuote(database)}`,
    `app_user=${shellQuote(appUser)}`,
    `app_password=${shellQuote(appPassword)}`,
    `grant_sql=${shellQuote(grantSql)}`,
    "mariadb_root_password() {",
    "  mariadb --no-defaults --protocol=TCP --host=127.0.0.1 --port=\"$mariadb_port\" --user=root --password=\"$MYSQL_PWD\" \"$@\"",
    "}",
    "mariadb_published_app() {",
    "  mariadb --no-defaults --protocol=TCP --host=127.0.0.1 --port=\"$mariadb_port\" --user=\"$app_user\" --password=\"$app_password\" \"$database_name\" \"$@\"",
    "}",
    "mariadb_root_password --execute=\"$grant_sql\"",
    "mariadb_published_app --execute=\"SELECT 1\" >/dev/null",
    "printf '[studio] JSKIT production database is ready on 127.0.0.1:%s.\\n' \"$mariadb_port\""
  ].join("\n");
}

function jskitPublishedMariaDbPrepareCommand({
  databaseName = "",
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  return runtimeShellCommandArgs(
    [JSKIT_MANAGED_MARIADB_RUNTIME_ID],
    jskitPublishedMariaDbPrepareScript({
      databaseName,
      serviceDataRoot,
      targetRoot
    }),
    {
      preferSharedRuntimePacks: true
    }
  ).map(shellQuote).join(" ");
}

function managedMariaDbProcCmdlinePath(pid = 0) {
  return `/proc/${Number(pid || 0)}/cmdline`;
}

async function readManagedMariaDbProcCmdline(pid = 0, {
  readFileImpl = readFile
} = {}) {
  const text = String(await readFileImpl(managedMariaDbProcCmdlinePath(pid)));
  return text.split("\0").map((entry) => entry.trim()).filter(Boolean);
}

function managedMariaDbCmdlineMatchesTarget(cmdline = [], targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const expectedDataDir = jskitManagedMariaDbServicePaths(targetRoot, {
    serviceDataRoot
  }).dataDir;
  if (!expectedDataDir) {
    return false;
  }
  const resolvedExpectedDataDir = path.resolve(expectedDataDir);
  const args = Array.isArray(cmdline) ? cmdline.map((entry) => String(entry || "")) : [];
  const executable = path.basename(args[0] || "");
  return executable === "mariadbd" &&
    args.includes("--no-defaults") &&
    args.some((arg) => arg === `--datadir=${resolvedExpectedDataDir}`);
}

function processIsRunning(pid = 0, {
  killImpl = process.kill
} = {}) {
  try {
    killImpl(Number(pid), 0);
    return true;
  } catch (error) {
    return String(error?.code || "") === "EPERM";
  }
}

async function waitForProcessExit(pid = 0, {
  delayImpl = delay,
  intervalMs = 100,
  killImpl = process.kill,
  timeoutMs = 5000
} = {}) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0));
  while (Date.now() <= deadline) {
    if (!processIsRunning(pid, {
      killImpl
    })) {
      return true;
    }
    await delayImpl(Math.max(1, Number(intervalMs || 1)));
  }
  return !processIsRunning(pid, {
    killImpl
  });
}

async function stopJskitManagedMariaDbRuntime({
  delayImpl = delay,
  intervalMs = 100,
  killImpl = process.kill,
  readFileImpl = readFile,
  rmImpl = rm,
  serviceDataRoot = "",
  stdout = process.stdout,
  targetRoot = "",
  timeoutMs = 5000
} = {}) {
  const paths = jskitManagedMariaDbServicePaths(targetRoot, {
    serviceDataRoot
  });
  let pid = 0;
  try {
    pid = Number(String(await readFileImpl(paths.pidFile, "utf8")).trim());
  } catch {
    stdout.write("No managed MariaDB pid file found.\n");
    return {
      ok: true,
      status: "missing"
    };
  }
  if (!pid) {
    stdout.write("Managed MariaDB pid file is empty.\n");
    return {
      ok: false,
      status: "invalid-pid"
    };
  }

  if (!processIsRunning(pid, {
    killImpl
  })) {
    await rmImpl(paths.pidFile, {
      force: true
    });
    stdout.write(`Removed stale managed MariaDB pid file for pid ${pid}.\n`);
    return {
      ok: true,
      pid,
      status: "stale"
    };
  }

  let cmdline = [];
  try {
    cmdline = await readManagedMariaDbProcCmdline(pid, {
      readFileImpl
    });
  } catch (error) {
    stdout.write(`Could not validate managed MariaDB pid ${pid}: ${error.message || error}\n`);
    return {
      ok: false,
      pid,
      status: "unvalidated"
    };
  }
  if (!managedMariaDbCmdlineMatchesTarget(cmdline, targetRoot, {
    serviceDataRoot
  })) {
    stdout.write(`Refusing to stop pid ${pid}; it is not the managed MariaDB process for this project.\n`);
    return {
      ok: false,
      pid,
      status: "pid-mismatch"
    };
  }

  killImpl(pid, "SIGTERM");
  if (!await waitForProcessExit(pid, {
    delayImpl,
    intervalMs,
    killImpl,
    timeoutMs
  })) {
    killImpl(pid, "SIGKILL");
    if (!await waitForProcessExit(pid, {
      delayImpl,
      intervalMs,
      killImpl,
      timeoutMs: Math.min(2000, Math.max(500, Number(timeoutMs || 0)))
    })) {
      stdout.write(`Could not stop managed MariaDB pid ${pid}; process is still running.\n`);
      return {
        ok: false,
        pid,
        status: "still-running"
      };
    }
  }

  await rmImpl(paths.pidFile, {
    force: true
  });
  stdout.write(`Stopped managed MariaDB pid ${pid}.\n`);
  return {
    ok: true,
    pid,
    status: "stopped"
  };
}

function managedMariaDbAccessInstructions(databaseName = "", targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const database = String(databaseName || "").trim();
  const databaseArg = database ? ` ${database}` : "";
  return `Vibe64 MariaDB: mariadb --protocol=TCP --host=${JSKIT_MARIADB_HOST} --port=${jskitMariaDbHostPort(targetRoot, {
    serviceDataRoot
  })} --user=${JSKIT_MARIADB_APP_USER}${databaseArg}`;
}

async function readDatabaseHostFromDotEnv(targetRoot = "") {
  return readDatabaseHostFromEnvFile(targetRoot, {
    relativePath: ".env"
  });
}

export {
  jskitMariaDbDatabaseName,
  jskitMariaDbAppPassword,
  jskitMariaDbPublishedAppPassword,
  jskitMariaDbPublishedAppUser,
  jskitMariaDbTenantDatabaseGrantPattern,
  jskitMariaDbTenantName,
  jskitMariaDbHostPort,
  jskitManagedMariaDbServiceMetadata,
  jskitManagedMariaDbServicePaths,
  jskitManagedMariaDbServiceSecrets,
  jskitManagedMariaDbRuntimeRoot,
  jskitManagedMariaDbStartCommandArgs,
  jskitManagedMariaDbStartScript,
  jskitPublishedMariaDbPrepareCommand,
  managedMariaDbCmdlineMatchesTarget,
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_APP_USER,
  JSKIT_MARIADB_ROOT_PASSWORD,
  JSKIT_MANAGED_MARIADB_RUNTIME_ID,
  managedMariaDbAccessInstructions,
  mariaDbCapabilitySql,
  readDatabaseHostFromDotEnv,
  stopJskitManagedMariaDbRuntime,
  targetWantsJskitMariaDb,
  validateDatabaseName
};
