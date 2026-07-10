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
  relationalDatabaseNamePart,
  relationalDatabasePort
} from "./deployment.js";

const MANAGED_POSTGRES_PROVIDER_ID = "postgres";
const MANAGED_POSTGRES_RUNTIME_ID = "postgresql";
const MANAGED_POSTGRES_SERVICE_DIR = "postgres";
const MANAGED_POSTGRES_ADMIN_USER = "postgres";
const MANAGED_POSTGRES_METADATA_FILE = "metadata.json";
const MANAGED_POSTGRES_ADMIN_PASSWORD_FILE = "admin-password";
const MANAGED_POSTGRES_SERVICE_SCHEMA = "vibe64.managed-service.postgres";
const MANAGED_POSTGRES_SERVICE_SCHEMA_VERSION = 1;

function managedPostgresPort({
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  return relationalDatabasePort({
    provider: MANAGED_POSTGRES_PROVIDER_ID,
    serviceDataRoot,
    targetRoot
  });
}

function managedPostgresRuntimeRoot({
  serviceDataRoot = ""
} = {}) {
  return managedServiceRuntimeRoot({
    serviceDataRoot,
    serviceDirectory: MANAGED_POSTGRES_SERVICE_DIR
  });
}

function managedPostgresServicePaths({
  serviceDataRoot = ""
} = {}) {
  const runtimeRoot = managedPostgresRuntimeRoot({
    serviceDataRoot
  });
  if (!runtimeRoot) {
    return {
      adminPasswordFile: "",
      dataDir: "",
      logFile: "",
      metadataFile: "",
      pidFile: "",
      runDir: "",
      runtimeRoot: ""
    };
  }
  const dataDir = path.join(runtimeRoot, "data");
  return {
    adminPasswordFile: path.join(runtimeRoot, MANAGED_POSTGRES_ADMIN_PASSWORD_FILE),
    dataDir,
    logFile: path.join(runtimeRoot, "postgres.log"),
    metadataFile: path.join(runtimeRoot, MANAGED_POSTGRES_METADATA_FILE),
    pidFile: path.join(dataDir, "postmaster.pid"),
    runDir: path.join(runtimeRoot, "run"),
    runtimeRoot
  };
}

async function readManagedPostgresAdminPassword({
  serviceDataRoot = ""
} = {}) {
  const adminPasswordFile = managedPostgresServicePaths({
    serviceDataRoot
  }).adminPasswordFile;
  return readManagedServiceSecret(adminPasswordFile, {
    label: "Managed PostgreSQL administrator"
  });
}

function managedPostgresPackageNixRecord() {
  return managedServiceRuntimeNixRecord(MANAGED_POSTGRES_RUNTIME_ID);
}

function managedPostgresServiceMetadata({
  configuredAt = "",
  serviceDataRoot = "",
  status = "configured",
  targetRoot = ""
} = {}) {
  const paths = managedPostgresServicePaths({
    serviceDataRoot
  });
  return {
    configuredAt: normalizeText(configuredAt) || new Date().toISOString(),
    connection: {
      host: RELATIONAL_DATABASE_HOST,
      port: managedPostgresPort({
        serviceDataRoot,
        targetRoot
      }),
      socketDirectory: paths.runDir
    },
    nix: managedPostgresPackageNixRecord(),
    paths: {
      dataDir: paths.dataDir,
      logFile: paths.logFile,
      pidFile: paths.pidFile,
      runDir: paths.runDir
    },
    schema: MANAGED_POSTGRES_SERVICE_SCHEMA,
    schemaVersion: MANAGED_POSTGRES_SERVICE_SCHEMA_VERSION,
    service: {
      catalogEntryId: MANAGED_POSTGRES_RUNTIME_ID,
      id: MANAGED_POSTGRES_PROVIDER_ID,
      label: "PostgreSQL",
      version: "16"
    },
    status: normalizeText(status) || "configured"
  };
}

function managedPostgresServiceStartScript({
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  const paths = managedPostgresServicePaths({
    serviceDataRoot
  });
  if (!paths.runtimeRoot) {
    throw new Error("Managed PostgreSQL requires Vibe64 serviceDataRoot.");
  }
  const port = managedPostgresPort({
    serviceDataRoot,
    targetRoot
  });
  const configuredAt = new Date().toISOString();
  const metadataStartingJson = stableRuntimeJson(managedPostgresServiceMetadata({
    configuredAt,
    serviceDataRoot,
    status: "starting",
    targetRoot
  }));
  const metadataRunningJson = stableRuntimeJson(managedPostgresServiceMetadata({
    configuredAt,
    serviceDataRoot,
    status: "running",
    targetRoot
  }));
  return [
    "set -euo pipefail",
    `runtime_root=${shellQuote(paths.runtimeRoot)}`,
    `postgres_port=${shellQuote(port)}`,
    `metadata_starting_json=${shellQuote(metadataStartingJson)}`,
    `metadata_running_json=${shellQuote(metadataRunningJson)}`,
    "admin_password_file=\"$runtime_root/admin-password\"",
    "data_dir=\"$runtime_root/data\"",
    "run_dir=\"$runtime_root/run\"",
    "log_file=\"$runtime_root/postgres.log\"",
    "metadata_file=\"$runtime_root/metadata.json\"",
    "pid_file=\"$data_dir/postmaster.pid\"",
    "mkdir -p \"$runtime_root\" \"$run_dir\"",
    "chmod 700 \"$runtime_root\" \"$run_dir\"",
    "if [ -d \"$data_dir/base\" ] && [ ! -s \"$admin_password_file\" ]; then",
    "  printf '[studio] Managed PostgreSQL data exists but its administrator secret is missing: %s.\\n' \"$admin_password_file\" >&2",
    "  exit 1",
    "fi",
    "if [ ! -s \"$admin_password_file\" ]; then",
    "  umask 077",
    "  od -An -N32 -tx1 /dev/urandom | tr -d ' \\n' > \"$admin_password_file\"",
    "fi",
    "chmod 600 \"$admin_password_file\"",
    "postgres_password=\"$(cat \"$admin_password_file\")\"",
    ...managedServiceStateWriterShellLines(),
    "postgres_ready() {",
    `  PGPASSWORD="$postgres_password" psql --host=${RELATIONAL_DATABASE_HOST} --port="$postgres_port" --username=${MANAGED_POSTGRES_ADMIN_USER} --dbname=postgres --no-psqlrc --tuples-only --command="SELECT 1" >/dev/null 2>&1`,
    "}",
    "postgres_wait_until_ready() {",
    "  for _attempt in $(seq 1 120); do",
    "    if postgres_ready; then",
    "      return 0",
    "    fi",
    "    sleep 0.25",
    "  done",
    "  return 1",
    "}",
    "write_service_state \"$metadata_starting_json\"",
    "postgres_already_running=false",
    "if [ -s \"$pid_file\" ] && kill -0 \"$(head -n 1 \"$pid_file\")\" 2>/dev/null; then",
    "  if ! postgres_wait_until_ready; then",
    "    printf '[studio] Managed PostgreSQL has a live process, but its administrator secret does not authenticate it. See %s.\\n' \"$log_file\" >&2",
    "    exit 1",
    "  fi",
    "  postgres_already_running=true",
    "fi",
    "if [ \"$postgres_already_running\" = false ]; then",
    "  rm -f \"$pid_file\"",
    "  if [ ! -d \"$data_dir/base\" ]; then",
    `    initdb --pgdata="$data_dir" --username=${MANAGED_POSTGRES_ADMIN_USER} --auth-local=scram-sha-256 --auth-host=scram-sha-256 --pwfile="$admin_password_file" --encoding=UTF8 --no-locale >"$runtime_root/init.log" 2>&1`,
    "    chmod 700 \"$data_dir\"",
    "  fi",
    `  pg_ctl --pgdata="$data_dir" --log="$log_file" --options="-h ${RELATIONAL_DATABASE_HOST} -p $postgres_port -k $run_dir" --wait start`,
    "  if ! postgres_wait_until_ready; then",
    "    printf '[studio] Managed PostgreSQL did not become ready. See %s.\\n' \"$log_file\" >&2",
    "    exit 1",
    "  fi",
    "fi",
    "write_service_state \"$metadata_running_json\"",
    "if [ \"$postgres_already_running\" = true ]; then",
    "  printf '[studio] Managed PostgreSQL is already running on 127.0.0.1:%s.\\n' \"$postgres_port\"",
    "else",
    "  printf '[studio] Managed PostgreSQL is ready on 127.0.0.1:%s.\\n' \"$postgres_port\"",
    "fi"
  ].join("\n");
}

function managedPostgresServiceStartCommandArgs({
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  return runtimeShellCommandArgs(
    [MANAGED_POSTGRES_RUNTIME_ID],
    managedPostgresServiceStartScript({
      serviceDataRoot,
      targetRoot
    }),
    {
      preferSharedRuntimePacks: true
    }
  );
}

function postgresIdentifier(value = "") {
  return String(value || "").replaceAll('"', '""');
}

function postgresLiteral(value = "") {
  return String(value || "").replaceAll("'", "''");
}

function managedPostgresDatabaseGrantSql({
  appPassword = "",
  appUser = "",
  databaseName = ""
} = {}) {
  const database = relationalDatabaseNamePart(databaseName);
  const user = relationalDatabaseNamePart(appUser);
  const password = String(appPassword || "");
  if (!database || database !== normalizeText(databaseName)) {
    throw new Error("Managed PostgreSQL database name is invalid.");
  }
  if (!user || user !== normalizeText(appUser)) {
    throw new Error("Managed PostgreSQL application user is invalid.");
  }
  if (!password) {
    throw new Error("Managed PostgreSQL application password is required.");
  }
  const databaseIdentifier = postgresIdentifier(database);
  const databaseLiteral = postgresLiteral(database);
  const userIdentifier = postgresIdentifier(user);
  const userLiteral = postgresLiteral(user);
  const passwordLiteral = postgresLiteral(password);
  return [
    "DO $vibe64$",
    "BEGIN",
    `  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${userLiteral}') THEN`,
    `    CREATE ROLE "${userIdentifier}" LOGIN PASSWORD '${passwordLiteral}';`,
    "  ELSE",
    `    ALTER ROLE "${userIdentifier}" WITH LOGIN PASSWORD '${passwordLiteral}';`,
    "  END IF;",
    "END",
    "$vibe64$;",
    `SELECT format('CREATE DATABASE %I OWNER %I', '${databaseLiteral}', '${userLiteral}') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${databaseLiteral}') \\gexec`,
    `ALTER DATABASE "${databaseIdentifier}" OWNER TO "${userIdentifier}";`,
    `GRANT ALL PRIVILEGES ON DATABASE "${databaseIdentifier}" TO "${userIdentifier}";`
  ].join("\n");
}

export {
  MANAGED_POSTGRES_ADMIN_USER,
  MANAGED_POSTGRES_PROVIDER_ID,
  MANAGED_POSTGRES_RUNTIME_ID,
  managedPostgresDatabaseGrantSql,
  managedPostgresPort,
  managedPostgresRuntimeRoot,
  managedPostgresServiceMetadata,
  managedPostgresServicePaths,
  managedPostgresServiceStartCommandArgs,
  managedPostgresServiceStartScript,
  readManagedPostgresAdminPassword
};
