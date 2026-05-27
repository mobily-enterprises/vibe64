import {
  blockedDoctorCheck as blockedCheck,
  createDoctorRepair,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  dockerCommand
} from "@local/studio-terminal-core/server/shellCommands";
import {
  formatDatabaseEndpoint,
  loopbackDatabaseHost
} from "./setupDatabaseConnections.js";
import {
  expectedEnvMismatches,
  formatEnvMismatches
} from "./setupEnvFiles.js";

function defaultValidateDatabaseName(value = "") {
  const databaseName = String(value || "").trim();
  return {
    databaseName,
    ok: /^[A-Za-z0-9_]+$/u.test(databaseName)
  };
}

function escapeMariaDbIdentifier(value = "") {
  return String(value).replaceAll("`", "``");
}

function escapeMariaDbString(value = "") {
  return String(value).replaceAll("\\", "\\\\").replaceAll("'", "''");
}

function mariaDbCreateDatabaseDockerArgs({
  containerName = "",
  databaseName = "",
  rootPassword = ""
} = {}) {
  const escaped = escapeMariaDbIdentifier(databaseName);
  const escapedLiteral = escapeMariaDbString(databaseName);
  return [
    "exec",
    "-it",
    containerName,
    "mariadb",
    "-uroot",
    `-p${rootPassword}`,
    "-e",
    `CREATE DATABASE IF NOT EXISTS \`${escaped}\`; SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${escapedLiteral}';`
  ];
}

function mariaDbCreateDatabaseRepair({
  actionId = "terminal-create-app-db",
  containerName = "",
  databaseName = "",
  label = "Create app database",
  rootPassword = ""
} = {}) {
  return createDoctorRepair({
    actionId,
    autoRun: true,
    command: dockerCommand(mariaDbCreateDatabaseDockerArgs({
      containerName,
      databaseName,
      rootPassword
    })),
    fields: [
      {
        defaultValue: databaseName,
        id: "databaseName",
        label: "Database name",
        required: true,
        type: "text"
      }
    ],
    label
  });
}

async function checkManagedMariaDbDatabase(toolkit, {
  accessInstructions = () => "",
  containerName = "",
  createDatabaseRepair = null,
  database = {},
  expectedEnv = {},
  id = "runtime-services",
  label = "Runtime services",
  rootPassword = "",
  startRepair = null,
  targetRoot = "",
  validateDatabaseName = defaultValidateDatabaseName
} = {}) {
  const envMismatches = expectedEnvMismatches(database.rawEnv || {}, expectedEnv, {
    secretKeys: new Set(["DB_PASSWORD"])
  });
  if (envMismatches.length) {
    return hardStopCheck({
      id,
      label,
      expected: `When DB_HOST=${database.host}, all database env values match the Studio-managed defaults.`,
      observed: formatEnvMismatches(envMismatches),
      explanation: "The managed database container is intentionally local development infrastructure. Keep the managed database values together in the env file when the target uses the managed database.",
      repair: database.envRepair || null
    });
  }

  const ping = await toolkit.runDocker([
    "exec",
    containerName,
    "mariadb-admin",
    "ping",
    "-uroot",
    `-p${rootPassword}`,
    "--silent"
  ], {
    timeout: 12_000
  });

  if (!ping.ok) {
    return blockedCheck({
      id,
      label,
      expected: "Studio-managed MariaDB is reachable.",
      observed: ping.output,
      explanation: "Start the managed MariaDB runtime before database apps can proceed.",
      repair: startRepair
    });
  }

  const validation = validateDatabaseName(database.databaseName);
  const schema = await toolkit.runDocker([
    "exec",
    containerName,
    "mariadb",
    "-uroot",
    `-p${rootPassword}`,
    "-N",
    "-B",
    "-e",
    `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${validation.databaseName}';`
  ], {
    timeout: 15_000
  });

  if (!schema.ok || !schema.stdout.split(/\s+/u).includes(validation.databaseName)) {
    return blockedCheck({
      id,
      label,
      expected: `${validation.databaseName} exists in Studio-managed MariaDB.`,
      observed: schema.output || "Database not found.",
      explanation: "Create the app database before Studio starts workflow sessions for this target.",
      repair: createDatabaseRepair?.(validation.databaseName, targetRoot)
    });
  }

  if (database.user) {
    const appLogin = await toolkit.runDocker([
      "exec",
      containerName,
      "mariadb",
      `-u${database.user}`,
      database.password ? `-p${database.password}` : "",
      validation.databaseName,
      "-e",
      "SELECT 1;"
    ].filter(Boolean), {
      timeout: 15_000
    });

    if (!appLogin.ok) {
      return hardStopCheck({
        id,
        label,
        expected: "Configured database user can connect to the app database.",
        observed: appLogin.output,
        explanation: "Fix database credentials or grants manually before Studio continues."
      });
    }
  }

  return passCheck({
    id,
    label,
    expected: "Required runtime services are reachable.",
    observed: [
      database.user
        ? `${validation.databaseName} exists and ${database.user} can connect.`
        : `${validation.databaseName} exists in Studio-managed MariaDB.`,
      accessInstructions(validation.databaseName, targetRoot)
    ].filter(Boolean).join("\n"),
    explanation: "The target project's database dependency has a reachable database."
  });
}

async function checkExternalMariaDbDatabase(toolkit, {
  database = {},
  dockerArgs = () => [],
  id = "runtime-services",
  label = "Runtime services",
  targetRoot = "",
  toolchainImage = ""
} = {}) {
  const result = await toolkit.toolchainCommandResult({
    commandArgs: [
      "mariadb",
      "--protocol=TCP",
      "-h",
      database.host,
      "-P",
      database.port || "3306",
      ...(database.user ? [`-u${database.user}`] : []),
      ...(database.password ? [`-p${database.password}`] : []),
      database.databaseName,
      "-e",
      "SELECT 1;"
    ],
    extraArgs: dockerArgs(database.host, targetRoot),
    image: toolchainImage,
    targetRoot,
    timeout: 15_000
  });

  if (!result.ok) {
    return hardStopCheck({
      id,
      label,
      expected: `${formatDatabaseEndpoint(database)} is reachable from Studio command containers using env credentials.`,
      observed: result.output,
      explanation: "Fix the env file or the database grants. Use the adapter-declared host alias when the database is running on the host machine."
    });
  }

  return passCheck({
    id,
    label,
    expected: "Required runtime services are reachable.",
    observed: `${database.databaseName} is reachable at ${formatDatabaseEndpoint(database)}${database.user ? ` as ${database.user}` : ""}.`,
    explanation: "The target project's database dependency has a reachable database."
  });
}

async function checkMariaDbConnectionSetup(toolkit, {
  database = {},
  emptyEnv = false,
  emptyEnvCheck = {},
  hostAlias = "",
  id = "runtime-services",
  label = "Runtime services",
  managed = {},
  managedHost = "",
  targetRoot = "",
  toolchainImage = "",
  validateDatabaseName = defaultValidateDatabaseName
} = {}) {
  if (emptyEnv) {
    return blockedCheck({
      id,
      label,
      ...emptyEnvCheck
    });
  }

  const validation = validateDatabaseName(database.databaseName);
  if (!validation.ok) {
    return hardStopCheck({
      id,
      label,
      expected: "Database apps declare a valid database name in the env file.",
      observed: database.databaseName || "No database name found in the env file.",
      explanation: "Studio cannot create or verify an app database without an explicit database name."
    });
  }

  if (!database.host) {
    return hardStopCheck({
      id,
      label,
      expected: "The env file declares a database host.",
      observed: "No database host found in the env file.",
      explanation: "Studio runs target commands in containers, so the adapter needs an explicit database host that those containers can resolve."
    });
  }

  if (loopbackDatabaseHost(database.host)) {
    return hardStopCheck({
      id,
      label,
      expected: "The env database host is reachable from Studio command containers.",
      observed: `${database.host} resolves inside each container, not to the host machine.`,
      explanation: `Use ${hostAlias} for a host-machine database, ${managedHost} for Studio-managed MariaDB, or a real network hostname for an external database.`
    });
  }

  if (database.host === managedHost) {
    return checkManagedMariaDbDatabase(toolkit, {
      ...managed,
      database,
      id,
      label,
      targetRoot,
      validateDatabaseName
    });
  }

  return checkExternalMariaDbDatabase(toolkit, {
    database,
    dockerArgs: managed.externalDockerArgs,
    id,
    label,
    targetRoot,
    toolchainImage
  });
}

export {
  defaultValidateDatabaseName,
  mariaDbCreateDatabaseDockerArgs,
  mariaDbCreateDatabaseRepair,
  checkExternalMariaDbDatabase,
  checkManagedMariaDbDatabase,
  checkMariaDbConnectionSetup
};
