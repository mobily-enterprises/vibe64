const JSKIT_AUTH_PROVIDER_CONFIG = "jskit_auth_provider";
const JSKIT_SUPABASE_PROJECT_URL_CONFIG = "jskit_supabase_project_url";
const JSKIT_SUPABASE_PUBLISHABLE_KEY_CONFIG = "jskit_supabase_publishable_key";

const JSKIT_AUTH_PROVIDER_LOCAL = "local";
const JSKIT_AUTH_PROVIDER_SUPABASE = "supabase";
const JSKIT_APP_AUTH_ENVIRONMENT_DEV = "dev";
const JSKIT_APP_AUTH_ENVIRONMENT_PROD = "prod";
const JSKIT_APP_AUTH_PROJECT_ENVIRONMENT_KEY = "jskitAppAuth";

const JSKIT_AUTH_PROVIDERS = Object.freeze([
  JSKIT_AUTH_PROVIDER_LOCAL,
  JSKIT_AUTH_PROVIDER_SUPABASE
]);

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
    provider,
    supabaseProjectUrl: String(values?.[JSKIT_SUPABASE_PROJECT_URL_CONFIG] || "").trim(),
    supabasePublishableKey: String(values?.[JSKIT_SUPABASE_PUBLISHABLE_KEY_CONFIG] || "").trim()
  };
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
          description: "Use Supabase Auth. Configure it from adapter settings before seeding or running login-backed workflows.",
          label: "Supabase",
          value: JSKIT_AUTH_PROVIDER_SUPABASE
        }
      ],
      sectionId: "jskit_auth",
      sectionLabel: "JSKIT authentication",
      type: "select"
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
  JSKIT_AUTH_PROVIDER_CONFIG,
  JSKIT_AUTH_PROVIDER_LOCAL,
  JSKIT_AUTH_PROVIDER_SUPABASE,
  JSKIT_AUTH_PROVIDERS,
  JSKIT_SUPABASE_CONDITION,
  JSKIT_SUPABASE_PROJECT_URL_CONFIG,
  JSKIT_SUPABASE_PUBLISHABLE_KEY_CONFIG,
  jskitAppAuthConfigFields,
  jskitAppAuthEnvironment,
  jskitProjectAppAuthConfig,
  normalizeJskitAppAuthEnvironment,
  normalizeJskitAuthProvider
};
