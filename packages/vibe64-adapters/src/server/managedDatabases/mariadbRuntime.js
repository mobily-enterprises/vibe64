import path from "node:path";

import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  runtimeShellCommandArgs,
  stableRuntimeJson
} from "@local/vibe64-core/server/runtimeToolchain";

import {
  managedServiceRuntimeNixRecord,
  managedServiceRuntimeRoot,
  managedServiceStateWriterShellLines,
  readManagedServiceSecret
} from "../managedServices/runtime.js";

import {
  RELATIONAL_DATABASE_HOST,
  relationalDatabasePort
} from "./deployment.js";
import {
  defaultValidateDatabaseName as validateDatabaseName
} from "../adapterHelpers/setupMariaDbChecks.js";

const MANAGED_MARIADB_RUNTIME_ID = "mariadb";
const MANAGED_MARIADB_PREVIOUS_BOOTSTRAP_PASSWORD = "vibe64_jskit_root";
const MANAGED_MARIADB_METADATA_FILE = "metadata.json";
const MANAGED_MARIADB_ADMIN_PASSWORD_FILE = "admin-password";
const MANAGED_MARIADB_SERVICE_SCHEMA = "vibe64.managed-service.mariadb";
const MANAGED_MARIADB_SERVICE_SCHEMA_VERSION = 1;

function managedMariaDbPort({
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  return relationalDatabasePort({
    provider: MANAGED_MARIADB_RUNTIME_ID,
    serviceDataRoot,
    targetRoot
  });
}

function managedMariaDbRuntimeRoot({
  serviceDataRoot = ""
} = {}) {
  return managedServiceRuntimeRoot({
    serviceDataRoot,
    serviceDirectory: MANAGED_MARIADB_RUNTIME_ID
  });
}

function managedMariaDbServicePaths({
  serviceDataRoot = ""
} = {}) {
  const runtimeRoot = managedMariaDbRuntimeRoot({
    serviceDataRoot
  });
  if (!runtimeRoot) {
    return {
      adminPasswordFile: "",
      dataDir: "",
      logDir: "",
      metadataFile: "",
      pidFile: "",
      runDir: "",
      runtimeRoot: "",
      socketFile: ""
    };
  }
  return {
    adminPasswordFile: path.join(runtimeRoot, MANAGED_MARIADB_ADMIN_PASSWORD_FILE),
    dataDir: path.join(runtimeRoot, "data"),
    logDir: path.join(runtimeRoot, "log"),
    metadataFile: path.join(runtimeRoot, MANAGED_MARIADB_METADATA_FILE),
    pidFile: path.join(runtimeRoot, "run", "mariadbd.pid"),
    runDir: path.join(runtimeRoot, "run"),
    runtimeRoot,
    socketFile: path.join(runtimeRoot, "run", "mariadb.sock")
  };
}

async function readManagedMariaDbAdminPassword({
  serviceDataRoot = ""
} = {}) {
  const adminPasswordFile = managedMariaDbServicePaths({
    serviceDataRoot
  }).adminPasswordFile;
  return readManagedServiceSecret(adminPasswordFile, {
    label: "Managed MariaDB administrator"
  });
}

function managedMariaDbPackageNixRecord() {
  return managedServiceRuntimeNixRecord(MANAGED_MARIADB_RUNTIME_ID);
}

function managedMariaDbServiceMetadata({
  configuredAt = "",
  serviceDataRoot = "",
  status = "configured",
  targetRoot = ""
} = {}) {
  const paths = managedMariaDbServicePaths({
    serviceDataRoot
  });
  return {
    configuredAt: normalizeText(configuredAt) || new Date().toISOString(),
    connection: {
      host: RELATIONAL_DATABASE_HOST,
      port: managedMariaDbPort({
        serviceDataRoot,
        targetRoot
      }),
      socket: paths.socketFile
    },
    nix: managedMariaDbPackageNixRecord(),
    paths: {
      dataDir: paths.dataDir,
      logDir: paths.logDir,
      pidFile: paths.pidFile,
      runDir: paths.runDir,
      socketFile: paths.socketFile
    },
    schema: MANAGED_MARIADB_SERVICE_SCHEMA,
    schemaVersion: MANAGED_MARIADB_SERVICE_SCHEMA_VERSION,
    service: {
      catalogEntryId: MANAGED_MARIADB_RUNTIME_ID,
      id: MANAGED_MARIADB_RUNTIME_ID,
      label: "MariaDB",
      version: "10.11"
    },
    status: normalizeText(status) || "configured"
  };
}

function managedMariaDbServiceStartScript({
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  const runtimeRoot = managedMariaDbRuntimeRoot({
    serviceDataRoot
  });
  if (!runtimeRoot) {
    throw new Error("Managed MariaDB requires Vibe64 serviceDataRoot.");
  }
  const port = managedMariaDbPort({
    serviceDataRoot,
    targetRoot
  });
  const configuredAt = new Date().toISOString();
  const metadataStartingJson = stableRuntimeJson(managedMariaDbServiceMetadata({
    configuredAt,
    serviceDataRoot,
    status: "starting",
    targetRoot
  }));
  const metadataRunningJson = stableRuntimeJson(managedMariaDbServiceMetadata({
    configuredAt,
    serviceDataRoot,
    status: "running",
    targetRoot
  }));
  return [
    "set -euo pipefail",
    `runtime_root=${shellQuote(runtimeRoot)}`,
    `mariadb_port=${shellQuote(port)}`,
    `previous_bootstrap_password=${shellQuote(MANAGED_MARIADB_PREVIOUS_BOOTSTRAP_PASSWORD)}`,
    `metadata_starting_json=${shellQuote(metadataStartingJson)}`,
    `metadata_running_json=${shellQuote(metadataRunningJson)}`,
    "admin_password_file=\"$runtime_root/admin-password\"",
    "data_dir=\"$runtime_root/data\"",
    "run_dir=\"$runtime_root/run\"",
    "log_dir=\"$runtime_root/log\"",
    "metadata_file=\"$runtime_root/metadata.json\"",
    "pid_file=\"$run_dir/mariadbd.pid\"",
    "socket_file=\"$run_dir/mariadb.sock\"",
    "mkdir -p \"$data_dir\" \"$run_dir\" \"$log_dir\"",
    "chmod 700 \"$runtime_root\" \"$data_dir\" \"$run_dir\" \"$log_dir\"",
    "stored_mariadb_password=\"\"",
    "if [ -s \"$admin_password_file\" ]; then",
    "  stored_mariadb_password=\"$(cat \"$admin_password_file\")\"",
    "fi",
    "if [ -z \"$stored_mariadb_password\" ] || [ \"$stored_mariadb_password\" = \"$previous_bootstrap_password\" ]; then",
    "  mariadb_password=\"$(od -An -N32 -tx1 /dev/urandom | tr -d ' \\n')\"",
    "  temporary_admin_password_file=\"$admin_password_file.next.$$\"",
    "  umask 077",
    "  printf '%s' \"$mariadb_password\" > \"$temporary_admin_password_file\"",
    "  chmod 600 \"$temporary_admin_password_file\"",
    "  mv -f \"$temporary_admin_password_file\" \"$admin_password_file\"",
    "else",
    "  mariadb_password=\"$stored_mariadb_password\"",
    "fi",
    "chmod 600 \"$admin_password_file\"",
    "cd \"$runtime_root\"",
    ...managedServiceStateWriterShellLines(),
    "write_service_state \"$metadata_starting_json\"",
    "mariadb_root_using_password() {",
    "  local password=\"$1\"",
    "  shift",
    "  MYSQL_PWD=\"$password\" mariadb --no-defaults --protocol=TCP --host=127.0.0.1 --port=\"$mariadb_port\" --user=root \"$@\"",
    "}",
    "mariadb_root_password() {",
    "  mariadb_root_using_password \"$mariadb_password\" \"$@\"",
    "}",
    "mariadb_root_previous_bootstrap() {",
    "  mariadb_root_using_password \"$previous_bootstrap_password\" \"$@\"",
    "}",
    "mariadb_root_open() {",
    "  env -u MYSQL_PWD mariadb --no-defaults --protocol=TCP --host=127.0.0.1 --port=\"$mariadb_port\" --user=root \"$@\"",
    "}",
    "mariadb_ready_with_password() {",
    "  mariadb_root_password --execute=\"SELECT 1\" >/dev/null 2>&1",
    "}",
    "mariadb_ready_without_password() {",
    "  mariadb_root_open --execute=\"SELECT 1\" >/dev/null 2>&1",
    "}",
    "mariadb_ready_with_previous_bootstrap() {",
    "  mariadb_root_previous_bootstrap --execute=\"SELECT 1\" >/dev/null 2>&1",
    "}",
    "mariadb_wait_until_ready() {",
    "  for _attempt in $(seq 1 120); do",
    "    if mariadb_ready_with_password || mariadb_ready_without_password || mariadb_ready_with_previous_bootstrap; then",
    "      return 0",
    "    fi",
    "    sleep 0.25",
    "  done",
    "  return 1",
    "}",
    "mariadb_wait_for_started_process() {",
    "  local started_pid=\"$1\"",
    "  local recorded_pid=\"\"",
    "  for _attempt in $(seq 1 120); do",
    "    if ! kill -0 \"$started_pid\" 2>/dev/null; then",
    "      return 1",
    "    fi",
    "    if [ -s \"$pid_file\" ]; then",
    "      recorded_pid=\"$(cat \"$pid_file\")\"",
    "      if [ \"$recorded_pid\" = \"$started_pid\" ] && (mariadb_ready_with_password || mariadb_ready_without_password || mariadb_ready_with_previous_bootstrap); then",
    "        return 0",
    "      fi",
    "    fi",
    "    sleep 0.25",
    "  done",
    "  return 1",
    "}",
    "mariadb_apply_initial_admin_password() {",
    "  if mariadb_ready_with_password; then",
    "    return 0",
    "  fi",
    "  if mariadb_ready_without_password; then",
    "    mariadb_root_open --execute=\"ALTER USER 'root'@'localhost' IDENTIFIED BY '$mariadb_password'; FLUSH PRIVILEGES;\"",
    "    return 0",
    "  fi",
    "  if mariadb_ready_with_previous_bootstrap; then",
    "    mariadb_root_previous_bootstrap --execute=\"ALTER USER 'root'@'localhost' IDENTIFIED BY '$mariadb_password'; FLUSH PRIVILEGES;\"",
    "  fi",
    "}",
    "mariadb_already_running=false",
    "if [ -s \"$pid_file\" ] && kill -0 \"$(cat \"$pid_file\")\" 2>/dev/null; then",
    "  if ! mariadb_wait_until_ready; then",
    "    printf '[studio] Managed MariaDB has a live process but did not become ready. See %s.\\n' \"$log_dir/mariadb.log\" >&2",
    "    exit 1",
    "  fi",
    "  mariadb_apply_initial_admin_password",
    "  if ! mariadb_ready_with_password; then",
    "    printf '[studio] Managed MariaDB administrator secret does not authenticate the live service.\\n' >&2",
    "    exit 1",
    "  fi",
    "  mariadb_already_running=true",
    "fi",
    "if [ \"$mariadb_already_running\" = false ]; then",
    "  rm -f \"$pid_file\" \"$socket_file\"",
    "  if [ ! -d \"$data_dir/mysql\" ]; then",
    "    find \"$data_dir\" -mindepth 1 -maxdepth 1 -exec rm -rf {} +",
    "    mariadb-install-db --no-defaults --datadir=\"$data_dir\" --auth-root-authentication-method=normal --skip-test-db >\"$log_dir/init.log\" 2>&1",
    "  fi",
    "  mariadb_start_args=(--no-defaults --datadir=\"$data_dir\" --socket=\"$socket_file\" --pid-file=\"$pid_file\" --port=\"$mariadb_port\" --bind-address=127.0.0.1 --log-error=\"$log_dir/mariadb.log\")",
    "  mariadbd \"${mariadb_start_args[@]}\" >/dev/null 2>&1 &",
    "  mariadb_started_pid=$!",
    "  if ! mariadb_wait_for_started_process \"$mariadb_started_pid\"; then",
    "    kill -TERM \"$mariadb_started_pid\" 2>/dev/null || true",
    "    printf '[studio] Managed MariaDB did not become ready. See %s.\\n' \"$log_dir/mariadb.log\" >&2",
    "    exit 1",
    "  fi",
    "  mariadb_apply_initial_admin_password",
    "  if ! mariadb_ready_with_password; then",
    "    printf '[studio] Managed MariaDB administrator secret could not be applied. See %s.\\n' \"$log_dir/mariadb.log\" >&2",
    "    exit 1",
    "  fi",
    "fi",
    "write_service_state \"$metadata_running_json\"",
    "if [ \"$mariadb_already_running\" = true ]; then",
    "  printf '[studio] Managed MariaDB is already running on 127.0.0.1:%s.\\n' \"$mariadb_port\"",
    "else",
    "  printf '[studio] Managed MariaDB is ready on 127.0.0.1:%s.\\n' \"$mariadb_port\"",
    "fi"
  ].join("\n");
}

function managedMariaDbServiceStartCommandArgs({
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  return runtimeShellCommandArgs(
    [MANAGED_MARIADB_RUNTIME_ID],
    managedMariaDbServiceStartScript({
      serviceDataRoot,
      targetRoot
    }),
    {
      preferSharedRuntimePacks: true
    }
  );
}

function mariaDbSingleQuoted(value = "") {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("'", "''");
}

function mariaDbBacktickQuoted(value = "") {
  return String(value || "").replaceAll("`", "``");
}

function mariaDbExactGrantPattern(databaseName = "") {
  return String(databaseName || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("_", "\\_")
    .replaceAll("%", "\\%");
}

function managedMariaDbApplicationGrantSql({
  appPassword = "",
  appUser = "",
  databaseName = "",
  grantPattern = ""
} = {}) {
  const databaseValidation = validateDatabaseName(databaseName);
  if (!databaseValidation.ok) {
    throw new Error("Managed MariaDB database name is invalid.");
  }
  const database = databaseValidation.databaseName;
  const normalizedAppUser = normalizeText(appUser);
  if (!normalizedAppUser || !/^[A-Za-z0-9_]+$/u.test(normalizedAppUser)) {
    throw new Error("Managed MariaDB application user is invalid.");
  }
  const normalizedAppPassword = String(appPassword || "");
  if (!normalizedAppPassword) {
    throw new Error("Managed MariaDB application password is required.");
  }
  const normalizedGrantPattern = normalizeText(grantPattern || database);
  if (!normalizedGrantPattern || !/^[A-Za-z0-9_\\%]+$/u.test(normalizedGrantPattern)) {
    throw new Error("Managed MariaDB database grant pattern is invalid.");
  }
  const appUserSql = mariaDbSingleQuoted(normalizedAppUser);
  const appPasswordSql = mariaDbSingleQuoted(normalizedAppPassword);
  const grantPatternSql = mariaDbBacktickQuoted(normalizedGrantPattern);
  return [
    `CREATE DATABASE IF NOT EXISTS \`${mariaDbBacktickQuoted(database)}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE USER IF NOT EXISTS '${appUserSql}'@'localhost' IDENTIFIED BY '${appPasswordSql}'`,
    `ALTER USER '${appUserSql}'@'localhost' IDENTIFIED BY '${appPasswordSql}'`,
    `GRANT ALL PRIVILEGES ON \`${grantPatternSql}\`.* TO '${appUserSql}'@'localhost'`,
    `CREATE USER IF NOT EXISTS '${appUserSql}'@'127.0.0.1' IDENTIFIED BY '${appPasswordSql}'`,
    `ALTER USER '${appUserSql}'@'127.0.0.1' IDENTIFIED BY '${appPasswordSql}'`,
    `GRANT ALL PRIVILEGES ON \`${grantPatternSql}\`.* TO '${appUserSql}'@'127.0.0.1'`,
    "FLUSH PRIVILEGES"
  ].join("; ");
}

function managedMariaDbDatabaseGrantSql({
  appPassword = "",
  appUser = "",
  databaseName = ""
} = {}) {
  return managedMariaDbApplicationGrantSql({
    appPassword,
    appUser,
    databaseName,
    grantPattern: mariaDbExactGrantPattern(databaseName)
  });
}

export {
  MANAGED_MARIADB_RUNTIME_ID,
  managedMariaDbApplicationGrantSql,
  managedMariaDbDatabaseGrantSql,
  managedMariaDbPort,
  managedMariaDbRuntimeRoot,
  managedMariaDbServiceMetadata,
  managedMariaDbServicePaths,
  managedMariaDbServiceStartCommandArgs,
  managedMariaDbServiceStartScript,
  readManagedMariaDbAdminPassword
};
