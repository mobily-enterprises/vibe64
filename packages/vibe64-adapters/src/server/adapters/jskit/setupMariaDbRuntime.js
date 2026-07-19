import crypto from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  managedDatabaseNameFromTargetRoot
} from "@local/studio-terminal-core/server/managedDatabases";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  runtimeShellCommandArgs
} from "@local/vibe64-core/server/runtimeToolchain";
import {
  RELATIONAL_DATABASE_HOST,
  relationalDatabaseNamePart,
  relationalDatabasePort
} from "../../managedDatabases/deployment.js";
import {
  MANAGED_MARIADB_RUNTIME_ID,
  managedMariaDbApplicationGrantSql,
  managedMariaDbServicePaths,
  managedMariaDbServiceStartScript
} from "../../managedDatabases/mariadbRuntime.js";
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

const JSKIT_MARIADB_HOST = RELATIONAL_DATABASE_HOST;
const JSKIT_MARIADB_APP_USER = "vibe64_dev_app";
const JSKIT_MARIADB_PROBE_DATABASE = "vibe64_mariadb_probe";
const JSKIT_MARIADB_PROBE_TABLE = "capability_probe";
const JSKIT_MARIADB_PROBE_SQL_VARIABLE = "@vibe64_mariadb_probe_sql";
const JSKIT_MARIADB_PROBE_STATEMENT = "vibe64_mariadb_probe_statement";

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
  const database = normalizeText(appDatabaseName);
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

function normalizeManagedMariaDbServiceDataRoot(serviceDataRoot = "") {
  const root = normalizeText(serviceDataRoot);
  return root ? path.resolve(root) : "";
}

function jskitMariaDbTenantName(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const serviceRoot = normalizeManagedMariaDbServiceDataRoot(serviceDataRoot);
  if (serviceRoot) {
    const serviceRootParent = path.basename(path.dirname(serviceRoot));
    const tenant = relationalDatabaseNamePart(serviceRootParent);
    if (tenant && tenant !== "vibe64") {
      return tenant;
    }
  }
  const root = normalizeText(targetRoot);
  if (!root) {
    return "";
  }
  const parts = path.resolve(root).split(path.sep).filter(Boolean);
  const vibe64Index = parts.lastIndexOf("vibe64");
  if (vibe64Index >= 0 && parts[vibe64Index + 1]) {
    return relationalDatabaseNamePart(parts[vibe64Index + 1]);
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

function jskitMariaDbDevelopmentCredentialSeed(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const serviceRoot = normalizeManagedMariaDbServiceDataRoot(serviceDataRoot);
  if (serviceRoot) {
    return serviceRoot;
  }
  const root = normalizeText(targetRoot);
  return root ? path.resolve(root) : "jskit-managed-mariadb";
}

function jskitMariaDbHostPort(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  if (!normalizeText(targetRoot) && !normalizeText(serviceDataRoot)) {
    return "3306";
  }
  return relationalDatabasePort({
    provider: MANAGED_MARIADB_RUNTIME_ID,
    serviceDataRoot,
    targetRoot
  });
}

function jskitMariaDbAppPassword(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const hash = crypto
    .createHash("sha256")
    .update(`${jskitMariaDbDevelopmentCredentialSeed(targetRoot, {
      serviceDataRoot
    })}:vibe64-dev-app-user`)
    .digest("hex");
  return `v64_${hash.slice(0, 32)}`;
}

function jskitManagedMariaDbDevelopmentDatabaseScript({
  databaseName = "",
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  const database = normalizeText(databaseName || jskitMariaDbDatabaseName(targetRoot));
  const appPassword = jskitMariaDbAppPassword(targetRoot, {
    serviceDataRoot
  });
  const servicePaths = managedMariaDbServicePaths({
    serviceDataRoot
  });
  const grantSql = managedMariaDbApplicationGrantSql({
    appPassword,
    appUser: JSKIT_MARIADB_APP_USER,
    databaseName: database,
    grantPattern: jskitMariaDbTenantDatabaseGrantPattern(targetRoot, {
      serviceDataRoot
    })
  });
  return [
    managedMariaDbServiceStartScript({
      serviceDataRoot,
      targetRoot
    }),
    `development_admin_password_file=${shellQuote(servicePaths.adminPasswordFile)}`,
    `development_mariadb_port=${shellQuote(jskitMariaDbHostPort(targetRoot, {
      serviceDataRoot
    }))}`,
    `development_database=${shellQuote(database)}`,
    `development_app_user=${shellQuote(JSKIT_MARIADB_APP_USER)}`,
    `development_app_password=${shellQuote(appPassword)}`,
    `development_grant_sql=${shellQuote(grantSql)}`,
    "development_admin_password=\"$(cat \"$development_admin_password_file\")\"",
    "MYSQL_PWD=\"$development_admin_password\" mariadb --no-defaults --skip-ssl --protocol=TCP --host=127.0.0.1 --port=\"$development_mariadb_port\" --user=root --execute=\"$development_grant_sql\"",
    "MYSQL_PWD=\"$development_app_password\" mariadb --no-defaults --skip-ssl --protocol=TCP --host=127.0.0.1 --port=\"$development_mariadb_port\" --user=\"$development_app_user\" \"$development_database\" --execute=\"SELECT 1\" >/dev/null",
    "printf '[studio] JSKIT development database %s is ready.\\n' \"$development_database\""
  ].join("\n");
}

function jskitManagedMariaDbDevelopmentDatabaseCommandArgs({
  databaseName = "",
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  return runtimeShellCommandArgs(
    [MANAGED_MARIADB_RUNTIME_ID],
    jskitManagedMariaDbDevelopmentDatabaseScript({
      databaseName,
      serviceDataRoot,
      targetRoot
    }),
    {
      preferSharedRuntimePacks: true
    }
  );
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

function managedMariaDbCmdlineMatchesTarget(cmdline = [], {
  serviceDataRoot = ""
} = {}) {
  const expectedDataDir = managedMariaDbServicePaths({
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
  timeoutMs = 5000
} = {}) {
  const paths = managedMariaDbServicePaths({
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
  if (!managedMariaDbCmdlineMatchesTarget(cmdline, {
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
  const database = normalizeText(databaseName);
  const databaseArg = database ? ` ${database}` : "";
  return `Vibe64 MariaDB: mariadb --skip-ssl --protocol=TCP --host=${JSKIT_MARIADB_HOST} --port=${jskitMariaDbHostPort(targetRoot, {
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
  jskitMariaDbTenantDatabaseGrantPattern,
  jskitMariaDbTenantName,
  jskitMariaDbHostPort,
  jskitManagedMariaDbDevelopmentDatabaseCommandArgs,
  jskitManagedMariaDbDevelopmentDatabaseScript,
  managedMariaDbCmdlineMatchesTarget,
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_APP_USER,
  managedMariaDbAccessInstructions,
  mariaDbCapabilitySql,
  readDatabaseHostFromDotEnv,
  stopJskitManagedMariaDbRuntime,
  targetWantsJskitMariaDb,
  validateDatabaseName
};
