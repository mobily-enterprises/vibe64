import {
  JSKIT_MARIADB_APP_USER,
  JSKIT_MARIADB_HOST,
  jskitMariaDbAppPassword,
  jskitMariaDbDatabaseName,
  jskitMariaDbHostPort,
  jskitMariaDbTenantDatabaseGrantPattern,
  jskitManagedMariaDbDevelopmentDatabaseCommandArgs,
  managedMariaDbAccessInstructions,
  validateDatabaseName
} from "./setupMariaDbRuntime.js";
import {
  managedMariaDbServiceStartCommandArgs,
  readManagedMariaDbAdminPassword
} from "../../managedDatabases/mariadbRuntime.js";
import {
  databaseConnectionFromEnv
} from "../../adapterHelpers/setupDatabaseConnections.js";
import {
  checkMariaDbConnectionSetup
} from "../../adapterHelpers/setupMariaDbChecks.js";
import {
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_TARGETS
} from "@local/vibe64-core/server/runtimeConfig";
import {
  createDoctorRepair
} from "@local/vibe64-core/server/doctorCheckItems";

const DATABASE_ENV_KEYS = Object.freeze([
  "DATABASE_URL",
  "DB_CLIENT",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD"
]);
const MATERIALIZE_RUNTIME_CONFIG_ACTION_ID = "terminal-materialize-jskit-runtime-config";

function databaseNameFromTargetRoot(targetRoot = "") {
  return jskitMariaDbDatabaseName(targetRoot);
}

function defaultDatabaseEnv(targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  return {
    DB_CLIENT: "mysql2",
    DB_HOST: JSKIT_MARIADB_HOST,
    DB_NAME: databaseNameFromTargetRoot(targetRoot),
    DB_PASSWORD: jskitMariaDbAppPassword(targetRoot, {
      serviceDataRoot
    }),
    DB_PORT: jskitMariaDbHostPort(targetRoot, {
      serviceDataRoot
    }),
    DB_USER: JSKIT_MARIADB_APP_USER
  };
}

function hasAnyRuntimeDatabaseValues(env = {}) {
  return DATABASE_ENV_KEYS.some((key) => String(env?.[key] || "").trim());
}

function runtimeConfigMaterializeTerminalAction(targetRoot, toolkit, {
  materializeRuntimeConfig = null
} = {}) {
  return toolkit.commandTerminalAction({
    actionId: MATERIALIZE_RUNTIME_CONFIG_ACTION_ID,
    autoRun: true,
    commandPreview: "generate Vibe64 Runtime Config files",
    cwd: targetRoot,
    label: "Generate Runtime Config",
    prepare: async (context = {}) => {
      if (typeof materializeRuntimeConfig !== "function") {
        throw new Error("Vibe64 Runtime Config materialization is not available.");
      }
      const result = await materializeRuntimeConfig({
        targetRoot: context.targetRoot || targetRoot
      });
      if (result?.ok === false) {
        throw new Error(result.errors?.[0]?.message || result.error || "Vibe64 Runtime Config materialization failed.");
      }
    },
    script: () => "printf '[studio] Generated Vibe64 Runtime Config files.\\n'"
  });
}

function runtimeConfigMaterializeRepair(targetRoot, toolkit, {
  materializeRuntimeConfig = null
} = {}) {
  return runtimeConfigMaterializeTerminalAction(targetRoot, toolkit, {
    materializeRuntimeConfig
  }).repair({
    targetRoot
  });
}

function managedMariaDbDatabaseCommandPreview(databaseName = "", targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  const grantPattern = jskitMariaDbTenantDatabaseGrantPattern(targetRoot, {
    serviceDataRoot
  });
  return `start Vibe64 MariaDB on ${JSKIT_MARIADB_HOST}:${jskitMariaDbHostPort(targetRoot, {
    serviceDataRoot
  })} and grant tenant development databases (${grantPattern}, including ${databaseName || "<database>"}) to ${JSKIT_MARIADB_APP_USER}`;
}

function managedMariaDbCreateDatabaseRepair(databaseName = "", targetRoot = "", {
  serviceDataRoot = ""
} = {}) {
  return createDoctorRepair({
    actionId: "terminal-create-app-db",
    autoRun: true,
    command: managedMariaDbDatabaseCommandPreview(databaseName, targetRoot, {
      serviceDataRoot
    }),
    fields: [
      {
        defaultValue: databaseName,
        id: "databaseName",
        label: "Database name",
        required: true,
        type: "text"
      }
    ],
    input: {
      databaseName
    },
    label: "Create app database"
  });
}

function createDatabaseTerminalAction(targetRoot, toolkit, {
  serviceDataRoot = ""
} = {}) {
  return toolkit.hostCommandTerminalAction({
    actionId: "terminal-create-app-db",
    autoRun: true,
    commandArgs: ({ input = {} } = {}) => {
      const validation = validateDatabaseName(input.databaseName);
      return jskitManagedMariaDbDevelopmentDatabaseCommandArgs({
        databaseName: validation.databaseName,
        serviceDataRoot,
        targetRoot
      });
    },
    commandPreview: ({ input = {} } = {}) => {
      const validation = validateDatabaseName(input.databaseName);
      return validation.ok
        ? managedMariaDbDatabaseCommandPreview(validation.databaseName, targetRoot, {
            serviceDataRoot
          })
        : managedMariaDbDatabaseCommandPreview("", targetRoot, {
            serviceDataRoot
          });
    },
    cwd: targetRoot,
    label: "Create app database",
    runtimes: ["mariadb"],
    validate({ input = {} } = {}) {
      const validation = validateDatabaseName(input.databaseName);
      return validation.ok ? null : "A valid databaseName input is required.";
    }
  });
}

function startManagedMariaDbTerminalAction(targetRoot, toolkit, {
  serviceDataRoot = ""
} = {}) {
  return toolkit.hostCommandTerminalAction({
    actionId: "terminal-start-managed-mariadb",
    autoRun: true,
    commandArgs: () => managedMariaDbServiceStartCommandArgs({
      serviceDataRoot,
      targetRoot
    }),
    commandPreview: `start Vibe64 MariaDB on ${JSKIT_MARIADB_HOST}:${jskitMariaDbHostPort(targetRoot, {
      serviceDataRoot
    })}`,
    cwd: targetRoot,
    label: "Start Vibe64 MariaDB",
    runtimes: ["mariadb"]
  });
}

function startManagedMariaDbRepair(targetRoot, toolkit, {
  serviceDataRoot = ""
} = {}) {
  return startManagedMariaDbTerminalAction(targetRoot, toolkit, {
    serviceDataRoot
  }).repair({
    targetRoot
  });
}

async function checkJskitDatabaseRuntime(toolkit, {
    materializeRuntimeConfig = null,
    runtimeConfigEnvironment = null,
    serviceDataRoot = "",
    targetRoot = ""
  } = {}) {
  const runtimeConfigRepair = runtimeConfigMaterializeRepair(targetRoot, toolkit, {
    materializeRuntimeConfig
  });
  if (typeof runtimeConfigEnvironment !== "function") {
    return checkMariaDbConnectionSetup(toolkit, {
      database: {},
      emptyEnv: true,
      emptyEnvCheck: {
        expected: "Vibe64 Runtime Config resolves JSKIT database values.",
        observed: "Runtime Config is not available to project setup.",
        explanation: "Project setup must use Vibe64 Runtime Config, not app .env, as the database source of truth.",
        repair: runtimeConfigRepair
      },
      targetRoot
    });
  }

  let env = {};
  try {
    env = await runtimeConfigEnvironment({
      materialize: false,
      phases: [
        RUNTIME_CONFIG_PHASES.MIGRATE,
        RUNTIME_CONFIG_PHASES.SERVER
      ],
      target: RUNTIME_CONFIG_TARGETS.CHECKS,
      targetRoot
    });
  } catch (error) {
    return checkMariaDbConnectionSetup(toolkit, {
      database: {},
      emptyEnv: true,
      emptyEnvCheck: {
        expected: "Vibe64 Runtime Config resolves required JSKIT database values.",
        observed: error?.message || "Runtime Config could not be resolved.",
        explanation: "Save missing values in Vibe64 Runtime Config, then regenerate the compatibility files.",
        repair: runtimeConfigRepair
      },
      targetRoot
    });
  }

  const database = {
    ...databaseConnectionFromEnv(env),
    envRepair: runtimeConfigRepair,
    rawEnv: env
  };
  let rootPassword = "";
  try {
    rootPassword = await readManagedMariaDbAdminPassword({
      serviceDataRoot
    });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return checkMariaDbConnectionSetup(toolkit, {
    database,
    emptyEnv: !hasAnyRuntimeDatabaseValues(env),
    emptyEnvCheck: {
      expected: "Vibe64 Runtime Config declares the database connection that Vibe64 commands should use.",
      observed: "No database settings were found in Vibe64 Runtime Config.",
      explanation: "JSKIT owns the database env shape. Vibe64 owns the database env values and generated files.",
      repair: runtimeConfigRepair
    },
    hostAlias: `DB_HOST=${JSKIT_MARIADB_HOST}`,
    id: "runtime-services",
    label: "Runtime services",
    managed: {
      accessInstructions: (databaseName) => managedMariaDbAccessInstructions(databaseName, targetRoot, {
        serviceDataRoot
      }),
      createDatabaseRepair: (databaseName) => managedMariaDbCreateDatabaseRepair(databaseName, targetRoot, {
        serviceDataRoot
      }),
      expectedEnv: defaultDatabaseEnv(targetRoot, {
        serviceDataRoot
      }),
      port: jskitMariaDbHostPort(targetRoot, {
        serviceDataRoot
      }),
      rootPassword,
      startRepair: startManagedMariaDbRepair(targetRoot, toolkit, {
        serviceDataRoot
      }),
      unreachableExplanation: "Start the Vibe64-managed MariaDB runtime before project database checks continue."
    },
    managedHost: JSKIT_MARIADB_HOST,
    targetRoot,
    validateDatabaseName
  });
}

export {
  checkJskitDatabaseRuntime,
  createDatabaseTerminalAction,
  databaseNameFromTargetRoot,
  defaultDatabaseEnv,
  runtimeConfigMaterializeRepair,
  runtimeConfigMaterializeTerminalAction,
  startManagedMariaDbTerminalAction
};
