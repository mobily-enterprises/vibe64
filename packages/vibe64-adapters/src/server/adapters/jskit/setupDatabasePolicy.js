import {
  createManagedDatabaseDockerArgs,
  createManagedDatabaseRepair,
  JSKIT_HOST_DATABASE_HOST,
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_ROOT_PASSWORD,
  jskitMariaDbContainerName,
  managedMariaDbAccessInstructions,
  validateDatabaseName
} from "./setupMariaDbRuntime.js";
import {
  databaseConnectionFromEnv
} from "../../adapterHelpers/setupDatabaseConnections.js";
import {
  checkMariaDbConnectionSetup
} from "../../adapterHelpers/setupMariaDbChecks.js";
import {
  RUNTIME_CONFIG_PHASES
} from "@local/vibe64-core/server/runtimeConfig";
import {
  repoNameFromTargetRoot
} from "./setupScaffold.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

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
  return repoNameFromTargetRoot(targetRoot)
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "") || "jskit_app";
}

function defaultDatabaseEnv(targetRoot = "") {
  return {
    DB_CLIENT: "mysql2",
    DB_HOST: JSKIT_MARIADB_HOST,
    DB_NAME: databaseNameFromTargetRoot(targetRoot),
    DB_PASSWORD: JSKIT_MARIADB_ROOT_PASSWORD,
    DB_PORT: "3306",
    DB_USER: "root"
  };
}

function hasAnyRuntimeDatabaseValues(env = {}) {
  return DATABASE_ENV_KEYS.some((key) => String(env?.[key] || "").trim());
}

function runtimeConfigMaterializeTerminalAction(targetRoot, toolkit, {
  materializeRuntimeConfig = null
} = {}) {
  return toolkit.shellTerminalAction({
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

function createDatabaseTerminalAction(targetRoot, toolkit) {
  return toolkit.dockerTerminalAction({
    actionId: "terminal-create-app-db",
    autoRun: true,
    args: ({ input = {} } = {}) => {
      const validation = validateDatabaseName(input.databaseName);
      return createManagedDatabaseDockerArgs(validation.databaseName, targetRoot);
    },
    commandPreview: ({ input = {} } = {}) => {
      const validation = validateDatabaseName(input.databaseName);
      return validation.ok
        ? createManagedDatabaseRepair(validation.databaseName, targetRoot).commandPreview
        : "docker exec <mariadb-container> mariadb -e <create database>";
    },
    cwd: targetRoot,
    label: "Create app database",
    validate({ input = {} } = {}) {
      const validation = validateDatabaseName(input.databaseName);
      return validation.ok ? null : "A valid databaseName input is required.";
    }
  });
}

async function checkJskitDatabaseRuntime(toolkit, {
  materializeRuntimeConfig = null,
  runtimeConfigEnvironment = null,
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
  return checkMariaDbConnectionSetup(toolkit, {
    database,
    emptyEnv: !hasAnyRuntimeDatabaseValues(env),
    emptyEnvCheck: {
      expected: "Vibe64 Runtime Config declares the database connection that Studio containers should use.",
      observed: "No database settings were found in Vibe64 Runtime Config.",
      explanation: "JSKIT owns the database env shape. Vibe64 owns the database env values and generated files.",
      repair: runtimeConfigRepair
    },
    hostAlias: `DB_HOST=${JSKIT_HOST_DATABASE_HOST}`,
    id: "runtime-services",
    label: "Runtime services",
    managed: {
      accessInstructions: managedMariaDbAccessInstructions,
      containerName: jskitMariaDbContainerName(targetRoot),
      createDatabaseRepair: createManagedDatabaseRepair,
      expectedEnv: defaultDatabaseEnv(targetRoot),
      rootPassword: JSKIT_MARIADB_ROOT_PASSWORD,
      startRepair: null,
      unreachableExplanation: "Run Studio Setup to start the shared JSKIT MariaDB runtime before project database checks continue."
    },
    managedHost: JSKIT_MARIADB_HOST,
    targetRoot,
    toolchainImage: JSKIT_TOOLCHAIN_IMAGE,
    validateDatabaseName
  });
}

export {
  checkJskitDatabaseRuntime,
  createDatabaseTerminalAction,
  databaseNameFromTargetRoot,
  defaultDatabaseEnv,
  runtimeConfigMaterializeRepair,
  runtimeConfigMaterializeTerminalAction
};
