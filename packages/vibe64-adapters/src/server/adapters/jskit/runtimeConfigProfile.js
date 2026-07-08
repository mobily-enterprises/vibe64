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
  JSKIT_AUTH_LOCAL_BACKEND_DB,
  JSKIT_AUTH_LOCAL_BACKEND_FILE,
  JSKIT_AUTH_PROVIDER_LOCAL,
  JSKIT_AUTH_PROVIDER_SUPABASE,
  jskitLocalAuthConfigUsesDatabase
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
  localBackend: "AUTH_LOCAL_BACKEND",
  localFileProductionAck: "AUTH_LOCAL_FILE_PRODUCTION_ACK",
  localRecoveryDevOutput: "AUTH_LOCAL_RECOVERY_DEV_OUTPUT",
  localSessionSecret: "AUTH_LOCAL_SESSION_SECRET",
  localStoreDir: "AUTH_LOCAL_STORE_DIR",
  provider: "AUTH_PROVIDER",
  supabasePublishableKey: "AUTH_SUPABASE_PUBLISHABLE_KEY",
  supabaseUrl: "AUTH_SUPABASE_URL"
});
const JSKIT_RESERVED_USER_ENV_KEYS = Object.freeze([
  "AUTH_LOCAL_BACKEND",
  "AUTH_LOCAL_FILE_PRODUCTION_ACK",
  "AUTH_LOCAL_RECOVERY_DEV_OUTPUT",
  "AUTH_LOCAL_SESSION_SECRET",
  "AUTH_LOCAL_STORE_DIR",
  "AUTH_PROFILE_MODE",
  "AUTH_PROVIDER",
  "AUTH_SUPABASE_PUBLISHABLE_KEY",
  "AUTH_SUPABASE_URL",
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
const JSKIT_LOCAL_AUTH_STORE_DIR = ".jskit/auth";
const JSKIT_LOCAL_AUTH_RECOVERY_DEV_OUTPUT = "log";

function configValue(config = {}, key = "", fallback = "") {
  return String(config?.values?.[key] ?? fallback).trim();
}

function jskitDatabaseRuntime(projectConfig = {}) {
  return configValue(projectConfig, JSKIT_DATABASE_RUNTIME_CONFIG, "mariadb") || "mariadb";
}

function jskitLocalAuthBackend(projectEnvironment = {}) {
  const appAuth = jskitAppAuthProjectEnvironment(projectEnvironment);
  return String(appAuth.localBackend || JSKIT_AUTH_LOCAL_BACKEND_FILE).trim() || JSKIT_AUTH_LOCAL_BACKEND_FILE;
}

function jskitLocalAuthUsesDatabase(projectEnvironment = {}) {
  const appAuth = jskitAppAuthProjectEnvironment(projectEnvironment);
  return appAuth.provider === JSKIT_AUTH_PROVIDER_LOCAL &&
    jskitLocalAuthBackend(projectEnvironment) === JSKIT_AUTH_LOCAL_BACKEND_DB;
}

function jskitConfigNeedsManagedMariaDb({
  projectConfig = {},
  projectEnvironment = {}
} = {}) {
  return jskitDatabaseRuntime(projectConfig) === "mariadb" ||
    jskitLocalAuthConfigUsesDatabase(projectConfig) ||
    jskitLocalAuthUsesDatabase(projectEnvironment);
}

function runtimeRecord({
  key = "",
  owner = RUNTIME_CONFIG_OWNERS.VIBE64,
  requiredFor = [],
  scope = RUNTIME_CONFIG_SCOPES.DEV,
  source = "",
  targets = JSKIT_APP_RUNTIME_CONFIG_TARGETS,
  value = "",
  valuePresent
} = {}) {
  return {
    key,
    owner,
    requiredFor,
    scope,
    source,
    targets,
    value,
    ...(valuePresent === undefined ? {} : {
      valuePresent
    })
  };
}

function jskitManagedDatabaseRuntimeConfigRecords({
  projectConfig = {},
  projectEnvironment = {},
  scope = RUNTIME_CONFIG_SCOPES.DEV,
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  if (!jskitConfigNeedsManagedMariaDb({
    projectConfig,
    projectEnvironment
  })) {
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
  return appAuth.provider === JSKIT_AUTH_PROVIDER_SUPABASE
    ? RUNTIME_CONFIG_OWNERS.USER
    : RUNTIME_CONFIG_OWNERS.VIBE64;
}

function jskitAppAuthSource(projectEnvironment = {}) {
  const appAuth = jskitAppAuthProjectEnvironment(projectEnvironment);
  if (appAuth.provider === JSKIT_AUTH_PROVIDER_LOCAL) {
    return "jskit-local-auth";
  }
  if (appAuth.provider === JSKIT_AUTH_PROVIDER_SUPABASE) {
    return "jskit-supabase-auth";
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
  const localBackend = jskitLocalAuthBackend(projectEnvironment);
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
  if (provider === JSKIT_AUTH_PROVIDER_LOCAL) {
    authRecords.push({
      key: JSKIT_APP_AUTH_RUNTIME_ENV.localBackend,
      value: localBackend
    });
    if (localBackend === JSKIT_AUTH_LOCAL_BACKEND_FILE) {
      authRecords.push({
        key: JSKIT_APP_AUTH_RUNTIME_ENV.localStoreDir,
        value: JSKIT_LOCAL_AUTH_STORE_DIR
      });
    }
    if (scope === RUNTIME_CONFIG_SCOPES.DEV) {
      authRecords.push({
        key: JSKIT_APP_AUTH_RUNTIME_ENV.localRecoveryDevOutput,
        value: JSKIT_LOCAL_AUTH_RECOVERY_DEV_OUTPUT
      });
    } else {
      authRecords.push({
        key: JSKIT_APP_AUTH_RUNTIME_ENV.localSessionSecret,
        value: "",
        valuePresent: false
      });
      if (localBackend === JSKIT_AUTH_LOCAL_BACKEND_FILE) {
        authRecords.push({
          key: JSKIT_APP_AUTH_RUNTIME_ENV.localFileProductionAck,
          value: "true"
        });
      }
    }
  }
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
      value: record.value,
      valuePresent: record.valuePresent
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
        projectEnvironment,
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
  JSKIT_LOCAL_AUTH_RECOVERY_DEV_OUTPUT,
  JSKIT_LOCAL_AUTH_STORE_DIR,
  JSKIT_LOCAL_APP_PUBLIC_URL,
  createJskitRuntimeConfigProfile,
  jskitConfigNeedsManagedMariaDb,
  jskitAppAuthRuntimeConfigRecords,
  jskitDevAuthRuntimeConfigRecords,
  jskitManagedDatabaseRuntimeConfigRecords
};
