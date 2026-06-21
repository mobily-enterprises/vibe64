import {
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_SCOPES
} from "@local/vibe64-core/server/runtimeConfig";
import {
  VIBE64_APP_AUTH_ENV,
  VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
  VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE
} from "@local/vibe64-core/shared";

import {
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_ROOT_PASSWORD,
  jskitMariaDbDatabaseName
} from "./setupMariaDbRuntime.js";

const JSKIT_DATABASE_RUNTIME_CONFIG = "jskit_database_runtime";
const JSKIT_LOCAL_APP_PUBLIC_URL = "http://localhost:3000";

function configValue(config = {}, key = "", fallback = "") {
  return String(config?.values?.[key] ?? fallback).trim();
}

function jskitDatabaseRuntime(projectConfig = {}) {
  return configValue(projectConfig, JSKIT_DATABASE_RUNTIME_CONFIG, "mysql") || "mysql";
}

function runtimeRecord({
  key = "",
  owner = RUNTIME_CONFIG_OWNERS.VIBE64,
  requiredFor = [],
  scope = RUNTIME_CONFIG_SCOPES.DEV,
  source = "",
  value = ""
} = {}) {
  return {
    key,
    owner,
    requiredFor,
    scope,
    source,
    value
  };
}

function jskitManagedDatabaseRuntimeConfigRecords({
  projectConfig = {},
  scope = RUNTIME_CONFIG_SCOPES.DEV,
  targetRoot = ""
} = {}) {
  if (jskitDatabaseRuntime(projectConfig) !== "mysql") {
    return [];
  }
  const requiredFor = [
    RUNTIME_CONFIG_PHASES.MIGRATE,
    RUNTIME_CONFIG_PHASES.PREVIEW,
    RUNTIME_CONFIG_PHASES.SEED,
    RUNTIME_CONFIG_PHASES.SERVER
  ];
  const source = "jskit-managed-mariadb";
  return [
    runtimeRecord({
      key: "DB_CLIENT",
      requiredFor,
      scope,
      source,
      value: "mysql2"
    }),
    runtimeRecord({
      key: "DB_HOST",
      requiredFor,
      scope,
      source,
      value: JSKIT_MARIADB_HOST
    }),
    runtimeRecord({
      key: "DB_NAME",
      requiredFor,
      scope,
      source,
      value: jskitMariaDbDatabaseName(targetRoot)
    }),
    runtimeRecord({
      key: "DB_PASSWORD",
      requiredFor,
      scope,
      source,
      value: JSKIT_MARIADB_ROOT_PASSWORD
    }),
    runtimeRecord({
      key: "DB_PORT",
      requiredFor,
      scope,
      source,
      value: "3306"
    }),
    runtimeRecord({
      key: "DB_USER",
      requiredFor,
      scope,
      source,
      value: "root"
    })
  ];
}

function jskitAppPublicUrlRuntimeConfigRecord({
  scope = RUNTIME_CONFIG_SCOPES.DEV
} = {}) {
  return runtimeRecord({
    key: "APP_PUBLIC_URL",
    requiredFor: [
      RUNTIME_CONFIG_PHASES.PREVIEW,
      RUNTIME_CONFIG_PHASES.SERVER
    ],
    scope,
    source: "jskit-local-default",
    value: JSKIT_LOCAL_APP_PUBLIC_URL
  });
}

function jskitAppAuthOwner(projectEnvironment = {}) {
  const mode = String(projectEnvironment?.[VIBE64_APP_AUTH_ENV.mode] || "").trim();
  return mode === VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE
    ? RUNTIME_CONFIG_OWNERS.USER
    : RUNTIME_CONFIG_OWNERS.VIBE64;
}

function jskitAppAuthSource(projectEnvironment = {}) {
  const mode = String(projectEnvironment?.[VIBE64_APP_AUTH_ENV.mode] || "").trim();
  if (mode === VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE) {
    return "managed-app-auth";
  }
  if (mode === VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE) {
    return "project-config";
  }
  return "app-auth";
}

function jskitAppAuthRuntimeConfigRecords({
  projectEnvironment = {},
  scope = RUNTIME_CONFIG_SCOPES.DEV
} = {}) {
  const owner = jskitAppAuthOwner(projectEnvironment);
  const source = jskitAppAuthSource(projectEnvironment);
  const requiredFor = [
    RUNTIME_CONFIG_PHASES.PREVIEW,
    RUNTIME_CONFIG_PHASES.SERVER
  ];
  return Object.values(VIBE64_APP_AUTH_ENV)
    .map((key) => {
      const value = String(projectEnvironment?.[key] ?? "");
      if (!value) {
        return null;
      }
      return {
        ...runtimeRecord({
          key,
          owner,
          requiredFor,
          scope,
          source,
          value
        }),
        editable: false
      };
    })
    .filter(Boolean);
}

function createJskitRuntimeConfigProfile() {
  return {
    id: "jskit",
    materializers: [
      {
        format: "dotenv",
        path: ".env"
      }
    ],
    definitions: async ({
      projectConfig = {},
      projectEnvironment = {},
      scope = RUNTIME_CONFIG_SCOPES.DEV,
      targetRoot = ""
    } = {}) => [
      ...jskitManagedDatabaseRuntimeConfigRecords({
        projectConfig,
        scope,
        targetRoot
      }),
      jskitAppPublicUrlRuntimeConfigRecord({
        scope
      }),
      ...jskitAppAuthRuntimeConfigRecords({
        projectEnvironment,
        scope
      })
    ]
  };
}

export {
  JSKIT_DATABASE_RUNTIME_CONFIG,
  JSKIT_LOCAL_APP_PUBLIC_URL,
  createJskitRuntimeConfigProfile,
  jskitAppAuthRuntimeConfigRecords,
  jskitManagedDatabaseRuntimeConfigRecords
};
