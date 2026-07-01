import {
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_SCOPES
} from "@local/vibe64-core/server/runtimeConfig";
import {
  jskitDevAuthEnvironment
} from "@local/vibe64-core/server/previewAuth";
import {
  VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
  VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE,
  VIBE64_APP_AUTH_PROJECT_ENVIRONMENT_KEY
} from "@local/vibe64-core/shared";

import {
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_ROOT_PASSWORD,
  jskitMariaDbDatabaseName
} from "./setupMariaDbRuntime.js";

const JSKIT_DATABASE_RUNTIME_CONFIG = "jskit_database_runtime";
const JSKIT_LOCAL_APP_PUBLIC_URL = "http://localhost:3000";
const JSKIT_APP_AUTH_RUNTIME_ENV = Object.freeze({
  provider: "AUTH_PROVIDER",
  supabasePublishableKey: "AUTH_SUPABASE_PUBLISHABLE_KEY",
  supabaseUrl: "AUTH_SUPABASE_URL"
});
const JSKIT_RESERVED_USER_ENV_KEYS = Object.freeze([
  "AUTH_PROFILE_MODE",
  "JSKIT_AUTH_ENVIRONMENT",
  "JSKIT_AUTH_MODE",
  "JSKIT_AUTH_PROVIDER",
  "JSKIT_AUTH_SOURCE",
  "JSKIT_AUTH_SUPABASE_PROJECT_REF",
  "JSKIT_AUTH_SUPABASE_PUBLISHABLE_KEY",
  "JSKIT_AUTH_SUPABASE_URL"
]);
const JSKIT_SUPABASE_AUTH_PROVIDER = "supabase";

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

function jskitAppAuthProjectEnvironment(projectEnvironment = {}) {
  const appAuth = projectEnvironment?.[VIBE64_APP_AUTH_PROJECT_ENVIRONMENT_KEY];
  return appAuth && typeof appAuth === "object" && !Array.isArray(appAuth)
    ? appAuth
    : {};
}

function jskitAppAuthOwner(projectEnvironment = {}) {
  const mode = String(jskitAppAuthProjectEnvironment(projectEnvironment).mode || "").trim();
  return mode === VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE
    ? RUNTIME_CONFIG_OWNERS.USER
    : RUNTIME_CONFIG_OWNERS.VIBE64;
}

function jskitAppAuthSource(projectEnvironment = {}) {
  const mode = String(jskitAppAuthProjectEnvironment(projectEnvironment).mode || "").trim();
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
  const appAuth = jskitAppAuthProjectEnvironment(projectEnvironment);
  const owner = jskitAppAuthOwner(projectEnvironment);
  const source = jskitAppAuthSource(projectEnvironment);
  const requiredFor = [
    RUNTIME_CONFIG_PHASES.PREVIEW,
    RUNTIME_CONFIG_PHASES.SERVER
  ];
  const mode = String(appAuth.mode || "").trim();
  const provider = String(appAuth.provider || "").trim();
  const supabase = appAuth.supabase && typeof appAuth.supabase === "object" && !Array.isArray(appAuth.supabase)
    ? appAuth.supabase
    : {};
  const supabaseUrl = String(supabase.url || "").trim();
  const supabasePublishableKey = String(supabase.publishableKey || "").trim();
  if (!mode || !provider) {
    return [];
  }
  const authRecords = [
    {
      key: JSKIT_APP_AUTH_RUNTIME_ENV.provider,
      value: provider
    }
  ];
  if (provider === JSKIT_SUPABASE_AUTH_PROVIDER) {
    authRecords.push(
      {
        key: JSKIT_APP_AUTH_RUNTIME_ENV.supabaseUrl,
        value: supabaseUrl
      },
      {
        key: JSKIT_APP_AUTH_RUNTIME_ENV.supabasePublishableKey,
        value: supabasePublishableKey
      }
    );
  }
  return authRecords.map((record) => ({
    ...runtimeRecord({
      key: record.key,
      owner,
      requiredFor,
      scope,
      source,
      value: record.value
    }),
    editable: false
  }));
}

function jskitDevAuthRuntimeConfigRecords({
  scope = RUNTIME_CONFIG_SCOPES.DEV,
  targetRoot = ""
} = {}) {
  if (scope !== RUNTIME_CONFIG_SCOPES.DEV) {
    return [];
  }
  const requiredFor = [
    RUNTIME_CONFIG_PHASES.PREVIEW,
    RUNTIME_CONFIG_PHASES.SERVER
  ];
  const environment = jskitDevAuthEnvironment({
    targetRoot
  });
  return Object.entries(environment).map(([key, value]) => ({
    ...runtimeRecord({
      key,
      owner: RUNTIME_CONFIG_OWNERS.VIBE64,
      requiredFor,
      scope,
      source: "jskit-dev-auth",
      value
    }),
    editable: false
  }));
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
    publicEnvPrefixes: ["VITE_"],
    userValueReservedKeys: JSKIT_RESERVED_USER_ENV_KEYS,
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
      }),
      ...jskitDevAuthRuntimeConfigRecords({
        scope,
        targetRoot
      })
    ]
  };
}

export {
  JSKIT_APP_AUTH_RUNTIME_ENV,
  JSKIT_DATABASE_RUNTIME_CONFIG,
  JSKIT_LOCAL_APP_PUBLIC_URL,
  createJskitRuntimeConfigProfile,
  jskitAppAuthRuntimeConfigRecords,
  jskitDevAuthRuntimeConfigRecords,
  jskitManagedDatabaseRuntimeConfigRecords
};
