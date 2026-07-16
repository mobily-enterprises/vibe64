import {
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_SCOPES,
  RUNTIME_CONFIG_TARGETS
} from "@local/vibe64-core/server/runtimeConfig";
import { isPlainObject } from "@local/vibe64-core/server/core";
import {
  JSKIT_APP_AUTH_PROJECT_ENVIRONMENT_KEY,
  JSKIT_AUTH_LOCAL_BACKEND_FILE,
  JSKIT_AUTH_PROVIDER_LOCAL,
  JSKIT_AUTH_PROVIDER_NONE,
  JSKIT_AUTH_PROVIDER_SUPABASE,
  jskitManagedDatabaseEnabled
} from "./appAuthConfig.js";

import {
  JSKIT_MARIADB_APP_USER,
  JSKIT_MARIADB_HOST,
  jskitMariaDbAppPassword,
  jskitMariaDbDatabaseName,
  jskitMariaDbHostPort
} from "./setupMariaDbRuntime.js";

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
  JSKIT_APP_AUTH_RUNTIME_ENV.localBackend,
  JSKIT_APP_AUTH_RUNTIME_ENV.localFileProductionAck,
  JSKIT_APP_AUTH_RUNTIME_ENV.localRecoveryDevOutput,
  JSKIT_APP_AUTH_RUNTIME_ENV.localSessionSecret,
  JSKIT_APP_AUTH_RUNTIME_ENV.localStoreDir,
  "AUTH_PROFILE_MODE",
  JSKIT_APP_AUTH_RUNTIME_ENV.provider
]);
const JSKIT_APP_RUNTIME_CONFIG_TARGETS = Object.freeze([
  RUNTIME_CONFIG_TARGETS.CHECKS,
  RUNTIME_CONFIG_TARGETS.COMMAND,
  RUNTIME_CONFIG_TARGETS.ENV_FILE,
  RUNTIME_CONFIG_TARGETS.LAUNCH_TARGET,
  RUNTIME_CONFIG_TARGETS.SERVER
]);
const JSKIT_LOCAL_AUTH_STORE_DIR = ".jskit/auth";
const JSKIT_LOCAL_AUTH_RECOVERY_DEV_OUTPUT = "log";

function runtimeRecord({
  key = "",
  owner = RUNTIME_CONFIG_OWNERS.VIBE64,
  requiredFor = [],
  scope = RUNTIME_CONFIG_SCOPES.DEV,
  source = "",
  secret,
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
    ...(secret === undefined ? {} : {
      secret: secret === true
    }),
    ...(valuePresent === undefined ? {} : {
      valuePresent
    })
  };
}

function jskitManagedDatabaseRuntimeConfigRecords({
  projectConfig = {},
  scope = RUNTIME_CONFIG_SCOPES.DEV,
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  if (!jskitManagedDatabaseEnabled(projectConfig)) {
    return [];
  }
  const requiredFor = [
    RUNTIME_CONFIG_PHASES.MIGRATE,
    RUNTIME_CONFIG_PHASES.PREVIEW,
    RUNTIME_CONFIG_PHASES.SEED,
    RUNTIME_CONFIG_PHASES.SERVER
  ];
  const source = "jskit-managed-mariadb";
  const databaseRecord = (record) => runtimeRecord({
    ...record,
    requiredFor,
    scope,
    source
  });
  return [
    databaseRecord({
      key: "DB_CLIENT",
      value: "mysql2"
    }),
    databaseRecord({
      key: "DB_HOST",
      value: JSKIT_MARIADB_HOST
    }),
    databaseRecord({
      key: "DB_NAME",
      value: jskitMariaDbDatabaseName(targetRoot)
    }),
    databaseRecord({
      key: "DB_PASSWORD",
      value: jskitMariaDbAppPassword(targetRoot, {
        serviceDataRoot
      })
    }),
    databaseRecord({
      key: "DB_PORT",
      value: jskitMariaDbHostPort(targetRoot, {
        serviceDataRoot
      })
    }),
    databaseRecord({
      key: "DB_USER",
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

function jskitAppAuthRuntimeConfigRecords({
  projectEnvironment = {},
  scope = RUNTIME_CONFIG_SCOPES.DEV
} = {}) {
  const candidate = projectEnvironment?.[JSKIT_APP_AUTH_PROJECT_ENVIRONMENT_KEY];
  const appAuth = isPlainObject(candidate) ? candidate : {};
  const requiredFor = [
    RUNTIME_CONFIG_PHASES.PREVIEW,
    RUNTIME_CONFIG_PHASES.SERVER
  ];
  const provider = String(appAuth.provider || "").trim();
  if (!provider || provider === JSKIT_AUTH_PROVIDER_NONE) {
    return [];
  }
  const source = provider === JSKIT_AUTH_PROVIDER_LOCAL
    ? "jskit-local-auth"
    : "jskit-supabase-auth";
  const authRecord = (record) => runtimeRecord({
    ...record,
    requiredFor,
    scope,
    source
  });
  const authRecords = [authRecord({
    key: JSKIT_APP_AUTH_RUNTIME_ENV.provider,
    value: provider
  })];
  if (provider === JSKIT_AUTH_PROVIDER_LOCAL) {
    const localBackend = String(appAuth.localBackend || JSKIT_AUTH_LOCAL_BACKEND_FILE).trim() ||
      JSKIT_AUTH_LOCAL_BACKEND_FILE;
    authRecords.push(authRecord({
      key: JSKIT_APP_AUTH_RUNTIME_ENV.localBackend,
      value: localBackend
    }));
    if (localBackend === JSKIT_AUTH_LOCAL_BACKEND_FILE) {
      authRecords.push(authRecord({
        key: JSKIT_APP_AUTH_RUNTIME_ENV.localStoreDir,
        value: JSKIT_LOCAL_AUTH_STORE_DIR
      }));
    }
    if (scope === RUNTIME_CONFIG_SCOPES.DEV) {
      authRecords.push(authRecord({
        key: JSKIT_APP_AUTH_RUNTIME_ENV.localRecoveryDevOutput,
        value: JSKIT_LOCAL_AUTH_RECOVERY_DEV_OUTPUT
      }));
    } else {
      authRecords.push(authRecord({
        key: JSKIT_APP_AUTH_RUNTIME_ENV.localSessionSecret,
        secret: true,
        value: "",
        valuePresent: false
      }));
      if (localBackend === JSKIT_AUTH_LOCAL_BACKEND_FILE) {
        authRecords.push(authRecord({
          key: JSKIT_APP_AUTH_RUNTIME_ENV.localFileProductionAck,
          value: "true"
        }));
      }
    }
  }
  if (provider === JSKIT_AUTH_PROVIDER_SUPABASE) {
    const supabase = isPlainObject(appAuth.supabase) ? appAuth.supabase : {};
    const supabaseUrl = String(supabase.url || "").trim();
    const supabasePublishableKey = String(supabase.publishableKey || "").trim();
    authRecords.push(
      authRecord({
        key: JSKIT_APP_AUTH_RUNTIME_ENV.supabaseUrl,
        owner: RUNTIME_CONFIG_OWNERS.USER,
        value: supabaseUrl,
        valuePresent: Boolean(supabaseUrl)
      }),
      authRecord({
        key: JSKIT_APP_AUTH_RUNTIME_ENV.supabasePublishableKey,
        owner: RUNTIME_CONFIG_OWNERS.USER,
        secret: true,
        value: supabasePublishableKey,
        valuePresent: Boolean(supabasePublishableKey)
      })
    );
  }
  return authRecords;
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
      })
    ]
  };
}

export {
  JSKIT_APP_AUTH_RUNTIME_ENV,
  JSKIT_LOCAL_AUTH_STORE_DIR,
  createJskitRuntimeConfigProfile,
  jskitManagedDatabaseRuntimeConfigRecords
};
