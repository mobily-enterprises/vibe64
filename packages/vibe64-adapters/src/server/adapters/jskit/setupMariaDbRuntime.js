import crypto from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  managedDatabaseNameFromTargetRoot
} from "@local/studio-terminal-core/server/managedDatabases";
import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  VIBE64_NIX_COMMAND,
  VIBE64_NIXPKGS_PIN,
  nixShellArgs,
  runtimePackage,
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
const JSKIT_MARIADB_APP_USER = "vibe64_jskit_app";
const JSKIT_MARIADB_ROOT_PASSWORD = "vibe64_jskit_root";
const JSKIT_MANAGED_MYSQL_RUNTIME_ID = "mysql-8.0";
const JSKIT_MANAGED_MYSQL_PORT_BASE = 23060;
const JSKIT_MANAGED_MYSQL_PORT_RANGE = 20000;
const JSKIT_MARIADB_PROBE_DATABASE = "vibe64_mariadb_probe";
const JSKIT_MARIADB_PROBE_TABLE = "capability_probe";
const JSKIT_MARIADB_PROBE_SQL_VARIABLE = "@vibe64_mariadb_probe_sql";
const JSKIT_MARIADB_PROBE_STATEMENT = "vibe64_mariadb_probe_statement";
const JSKIT_MANAGED_MYSQL_METADATA_FILE = "metadata.json";
const JSKIT_MANAGED_MYSQL_SECRETS_FILE = "secrets.json";
const JSKIT_MANAGED_MYSQL_SERVICE_SCHEMA = "vibe64.jskit-managed-mysql-service";
const JSKIT_MANAGED_MYSQL_SERVICE_SCHEMA_VERSION = 1;

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

function normalizeManagedMysqlServiceDataRoot(serviceDataRoot = "") {
  const root = String(serviceDataRoot || "").trim();
  return root ? path.resolve(root) : "";
}

function jskitManagedMysqlServiceSeed(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const serviceRoot = normalizeManagedMysqlServiceDataRoot(serviceDataRoot);
  if (serviceRoot) {
    return serviceRoot;
  }
  const root = String(targetRoot || "").trim();
  return root ? path.resolve(root) : "jskit-managed-mysql";
}

function jskitMariaDbHostPort(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  if (!String(targetRoot || "").trim() && !String(serviceDataRoot || "").trim()) {
    return "3306";
  }
  const hash = crypto
    .createHash("sha256")
    .update(jskitManagedMysqlServiceSeed(targetRoot, {
      serviceDataRoot
    }))
    .digest();
  return String(JSKIT_MANAGED_MYSQL_PORT_BASE + (hash.readUInt32BE(0) % JSKIT_MANAGED_MYSQL_PORT_RANGE));
}

function jskitMariaDbAppPassword(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const hash = crypto
    .createHash("sha256")
    .update(`${jskitManagedMysqlServiceSeed(targetRoot, {
      serviceDataRoot
    })}:jskit-app-user`)
    .digest("hex");
  return `v64_${hash.slice(0, 32)}`;
}

function jskitManagedMysqlRuntimeRoot({
  serviceDataRoot = ""
} = {}) {
  const root = normalizeManagedMysqlServiceDataRoot(serviceDataRoot);
  return root ? path.join(root, JSKIT_MANAGED_MYSQL_RUNTIME_ID) : "";
}

function jskitManagedMysqlServicePaths(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  void targetRoot;
  const runtimeRoot = jskitManagedMysqlRuntimeRoot({
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
    metadataFile: path.join(runtimeRoot, JSKIT_MANAGED_MYSQL_METADATA_FILE),
    pidFile: path.join(runtimeRoot, "run", "mysqld.pid"),
    runDir: path.join(runtimeRoot, "run"),
    runtimeRoot,
    secretsFile: path.join(runtimeRoot, JSKIT_MANAGED_MYSQL_SECRETS_FILE),
    socketFile: path.join(runtimeRoot, "run", "mysql.sock")
  };
}

function jskitManagedMysqlPackageNixRecord() {
  const entry = runtimePackage(JSKIT_MANAGED_MYSQL_RUNTIME_ID);
  return {
    attr: entry?.nix?.attr || "mysql80",
    flakeRef: entry?.nix?.flakeRef || VIBE64_NIXPKGS_PIN.flakeRef,
    nixpkgsPin: entry?.nix?.pin || VIBE64_NIXPKGS_PIN.id,
    rev: VIBE64_NIXPKGS_PIN.rev
  };
}

function jskitManagedMysqlServiceMetadata({
  databaseName = "",
  recordedAt = "",
  serviceDataRoot = "",
  status = "configured",
  targetRoot = ""
} = {}) {
  const paths = jskitManagedMysqlServicePaths(targetRoot, {
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
    nix: jskitManagedMysqlPackageNixRecord(),
    paths: {
      dataDir: paths.dataDir,
      logDir: paths.logDir,
      pidFile: paths.pidFile,
      runDir: paths.runDir,
      socketFile: paths.socketFile
    },
    recordedAt: String(recordedAt || new Date().toISOString()),
    schema: JSKIT_MANAGED_MYSQL_SERVICE_SCHEMA,
    schemaVersion: JSKIT_MANAGED_MYSQL_SERVICE_SCHEMA_VERSION,
    service: {
      catalogEntryId: JSKIT_MANAGED_MYSQL_RUNTIME_ID,
      id: "mysql",
      label: "MySQL 8.0",
      version: "8.0"
    },
    status: String(status || "configured")
  };
}

function jskitManagedMysqlServiceSecrets({
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
    schema: `${JSKIT_MANAGED_MYSQL_SERVICE_SCHEMA}.secrets`,
    schemaVersion: JSKIT_MANAGED_MYSQL_SERVICE_SCHEMA_VERSION,
    service: {
      catalogEntryId: JSKIT_MANAGED_MYSQL_RUNTIME_ID,
      id: "mysql"
    }
  };
}

function mysqlSingleQuoted(value = "") {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("'", "''");
}

function mysqlBacktickQuoted(value = "") {
  return String(value || "").replaceAll("`", "``");
}

function jskitManagedMysqlStartScript({
  databaseName = "",
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  const runtimeRoot = jskitManagedMysqlRuntimeRoot({
    serviceDataRoot
  });
  if (!runtimeRoot) {
    throw new Error("JSKIT managed MySQL requires Vibe64 serviceDataRoot.");
  }
  const port = jskitMariaDbHostPort(targetRoot, {
    serviceDataRoot
  });
  const database = String(databaseName || jskitMariaDbDatabaseName(targetRoot)).trim();
  const createDatabaseSql = `CREATE DATABASE IF NOT EXISTS \`${mysqlBacktickQuoted(database)}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`;
  const appUserSql = mysqlSingleQuoted(JSKIT_MARIADB_APP_USER);
  const appPasswordSql = mysqlSingleQuoted(jskitMariaDbAppPassword(targetRoot, {
    serviceDataRoot
  }));
  const metadataStartingJson = stableRuntimeJson(jskitManagedMysqlServiceMetadata({
    databaseName: database,
    serviceDataRoot,
    status: "starting",
    targetRoot
  }));
  const metadataRunningJson = stableRuntimeJson(jskitManagedMysqlServiceMetadata({
    databaseName: database,
    serviceDataRoot,
    status: "running",
    targetRoot
  }));
  const secretsJson = stableRuntimeJson(jskitManagedMysqlServiceSecrets({
    databaseName: database,
    serviceDataRoot,
    targetRoot
  }));
  const grantSql = [
    createDatabaseSql,
    `CREATE USER IF NOT EXISTS '${appUserSql}'@'localhost' IDENTIFIED BY '${appPasswordSql}'`,
    `ALTER USER '${appUserSql}'@'localhost' IDENTIFIED BY '${appPasswordSql}'`,
    `GRANT ALL PRIVILEGES ON \`${mysqlBacktickQuoted(database)}\`.* TO '${appUserSql}'@'localhost'`,
    `CREATE USER IF NOT EXISTS '${appUserSql}'@'127.0.0.1' IDENTIFIED BY '${appPasswordSql}'`,
    `ALTER USER '${appUserSql}'@'127.0.0.1' IDENTIFIED BY '${appPasswordSql}'`,
    `GRANT ALL PRIVILEGES ON \`${mysqlBacktickQuoted(database)}\`.* TO '${appUserSql}'@'127.0.0.1'`,
    "FLUSH PRIVILEGES"
  ].join("; ");
  const rootPasswordSql = mysqlSingleQuoted(JSKIT_MARIADB_ROOT_PASSWORD);
  return [
    "set -euo pipefail",
    `runtime_root=${shellQuote(runtimeRoot)}`,
    `mysql_port=${shellQuote(port)}`,
    `mysql_password=${shellQuote(JSKIT_MARIADB_ROOT_PASSWORD)}`,
    `app_user=${shellQuote(JSKIT_MARIADB_APP_USER)}`,
    `app_password=${shellQuote(jskitMariaDbAppPassword(targetRoot, {
      serviceDataRoot
    }))}`,
    `database_name=${shellQuote(database)}`,
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
    "pid_file=\"$run_dir/mysqld.pid\"",
    "socket_file=\"$run_dir/mysql.sock\"",
    "mkdir -p \"$data_dir\" \"$run_dir\" \"$log_dir\"",
    "chmod 700 \"$runtime_root\" \"$data_dir\" \"$run_dir\" \"$log_dir\"",
    "write_service_state() {",
    "  printf '%s' \"$1\" > \"$metadata_file\"",
    "  printf '%s' \"$secrets_json\" > \"$secrets_file\"",
    "  chmod 600 \"$metadata_file\" \"$secrets_file\"",
    "}",
    "write_service_state \"$metadata_starting_json\"",
    "mysql_root_password() {",
    "  MYSQL_PWD=\"$mysql_password\" mysql --no-defaults --protocol=TCP --host=127.0.0.1 --port=\"$mysql_port\" --user=root \"$@\"",
    "}",
    "mysql_root_open() {",
    "  mysql --no-defaults --protocol=TCP --host=127.0.0.1 --port=\"$mysql_port\" --user=root \"$@\"",
    "}",
    "mysql_app_password() {",
    "  MYSQL_PWD=\"$app_password\" mysql --no-defaults --protocol=TCP --host=127.0.0.1 --port=\"$mysql_port\" --user=\"$app_user\" \"$database_name\" \"$@\"",
    "}",
    "mysql_ready_with_password() {",
    "  mysql_root_password --execute=\"SELECT 1\" >/dev/null 2>&1",
    "}",
    "mysql_ready_without_password() {",
    "  mysql_root_open --execute=\"SELECT 1\" >/dev/null 2>&1",
    "}",
    "if [ -s \"$pid_file\" ] && kill -0 \"$(cat \"$pid_file\")\" 2>/dev/null; then",
    "  if mysql_ready_with_password; then",
    "    mysql_root_password --execute=\"$grant_sql\"",
    "    mysql_app_password --execute=\"SELECT 1\" >/dev/null",
    "    write_service_state \"$metadata_running_json\"",
    "    printf '[studio] JSKIT MySQL is already running on 127.0.0.1:%s.\\n' \"$mysql_port\"",
    "    exit 0",
    "  fi",
    "fi",
    "rm -f \"$socket_file\"",
    "if [ ! -d \"$data_dir/mysql\" ]; then",
    "  mysqld --no-defaults --initialize-insecure --datadir=\"$data_dir\" --log-error=\"$log_dir/init.log\"",
    "fi",
    "mysqld --no-defaults --datadir=\"$data_dir\" --socket=\"$socket_file\" --pid-file=\"$pid_file\" --port=\"$mysql_port\" --bind-address=127.0.0.1 --mysqlx=0 --log-error=\"$log_dir/mysql.log\" --daemonize",
    "for _attempt in $(seq 1 120); do",
    "  if mysql_ready_with_password || mysql_ready_without_password; then",
    "    break",
    "  fi",
    "  sleep 0.25",
    "done",
    "if mysql_ready_without_password; then",
    `  mysql_root_open --execute="ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPasswordSql}'; FLUSH PRIVILEGES;"`,
    "fi",
    "if ! mysql_ready_with_password; then",
    "  printf '[studio] JSKIT MySQL did not become ready. See %s.\\n' \"$log_dir/mysql.log\" >&2",
    "  exit 1",
    "fi",
    "mysql_root_password --execute=\"$grant_sql\"",
    "mysql_app_password --execute=\"SELECT 1\" >/dev/null",
    "write_service_state \"$metadata_running_json\"",
    "printf '[studio] JSKIT MySQL is ready on 127.0.0.1:%s.\\n' \"$mysql_port\""
  ].join("\n");
}

function jskitManagedMysqlStartCommandArgs({
  databaseName = "",
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  return [
    VIBE64_NIX_COMMAND,
      ...nixShellArgs(["mysql-8.0"], [
        "bash",
        "-lc",
        jskitManagedMysqlStartScript({
          databaseName,
          serviceDataRoot,
          targetRoot
        })
      ])
    ];
  }

function managedMysqlProcCmdlinePath(pid = 0) {
  return `/proc/${Number(pid || 0)}/cmdline`;
}

async function readManagedMysqlProcCmdline(pid = 0, {
  readFileImpl = readFile
} = {}) {
  const text = String(await readFileImpl(managedMysqlProcCmdlinePath(pid)));
  return text.split("\0").map((entry) => entry.trim()).filter(Boolean);
}

function managedMysqlCmdlineMatchesTarget(cmdline = [], targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const expectedDataDir = jskitManagedMysqlServicePaths(targetRoot, {
    serviceDataRoot
  }).dataDir;
  if (!expectedDataDir) {
    return false;
  }
  const resolvedExpectedDataDir = path.resolve(expectedDataDir);
  const args = Array.isArray(cmdline) ? cmdline.map((entry) => String(entry || "")) : [];
  const executable = path.basename(args[0] || "");
  return executable === "mysqld" &&
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

async function stopJskitManagedMysqlRuntime({
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
  const paths = jskitManagedMysqlServicePaths(targetRoot, {
    serviceDataRoot
  });
  let pid = 0;
  try {
    pid = Number(String(await readFileImpl(paths.pidFile, "utf8")).trim());
  } catch {
    stdout.write("No managed MySQL pid file found.\n");
    return {
      ok: true,
      status: "missing"
    };
  }
  if (!pid) {
    stdout.write("Managed MySQL pid file is empty.\n");
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
    stdout.write(`Removed stale managed MySQL pid file for pid ${pid}.\n`);
    return {
      ok: true,
      pid,
      status: "stale"
    };
  }

  let cmdline = [];
  try {
    cmdline = await readManagedMysqlProcCmdline(pid, {
      readFileImpl
    });
  } catch (error) {
    stdout.write(`Could not validate managed MySQL pid ${pid}: ${error.message || error}\n`);
    return {
      ok: false,
      pid,
      status: "unvalidated"
    };
  }
  if (!managedMysqlCmdlineMatchesTarget(cmdline, targetRoot, {
    serviceDataRoot
  })) {
    stdout.write(`Refusing to stop pid ${pid}; it is not the managed MySQL process for this project.\n`);
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
      stdout.write(`Could not stop managed MySQL pid ${pid}; process is still running.\n`);
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
  stdout.write(`Stopped managed MySQL pid ${pid}.\n`);
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
  return `Vibe64 MySQL: mysql --protocol=TCP --host=${JSKIT_MARIADB_HOST} --port=${jskitMariaDbHostPort(targetRoot, {
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
  jskitMariaDbHostPort,
  jskitManagedMysqlServiceMetadata,
  jskitManagedMysqlServicePaths,
  jskitManagedMysqlServiceSecrets,
  jskitManagedMysqlRuntimeRoot,
  jskitManagedMysqlStartCommandArgs,
  jskitManagedMysqlStartScript,
  managedMysqlCmdlineMatchesTarget,
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_APP_USER,
  JSKIT_MARIADB_ROOT_PASSWORD,
  JSKIT_MANAGED_MYSQL_RUNTIME_ID,
  managedMariaDbAccessInstructions,
  mariaDbCapabilitySql,
  readDatabaseHostFromDotEnv,
  stopJskitManagedMysqlRuntime,
  targetWantsJskitMariaDb,
  validateDatabaseName
};
