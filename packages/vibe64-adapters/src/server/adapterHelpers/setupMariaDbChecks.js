import {
  blockedDoctorCheck as blockedCheck,
  createDoctorRepair,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  VIBE64_NIX_COMMAND,
  nixShellArgs
} from "@local/vibe64-core/server/runtimeToolchain";
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

function mariaDbHostClientScript({
  selectDatabase = true
} = {}) {
  return [
    "set -e",
    "if command -v mariadb >/dev/null 2>&1; then db_client=mariadb; elif command -v mysql >/dev/null 2>&1; then db_client=mysql; else echo 'Neither mariadb nor mysql was found on this host.' >&2; exit 127; fi",
    "db_args=(--no-defaults --protocol=TCP -h \"$VIBE64_DB_HOST\" -P \"$VIBE64_DB_PORT\")",
    "[ -n \"$VIBE64_DB_USER\" ] && db_args+=(\"-u$VIBE64_DB_USER\")",
    "[ -n \"$VIBE64_DB_PASSWORD\" ] && db_args+=(\"-p$VIBE64_DB_PASSWORD\")",
    ...(selectDatabase ? [
      "db_args+=(\"$VIBE64_DB_NAME\")"
    ] : []),
    "exec \"$db_client\" \"${db_args[@]}\" -N -B -e \"$VIBE64_DB_SQL\""
  ].join("\n");
}

function mariaDbCreateDatabaseSql(databaseName = "") {
  const escaped = escapeMariaDbIdentifier(databaseName);
  const escapedLiteral = escapeMariaDbString(databaseName);
  return `CREATE DATABASE IF NOT EXISTS \`${escaped}\`; SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${escapedLiteral}';`;
}

function mariaDbCreateDatabaseHostCommandArgs({
  host = "",
  port = "3306",
  password = "",
  user = ""
} = {}) {
  void host;
  void port;
  void password;
  void user;
  return [
    VIBE64_NIX_COMMAND,
    ...nixShellArgs(["mysql-8.0"], [
      "bash",
      "-lc",
      mariaDbHostClientScript({
        selectDatabase: false
      })
    ])
  ];
}

function mariaDbCreateDatabaseHostCommandEnv({
  host = "",
  port = "3306",
  databaseName = "",
  password = "",
  user = ""
} = {}) {
  return {
    VIBE64_DB_HOST: host,
    VIBE64_DB_NAME: databaseName,
    VIBE64_DB_PASSWORD: password,
    VIBE64_DB_PORT: port,
    VIBE64_DB_SQL: mariaDbCreateDatabaseSql(databaseName),
    VIBE64_DB_USER: user
  };
}

function mariaDbCreateDatabaseRepair({
  actionId = "terminal-create-app-db",
  databaseName = "",
  label = "Create app database",
  host = "",
  password = "",
  port = "3306",
  user = ""
} = {}) {
  void host;
  void password;
  void port;
  void user;
  return createDoctorRepair({
    actionId,
    autoRun: true,
    command: `mariadb --host=${host || "<host>"} --port=${port || "<port>"} --execute="${mariaDbCreateDatabaseSql(databaseName)}"`,
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

function runMariaDbHostClient(toolkit, {
  database = {},
  password = "",
  selectDatabase = true,
  sql = "",
  user = ""
} = {}, {
  timeout = 15_000
} = {}) {
  return toolkit.hostCommandResult({
    commandArgs: [
      VIBE64_NIX_COMMAND,
      ...nixShellArgs(["mysql-8.0"], [
        "bash",
        "-lc",
        mariaDbHostClientScript({
          selectDatabase
        })
      ])
    ],
    env: {
      VIBE64_DB_HOST: database.host,
      VIBE64_DB_NAME: database.databaseName,
      VIBE64_DB_PASSWORD: password || database.password || "",
      VIBE64_DB_PORT: database.port || "3306",
      VIBE64_DB_SQL: sql,
      VIBE64_DB_USER: user || database.user || ""
    },
    targetRoot: database.targetRoot || "",
    timeout
  });
}

async function checkManagedMariaDbDatabase(toolkit, {
  accessInstructions = () => "",
  createDatabaseRepair = null,
  database = {},
  expectedEnv = {},
  id = "runtime-services",
  label = "Runtime services",
  rootPassword = "",
  startRepair = null,
  targetRoot = "",
  unreachableExplanation = "Start the managed MariaDB runtime before database apps can proceed.",
  validateDatabaseName = defaultValidateDatabaseName
} = {}) {
  const envMismatches = expectedEnvMismatches(database.rawEnv || {}, expectedEnv, {
    secretKeys: new Set(["DB_PASSWORD"])
  });
  if (envMismatches.length) {
    return hardStopCheck({
      id,
      label,
      expected: `When DB_HOST=${database.host}, all database env values match the Vibe64-managed host database defaults.`,
      observed: formatEnvMismatches(envMismatches),
      explanation: "The managed database endpoint is host-local development infrastructure. Keep the managed database values together in the env file when the target uses that endpoint.",
      repair: database.envRepair || null
    });
  }

  const adminUser = rootPassword ? "root" : database.user || "root";
  const adminPassword = rootPassword || database.password || "";
  const ping = await runMariaDbHostClient(toolkit, {
    database,
    password: adminPassword,
    selectDatabase: false,
    sql: "SELECT 1;",
    user: adminUser
  }, {
    timeout: 12_000
  });

  if (!ping.ok) {
    return blockedCheck({
      id,
      label,
      expected: "Host MariaDB is reachable.",
      observed: ping.output,
      explanation: unreachableExplanation,
      repair: startRepair
    });
  }

  const validation = validateDatabaseName(database.databaseName);
  const schema = await runMariaDbHostClient(toolkit, {
    database,
    password: adminPassword,
    selectDatabase: false,
    sql: `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${escapeMariaDbString(validation.databaseName)}';`,
    user: adminUser
  }, {
    timeout: 15_000
  });

  if (!schema.ok || !schema.stdout.split(/\s+/u).includes(validation.databaseName)) {
    return blockedCheck({
      id,
      label,
      expected: `${validation.databaseName} exists in host MariaDB.`,
      observed: schema.output || "Database not found.",
      explanation: "Create the app database before Studio starts workflow sessions for this target.",
      repair: createDatabaseRepair?.(validation.databaseName, targetRoot)
    });
  }

  if (database.user) {
    const appLogin = await runMariaDbHostClient(toolkit, {
      database,
      selectDatabase: true,
      sql: "SELECT 1;"
    }, {
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
        : `${validation.databaseName} exists in host MariaDB.`,
      accessInstructions(validation.databaseName, targetRoot)
    ].filter(Boolean).join("\n"),
    explanation: "The target project's database dependency has a reachable database."
  });
}

async function checkExternalMariaDbDatabase(toolkit, {
  database = {},
  id = "runtime-services",
  label = "Runtime services",
  targetRoot = ""
} = {}) {
  const result = await runMariaDbHostClient(toolkit, {
    database: {
      ...database,
      targetRoot
    },
    selectDatabase: true,
    sql: "SELECT 1;"
  }, {
    timeout: 15_000
  });

  if (!result.ok) {
    return hardStopCheck({
      id,
      label,
      expected: `${formatDatabaseEndpoint(database)} is reachable from Vibe64 host commands using env credentials.`,
      observed: result.output,
      explanation: "Fix the env file, database grants, or host client installation."
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
      explanation: "Vibe64 runs target commands on the host, so the adapter needs an explicit database host that the host can resolve."
    });
  }

  if (loopbackDatabaseHost(database.host) && managedHost && database.host !== managedHost) {
    return hardStopCheck({
      id,
      label,
      expected: "The env database host is reachable from Vibe64 host commands.",
      observed: `${database.host} is a loopback address that is not the managed service endpoint for this target.`,
      explanation: `Use ${managedHost} with the managed service port, ${hostAlias} for an explicitly configured host database, or a real network hostname for an external database.`
    });
  }

  if (
    database.host === managedHost &&
    (!managed.port || String(database.port || "3306") === String(managed.port))
  ) {
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
    id,
    label,
    targetRoot
  });
}

export {
  defaultValidateDatabaseName,
  mariaDbCreateDatabaseHostCommandEnv,
  mariaDbCreateDatabaseHostCommandArgs,
  mariaDbCreateDatabaseRepair,
  checkExternalMariaDbDatabase,
  checkManagedMariaDbDatabase,
  checkMariaDbConnectionSetup
};
