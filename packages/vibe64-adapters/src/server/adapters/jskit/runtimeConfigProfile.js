import {
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_SCOPES,
  RUNTIME_CONFIG_TARGETS
} from "@local/vibe64-core/server/runtimeConfig";
import {
  jskitDevAuthEnvironment
} from "@local/vibe64-core/server/previewAuth";
import {
  JSKIT_APP_AUTH_PROJECT_ENVIRONMENT_KEY,
  JSKIT_AUTH_PROVIDER_LOCAL,
  JSKIT_AUTH_PROVIDER_SUPABASE,
  JSKIT_SUPABASE_SOURCE_MANAGED,
  JSKIT_SUPABASE_SOURCE_MANUAL
} from "./appAuthConfig.js";

import {
  JSKIT_MARIADB_APP_USER,
  JSKIT_MARIADB_HOST,
  jskitMariaDbAppPassword,
  jskitMariaDbDatabaseName,
  jskitMariaDbHostPort
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
const JSKIT_APP_RUNTIME_CONFIG_TARGETS = Object.freeze([
  RUNTIME_CONFIG_TARGETS.CHECKS,
  RUNTIME_CONFIG_TARGETS.COMMAND,
  RUNTIME_CONFIG_TARGETS.ENV_FILE,
  RUNTIME_CONFIG_TARGETS.LAUNCH_TARGET,
  RUNTIME_CONFIG_TARGETS.SERVER
]);
const JSKIT_DEV_AUTH_RUNTIME_CONFIG_TARGETS = Object.freeze([
  RUNTIME_CONFIG_TARGETS.CHECKS,
  RUNTIME_CONFIG_TARGETS.COMMAND,
  RUNTIME_CONFIG_TARGETS.ENV_FILE,
  RUNTIME_CONFIG_TARGETS.SERVER
]);

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
  targets = JSKIT_APP_RUNTIME_CONFIG_TARGETS,
  value = ""
} = {}) {
  return {
    key,
    owner,
    requiredFor,
    scope,
    source,
    targets,
    value
  };
}

function jskitManagedDatabaseRuntimeConfigRecords({
  projectConfig = {},
  scope = RUNTIME_CONFIG_SCOPES.DEV,
  serviceDataRoot = "",
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
      value: jskitMariaDbAppPassword(targetRoot, {
        serviceDataRoot
      })
    }),
    runtimeRecord({
      key: "DB_PORT",
      requiredFor,
      scope,
      source,
      value: jskitMariaDbHostPort(targetRoot, {
        serviceDataRoot
      })
    }),
    runtimeRecord({
      key: "DB_USER",
      requiredFor,
      scope,
      source,
      value: JSKIT_MARIADB_APP_USER
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
  const appAuth = projectEnvironment?.[JSKIT_APP_AUTH_PROJECT_ENVIRONMENT_KEY];
  return appAuth && typeof appAuth === "object" && !Array.isArray(appAuth)
    ? appAuth
    : {};
}

function jskitAppAuthOwner(projectEnvironment = {}) {
  const appAuth = jskitAppAuthProjectEnvironment(projectEnvironment);
  return appAuth.provider === JSKIT_AUTH_PROVIDER_SUPABASE && appAuth.supabaseSource === JSKIT_SUPABASE_SOURCE_MANUAL
    ? RUNTIME_CONFIG_OWNERS.USER
    : RUNTIME_CONFIG_OWNERS.VIBE64;
}

function jskitAppAuthSource(projectEnvironment = {}) {
  const appAuth = jskitAppAuthProjectEnvironment(projectEnvironment);
  if (appAuth.provider === JSKIT_AUTH_PROVIDER_LOCAL) {
    return "jskit-local-auth";
  }
  if (appAuth.provider === JSKIT_AUTH_PROVIDER_SUPABASE && appAuth.supabaseSource === JSKIT_SUPABASE_SOURCE_MANAGED) {
    return "jskit-managed-supabase";
  }
  if (appAuth.provider === JSKIT_AUTH_PROVIDER_SUPABASE && appAuth.supabaseSource === JSKIT_SUPABASE_SOURCE_MANUAL) {
    return "jskit-manual-supabase";
  }
  return "jskit-auth";
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
  const provider = String(appAuth.provider || "").trim();
  const supabase = appAuth.supabase && typeof appAuth.supabase === "object" && !Array.isArray(appAuth.supabase)
    ? appAuth.supabase
    : {};
  const supabaseUrl = String(supabase.url || "").trim();
  const supabasePublishableKey = String(supabase.publishableKey || "").trim();
  if (!provider) {
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
      targets: JSKIT_DEV_AUTH_RUNTIME_CONFIG_TARGETS,
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
      serviceDataRoot = "",
      targetRoot = ""
    } = {}) => [
      ...jskitManagedDatabaseRuntimeConfigRecords({
        projectConfig,
        scope,
        serviceDataRoot,
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
