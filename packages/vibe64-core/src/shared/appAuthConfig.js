const VIBE64_APP_AUTH_MODE_CONFIG = "vibe64_app_auth_mode";
const VIBE64_MANUAL_SUPABASE_PROJECT_URL_CONFIG = "vibe64_manual_supabase_project_url";
const VIBE64_MANUAL_SUPABASE_PUBLISHABLE_KEY_CONFIG = "vibe64_manual_supabase_publishable_key";

const VIBE64_APP_AUTH_MODE_NONE = "none";
const VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE = "managed_supabase";
const VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE = "manual_supabase";
const VIBE64_APP_AUTH_ENVIRONMENT_DEV = "dev";
const VIBE64_APP_AUTH_ENVIRONMENT_PROD = "prod";

const VIBE64_APP_AUTH_MODES = Object.freeze([
  VIBE64_APP_AUTH_MODE_NONE,
  VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
  VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE
]);

const VIBE64_MANAGED_SUPABASE_CONDITION = Object.freeze({
  equals: VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
  field: VIBE64_APP_AUTH_MODE_CONFIG
});

const VIBE64_MANUAL_SUPABASE_CONDITION = Object.freeze({
  equals: VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE,
  field: VIBE64_APP_AUTH_MODE_CONFIG
});

const VIBE64_APP_AUTH_ENV = Object.freeze({
  mode: "JSKIT_AUTH_MODE",
  provider: "JSKIT_AUTH_PROVIDER",
  source: "JSKIT_AUTH_SOURCE",
  supabaseProjectRef: "JSKIT_AUTH_SUPABASE_PROJECT_REF",
  supabasePublishableKey: "JSKIT_AUTH_SUPABASE_PUBLISHABLE_KEY",
  supabaseUrl: "JSKIT_AUTH_SUPABASE_URL",
  targetEnvironment: "JSKIT_AUTH_ENVIRONMENT"
});

function normalizeVibe64AppAuthMode(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return VIBE64_APP_AUTH_MODES.includes(normalized)
    ? normalized
    : VIBE64_APP_AUTH_MODE_NONE;
}

function vibe64ProjectAppAuthConfig(projectConfig = {}) {
  const values = projectConfig?.values && typeof projectConfig.values === "object"
    ? projectConfig.values
    : projectConfig;
  return {
    environment: VIBE64_APP_AUTH_ENVIRONMENT_DEV,
    manualSupabaseProjectUrl: String(values?.[VIBE64_MANUAL_SUPABASE_PROJECT_URL_CONFIG] || "").trim(),
    manualSupabasePublishableKey: String(values?.[VIBE64_MANUAL_SUPABASE_PUBLISHABLE_KEY_CONFIG] || "").trim(),
    mode: normalizeVibe64AppAuthMode(values?.[VIBE64_APP_AUTH_MODE_CONFIG])
  };
}

function vibe64AppAuthConfigFields() {
  return [
    {
      defaultValue: VIBE64_APP_AUTH_MODE_NONE,
      description: "How Vibe64 should provide login credentials to generated apps. Managed Supabase uses the shared Vibe64 dev/prod auth projects; manual Supabase uses the URL/key saved below; None means generated apps should not include login unless this is changed.",
      id: VIBE64_APP_AUTH_MODE_CONFIG,
      label: "App login",
      options: [
        {
          description: "Do not configure app login credentials for this project.",
          label: "None",
          value: VIBE64_APP_AUTH_MODE_NONE
        },
        {
          description: "Use the shared Vibe64-managed Supabase Auth projects created from a Supabase Personal Access Token.",
          label: "Managed Supabase",
          value: VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE
        },
        {
          description: "Use a Supabase Project URL and publishable key that you manage outside Vibe64.",
          label: "Manual Supabase",
          value: VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE
        }
      ],
      sectionId: "app_auth",
      sectionLabel: "App login",
      type: "select"
    },
    {
      defaultValue: "",
      description: "Manual Supabase Project URL used only when App login is Manual Supabase. Vibe64 will pass it to supported adapters but will not inspect or sync the Supabase project.",
      id: VIBE64_MANUAL_SUPABASE_PROJECT_URL_CONFIG,
      label: "Manual Supabase URL",
      requiredWhen: VIBE64_MANUAL_SUPABASE_CONDITION,
      scope: "local",
      sectionId: "app_auth",
      sectionLabel: "App login",
      type: "string",
      visibleWhen: VIBE64_MANUAL_SUPABASE_CONDITION
    },
    {
      defaultValue: "",
      description: "Manual Supabase publishable key used only when App login is Manual Supabase. Do not paste a service-role key here.",
      id: VIBE64_MANUAL_SUPABASE_PUBLISHABLE_KEY_CONFIG,
      label: "Manual Supabase publishable key",
      requiredWhen: VIBE64_MANUAL_SUPABASE_CONDITION,
      scope: "local",
      sectionId: "app_auth",
      sectionLabel: "App login",
      sensitive: true,
      type: "string",
      visibleWhen: VIBE64_MANUAL_SUPABASE_CONDITION
    }
  ];
}

function vibe64AppAuthEnvironment(values = {}) {
  const source = values && typeof values === "object" && !Array.isArray(values) ? values : {};
  const entries = Object.entries(source)
    .filter(([, value]) => String(value ?? "").trim());
  return Object.fromEntries(entries);
}

export {
  VIBE64_APP_AUTH_ENV,
  VIBE64_APP_AUTH_ENVIRONMENT_DEV,
  VIBE64_APP_AUTH_ENVIRONMENT_PROD,
  VIBE64_APP_AUTH_MODE_CONFIG,
  VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
  VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE,
  VIBE64_APP_AUTH_MODE_NONE,
  VIBE64_APP_AUTH_MODES,
  VIBE64_MANAGED_SUPABASE_CONDITION,
  VIBE64_MANUAL_SUPABASE_CONDITION,
  VIBE64_MANUAL_SUPABASE_PROJECT_URL_CONFIG,
  VIBE64_MANUAL_SUPABASE_PUBLISHABLE_KEY_CONFIG,
  normalizeVibe64AppAuthMode,
  vibe64AppAuthConfigFields,
  vibe64AppAuthEnvironment,
  vibe64ProjectAppAuthConfig
};
