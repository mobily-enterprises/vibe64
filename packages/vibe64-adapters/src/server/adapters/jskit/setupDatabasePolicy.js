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
  envFileWriteScript,
  envHasAnyKeys,
  readTargetEnvFile
} from "../../adapterHelpers/setupEnvFiles.js";
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

function databaseEnvWriteScript(targetRoot, {
  replaceExisting = false
} = {}) {
  const existingValuesError = ".env already contains database settings; edit it manually instead of seeding defaults.";
  return [
    envFileWriteScript({
      existingValuesError: replaceExisting ? "" : existingValuesError,
      header: "# Vibe64 managed MariaDB defaults",
      relativePath: ".env",
      replaceExisting,
      values: defaultDatabaseEnv(targetRoot)
    }),
    "echo 'Wrote .env database settings for Studio-managed MariaDB.'"
  ].join("\n");
}

function seedDatabaseEnvTerminalAction(targetRoot, toolkit) {
  return toolkit.shellTerminalAction({
    actionId: "terminal-seed-jskit-db-env",
    autoRun: true,
    commandPreview: "seed JSKIT database .env defaults",
    cwd: targetRoot,
    label: "Seed database .env",
    script: () => databaseEnvWriteScript(targetRoot)
  });
}

function seedDatabaseEnvRepair(targetRoot, toolkit) {
  return seedDatabaseEnvTerminalAction(targetRoot, toolkit).repair({
    targetRoot
  });
}

function managedDatabaseEnvTerminalAction(targetRoot, toolkit) {
  return toolkit.shellTerminalAction({
    actionId: "terminal-use-managed-jskit-db-env",
    autoRun: true,
    commandPreview: "write Studio-managed MariaDB .env defaults",
    cwd: targetRoot,
    label: "Use Studio-managed MariaDB .env",
    script: () => databaseEnvWriteScript(targetRoot, {
      replaceExisting: true
    })
  });
}

function managedDatabaseEnvRepair(targetRoot, toolkit) {
  return managedDatabaseEnvTerminalAction(targetRoot, toolkit).repair({
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
  targetRoot = ""
} = {}) {
  const env = await readTargetEnvFile(toolkit, {
    relativePath: ".env",
    targetRoot
  });
  const database = {
    ...databaseConnectionFromEnv(env),
    envRepair: managedDatabaseEnvRepair(targetRoot, toolkit),
    rawEnv: env
  };
  const seedRepair = seedDatabaseEnvRepair(targetRoot, toolkit);
  return checkMariaDbConnectionSetup(toolkit, {
    database,
    emptyEnv: !envHasAnyKeys(env, DATABASE_ENV_KEYS),
    emptyEnvCheck: {
      expected: ".env declares the database connection that Studio containers should use.",
      observed: "No database settings were found in .env.",
      explanation: "The JSKIT adapter uses .env as the database source of truth. Seed defaults to use Studio-managed MariaDB, or create .env manually for an existing database.",
      repair: seedRepair
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
  databaseEnvWriteScript,
  databaseNameFromTargetRoot,
  defaultDatabaseEnv,
  managedDatabaseEnvRepair,
  managedDatabaseEnvTerminalAction,
  seedDatabaseEnvRepair,
  seedDatabaseEnvTerminalAction
};
