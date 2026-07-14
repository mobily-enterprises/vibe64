const JSKIT_AUTH_PROVIDER_CONFIG = "jskit_auth_provider";
const JSKIT_AUTH_LOCAL_BACKEND_CONFIG = "jskit_auth_local_backend";
const JSKIT_SUPABASE_PROJECT_URL_CONFIG = "jskit_supabase_project_url";
const JSKIT_SUPABASE_PUBLISHABLE_KEY_CONFIG = "jskit_supabase_publishable_key";

const JSKIT_AUTH_PROVIDER_LOCAL = "local";
const JSKIT_AUTH_PROVIDER_SUPABASE = "supabase";
const JSKIT_AUTH_LOCAL_BACKEND_FILE = "file";
const JSKIT_AUTH_LOCAL_BACKEND_DB = "db";
const JSKIT_APP_AUTH_ENVIRONMENT_DEV = "dev";
const JSKIT_APP_AUTH_ENVIRONMENT_PROD = "prod";
const JSKIT_APP_AUTH_PROJECT_ENVIRONMENT_KEY = "jskitAppAuth";

const JSKIT_AUTH_PROVIDERS = Object.freeze([
  JSKIT_AUTH_PROVIDER_LOCAL,
  JSKIT_AUTH_PROVIDER_SUPABASE
]);

const JSKIT_AUTH_LOCAL_BACKENDS = Object.freeze([
  JSKIT_AUTH_LOCAL_BACKEND_FILE,
  JSKIT_AUTH_LOCAL_BACKEND_DB
]);

const JSKIT_LOCAL_AUTH_CONDITION = Object.freeze({
  equals: JSKIT_AUTH_PROVIDER_LOCAL,
  field: JSKIT_AUTH_PROVIDER_CONFIG
});

const JSKIT_SUPABASE_CONDITION = Object.freeze({
  equals: JSKIT_AUTH_PROVIDER_SUPABASE,
  field: JSKIT_AUTH_PROVIDER_CONFIG
});

function configValues(projectConfig = {}) {
  return projectConfig?.values && typeof projectConfig.values === "object"
    ? projectConfig.values
    : projectConfig;
}

function normalizeJskitAuthProvider(value = "", {
  fallback = JSKIT_AUTH_PROVIDER_LOCAL
} = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  return JSKIT_AUTH_PROVIDERS.includes(normalized)
    ? normalized
    : fallback;
}

function normalizeJskitAuthLocalBackend(value = "", {
  fallback = JSKIT_AUTH_LOCAL_BACKEND_FILE
} = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  return JSKIT_AUTH_LOCAL_BACKENDS.includes(normalized)
    ? normalized
    : fallback;
}

function normalizeJskitAppAuthEnvironment(value = "", {
  fallback = JSKIT_APP_AUTH_ENVIRONMENT_DEV
} = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  return [
    JSKIT_APP_AUTH_ENVIRONMENT_DEV,
    JSKIT_APP_AUTH_ENVIRONMENT_PROD
  ].includes(normalized)
    ? normalized
    : fallback;
}

function jskitProjectAppAuthConfig(projectConfig = {}, {
  environment = JSKIT_APP_AUTH_ENVIRONMENT_DEV
} = {}) {
  const values = configValues(projectConfig);
  const provider = normalizeJskitAuthProvider(values?.[JSKIT_AUTH_PROVIDER_CONFIG]);
  return {
    environment: normalizeJskitAppAuthEnvironment(environment),
    localBackend: normalizeJskitAuthLocalBackend(values?.[JSKIT_AUTH_LOCAL_BACKEND_CONFIG]),
    provider,
    supabaseProjectUrl: String(values?.[JSKIT_SUPABASE_PROJECT_URL_CONFIG] || "").trim(),
    supabasePublishableKey: String(values?.[JSKIT_SUPABASE_PUBLISHABLE_KEY_CONFIG] || "").trim()
  };
}

function jskitLocalAuthConfigUsesDatabase(projectConfig = {}) {
  const auth = jskitProjectAppAuthConfig(projectConfig);
  return auth.provider === JSKIT_AUTH_PROVIDER_LOCAL &&
    auth.localBackend === JSKIT_AUTH_LOCAL_BACKEND_DB;
}

function jskitAppAuthConfigFields() {
  return [
    {
      defaultValue: JSKIT_AUTH_PROVIDER_LOCAL,
      description: "Authentication provider JSKIT should prepare when the generated app needs sign-in. Local uses JSKIT username/password auth; Supabase is optional and configured by the JSKIT adapter.",
      id: JSKIT_AUTH_PROVIDER_CONFIG,
      label: "Auth provider",
      options: [
        {
          description: "Use JSKIT local username/password auth when the generated app needs sign-in.",
          label: "Local",
          value: JSKIT_AUTH_PROVIDER_LOCAL
        },
        {
          description: "Use Supabase Auth. Configure its URL and publishable key in project Config before seeding or running login-backed workflows.",
          label: "Supabase",
          value: JSKIT_AUTH_PROVIDER_SUPABASE
        }
      ],
      sectionId: "jskit_auth",
      sectionLabel: "JSKIT authentication",
      type: "select"
    },
    {
      defaultValue: JSKIT_AUTH_LOCAL_BACKEND_FILE,
      description: "Storage backend for JSKIT local username/password auth. File stores credentials under the app; Database stores them in the Vibe64-managed database.",
      id: JSKIT_AUTH_LOCAL_BACKEND_CONFIG,
      label: "Local auth backend",
      options: [
        {
          description: "Use JSKIT local auth with file-backed storage.",
          label: "File",
          value: JSKIT_AUTH_LOCAL_BACKEND_FILE
        },
        {
          description: "Use JSKIT local auth with database-backed storage.",
          label: "Database",
          value: JSKIT_AUTH_LOCAL_BACKEND_DB
        }
      ],
      requiredWhen: JSKIT_LOCAL_AUTH_CONDITION,
      sectionId: "jskit_auth",
      sectionLabel: "JSKIT authentication",
      type: "select",
      visibleWhen: JSKIT_LOCAL_AUTH_CONDITION
    },
    {
      defaultValue: "",
      description: "Supabase Project URL used only when JSKIT auth provider is Supabase.",
      id: JSKIT_SUPABASE_PROJECT_URL_CONFIG,
      label: "Supabase URL",
      requiredWhen: JSKIT_SUPABASE_CONDITION,
      scope: "local",
      sectionId: "jskit_auth",
      sectionLabel: "JSKIT authentication",
      type: "string",
      visibleWhen: JSKIT_SUPABASE_CONDITION
    },
    {
      defaultValue: "",
      description: "Supabase publishable key used only when JSKIT auth provider is Supabase. Do not paste a service-role key here.",
      id: JSKIT_SUPABASE_PUBLISHABLE_KEY_CONFIG,
      label: "Supabase publishable key",
      requiredWhen: JSKIT_SUPABASE_CONDITION,
      scope: "local",
      sectionId: "jskit_auth",
      sectionLabel: "JSKIT authentication",
      sensitive: true,
      type: "string",
      visibleWhen: JSKIT_SUPABASE_CONDITION
    }
  ];
}

function normalizeJskitSupabaseAppAuth(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    projectRef: String(source.projectRef || source.ref || "").trim(),
    publishableKey: String(source.publishableKey || "").trim(),
    url: String(source.url || "").trim()
  };
}

function jskitAppAuthEnvironment(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const provider = normalizeJskitAuthProvider(source.provider);
  const appAuth = {
    environment: normalizeJskitAppAuthEnvironment(source.environment),
    localBackend: normalizeJskitAuthLocalBackend(source.localBackend),
    provider,
    source: String(source.source || "").trim(),
    supabase: normalizeJskitSupabaseAppAuth(source.supabase)
  };
  return {
    [JSKIT_APP_AUTH_PROJECT_ENVIRONMENT_KEY]: appAuth
  };
}

export {
  JSKIT_APP_AUTH_ENVIRONMENT_DEV,
  JSKIT_APP_AUTH_ENVIRONMENT_PROD,
  JSKIT_APP_AUTH_PROJECT_ENVIRONMENT_KEY,
  JSKIT_AUTH_LOCAL_BACKEND_CONFIG,
  JSKIT_AUTH_LOCAL_BACKEND_DB,
  JSKIT_AUTH_LOCAL_BACKEND_FILE,
  JSKIT_AUTH_LOCAL_BACKENDS,
  JSKIT_AUTH_PROVIDER_CONFIG,
  JSKIT_AUTH_PROVIDER_LOCAL,
  JSKIT_AUTH_PROVIDER_SUPABASE,
  JSKIT_AUTH_PROVIDERS,
  JSKIT_LOCAL_AUTH_CONDITION,
  JSKIT_SUPABASE_CONDITION,
  JSKIT_SUPABASE_PROJECT_URL_CONFIG,
  JSKIT_SUPABASE_PUBLISHABLE_KEY_CONFIG,
  jskitAppAuthConfigFields,
  jskitAppAuthEnvironment,
  jskitLocalAuthConfigUsesDatabase,
  jskitProjectAppAuthConfig,
  normalizeJskitAppAuthEnvironment,
  normalizeJskitAuthLocalBackend,
  normalizeJskitAuthProvider
};
