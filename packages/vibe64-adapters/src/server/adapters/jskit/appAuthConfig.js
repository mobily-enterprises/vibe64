import { readFile } from "node:fs/promises";
import path from "node:path";
import { isPlainObject } from "@local/vibe64-core/server/core";

const JSKIT_DATABASE_RUNTIME_CONFIG = "jskit_database_runtime";
const JSKIT_USER_MODE_CONFIG = "jskit_users";
const JSKIT_USER_MODE_USERS = "users";
const JSKIT_USER_MODE_NONE = "none";

const JSKIT_AUTH_PROVIDER_NONE = "none";
const JSKIT_AUTH_PROVIDER_LOCAL = "local";
const JSKIT_AUTH_PROVIDER_SUPABASE = "supabase";
const JSKIT_AUTH_LOCAL_BACKEND_FILE = "file";
const JSKIT_AUTH_LOCAL_BACKEND_DB = "db";
const JSKIT_APP_AUTH_PROJECT_ENVIRONMENT_KEY = "jskitAppAuth";

const JSKIT_AUTH_PROVIDER_LOCAL_PACKAGE = "@jskit-ai/auth-provider-local-core";
const JSKIT_AUTH_PROVIDER_LOCAL_DB_PACKAGE = "@jskit-ai/auth-provider-local-db-core";
const JSKIT_AUTH_PROVIDER_SUPABASE_PACKAGE = "@jskit-ai/auth-provider-supabase-core";

const JSKIT_AUTH_PROVIDERS = Object.freeze([
  JSKIT_AUTH_PROVIDER_NONE,
  JSKIT_AUTH_PROVIDER_LOCAL,
  JSKIT_AUTH_PROVIDER_SUPABASE
]);

const JSKIT_AUTH_LOCAL_BACKENDS = Object.freeze([
  JSKIT_AUTH_LOCAL_BACKEND_FILE,
  JSKIT_AUTH_LOCAL_BACKEND_DB
]);

const JSKIT_USER_MODES = Object.freeze([
  JSKIT_USER_MODE_USERS,
  JSKIT_USER_MODE_NONE
]);

const JSKIT_USER_CONFIG_FIELDS = Object.freeze([
  {
    defaultValue: JSKIT_USER_MODE_USERS,
    description: "Whether this app has people who sign in. Vibe64 uses local JSKIT accounts; their storage follows the selected database runtime.",
    id: JSKIT_USER_MODE_CONFIG,
    label: "User accounts",
    options: [
      {
        description: "People have accounts and sign in to the app.",
        label: "Users",
        value: JSKIT_USER_MODE_USERS
      },
      {
        description: "Anyone can use the app without signing in.",
        label: "No users",
        value: JSKIT_USER_MODE_NONE
      }
    ],
    sectionId: "jskit_auth",
    sectionLabel: "JSKIT authentication",
    type: "select"
  }
]);

function configValues(projectConfig = {}) {
  return isPlainObject(projectConfig?.values)
    ? projectConfig.values
    : projectConfig;
}

function normalizeChoice(value, choices, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return choices.includes(normalized) ? normalized : fallback;
}

function jskitDatabaseRuntime(projectConfig = {}) {
  const value = String(configValues(projectConfig)?.[JSKIT_DATABASE_RUNTIME_CONFIG] || "").trim().toLowerCase();
  return ["none", "mariadb", "postgres"].includes(value) ? value : "mariadb";
}

function jskitUserMode(projectConfig = {}) {
  return normalizeChoice(
    configValues(projectConfig)?.[JSKIT_USER_MODE_CONFIG],
    JSKIT_USER_MODES,
    JSKIT_USER_MODE_USERS
  );
}

function jskitManagedDatabaseEnabled(projectConfig = {}) {
  return jskitDatabaseRuntime(projectConfig) === "mariadb";
}

async function readOptionalJson(filePath = "") {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      const invalidJson = new Error(`Invalid JSON in JSKIT app state: ${filePath}`);
      invalidJson.code = "vibe64_invalid_jskit_app_state";
      throw invalidJson;
    }
    throw error;
  }
}

async function inspectJskitAppAuthSource(targetRoot = "") {
  const root = String(targetRoot || "").trim();
  const lock = root
    ? await readOptionalJson(path.join(root, ".jskit", "lock.json"))
    : null;
  if (!lock) {
    return {
      available: false,
      provider: JSKIT_AUTH_PROVIDER_NONE,
      supabase: {}
    };
  }
  const installedPackages = isPlainObject(lock.installedPackages)
    ? lock.installedPackages
    : {};
  const supabaseInstalled = Object.hasOwn(installedPackages, JSKIT_AUTH_PROVIDER_SUPABASE_PACKAGE);
  const localInstalled = Object.hasOwn(installedPackages, JSKIT_AUTH_PROVIDER_LOCAL_PACKAGE) ||
    Object.hasOwn(installedPackages, JSKIT_AUTH_PROVIDER_LOCAL_DB_PACKAGE);
  const provider = supabaseInstalled
    ? JSKIT_AUTH_PROVIDER_SUPABASE
    : localInstalled
      ? JSKIT_AUTH_PROVIDER_LOCAL
      : JSKIT_AUTH_PROVIDER_NONE;
  const supabaseOptions = installedPackages[JSKIT_AUTH_PROVIDER_SUPABASE_PACKAGE]?.options;
  const normalizedSupabaseOptions = isPlainObject(supabaseOptions)
    ? supabaseOptions
    : {};
  return {
    available: true,
    provider,
    supabase: {
      publishableKey: String(normalizedSupabaseOptions["auth-supabase-publishable-key"] || "").trim(),
      url: String(normalizedSupabaseOptions["auth-supabase-url"] || "").trim()
    }
  };
}

function jskitAppAuthFromProjectState({
  projectConfig = {},
  sourceAuth = null
} = {}) {
  const sourceAvailable = sourceAuth?.available === true;
  const configuredUserMode = jskitUserMode(projectConfig);
  const provider = sourceAvailable
    ? normalizeChoice(sourceAuth.provider, JSKIT_AUTH_PROVIDERS, JSKIT_AUTH_PROVIDER_NONE)
    : configuredUserMode === JSKIT_USER_MODE_USERS
      ? JSKIT_AUTH_PROVIDER_LOCAL
      : JSKIT_AUTH_PROVIDER_NONE;
  const installedUserMode = provider === JSKIT_AUTH_PROVIDER_NONE
    ? JSKIT_USER_MODE_NONE
    : JSKIT_USER_MODE_USERS;
  return {
    localBackend: jskitDatabaseRuntime(projectConfig) === "none"
      ? JSKIT_AUTH_LOCAL_BACKEND_FILE
      : JSKIT_AUTH_LOCAL_BACKEND_DB,
    provider,
    supabase: {
      publishableKey: String(sourceAuth?.supabase?.publishableKey || "").trim(),
      url: String(sourceAuth?.supabase?.url || "").trim()
    },
    userMode: sourceAvailable ? installedUserMode : configuredUserMode
  };
}

async function resolveJskitProjectAppAuth({
  projectConfig = {},
  sourceAuth,
  targetRoot = ""
} = {}) {
  const inspectedSource = sourceAuth === undefined
    ? await inspectJskitAppAuthSource(targetRoot)
    : sourceAuth;
  return jskitAppAuthFromProjectState({
    projectConfig,
    sourceAuth: inspectedSource
  });
}

function jskitAppAuthEnvironment(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const supabase = isPlainObject(source.supabase)
    ? source.supabase
    : {};
  return {
    [JSKIT_APP_AUTH_PROJECT_ENVIRONMENT_KEY]: {
      localBackend: normalizeChoice(
        source.localBackend,
        JSKIT_AUTH_LOCAL_BACKENDS,
        JSKIT_AUTH_LOCAL_BACKEND_FILE
      ),
      provider: normalizeChoice(
        source.provider,
        JSKIT_AUTH_PROVIDERS,
        JSKIT_AUTH_PROVIDER_NONE
      ),
      supabase: {
        publishableKey: String(supabase.publishableKey || "").trim(),
        url: String(supabase.url || "").trim()
      }
    }
  };
}

export {
  JSKIT_APP_AUTH_PROJECT_ENVIRONMENT_KEY,
  JSKIT_AUTH_LOCAL_BACKEND_DB,
  JSKIT_AUTH_LOCAL_BACKEND_FILE,
  JSKIT_AUTH_PROVIDER_LOCAL,
  JSKIT_AUTH_PROVIDER_LOCAL_DB_PACKAGE,
  JSKIT_AUTH_PROVIDER_LOCAL_PACKAGE,
  JSKIT_AUTH_PROVIDER_NONE,
  JSKIT_AUTH_PROVIDER_SUPABASE,
  JSKIT_AUTH_PROVIDER_SUPABASE_PACKAGE,
  JSKIT_DATABASE_RUNTIME_CONFIG,
  JSKIT_USER_MODE_CONFIG,
  JSKIT_USER_MODE_NONE,
  JSKIT_USER_MODE_USERS,
  JSKIT_USER_CONFIG_FIELDS,
  inspectJskitAppAuthSource,
  jskitAppAuthEnvironment,
  jskitDatabaseRuntime,
  jskitManagedDatabaseEnabled,
  jskitAppAuthFromProjectState,
  jskitUserMode,
  resolveJskitProjectAppAuth
};
