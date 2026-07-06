import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  vibe64EmailConfig,
  vibe64EmailSmtpReady,
} from "@local/vibe64-core/shared";

const VIBE64_MANAGED_APP_AUTH_SERVICE = "feature.vibe64-managed-app-auth.service";
const VIBE64_MANAGED_APP_AUTH_REDIRECT_URL_RESOLVERS_SERVICE = "feature.vibe64-managed-app-auth.redirect-url-resolvers";
const MANAGED_APP_AUTH_ENVIRONMENT_DEV = "dev";
const MANAGED_APP_AUTH_ENVIRONMENT_PROD = "prod";
const MANAGED_APP_AUTH_STATE_VERSION = 1;
const MANAGED_APP_AUTH_CONNECTION_ID = "app_auth";
const SUPABASE_MANAGEMENT_API_BASE_URL = "https://api.supabase.com";
const SUPABASE_APP_AUTH_HOME = "app-auth";
const SUPABASE_PAT_FILE = "personal-access-token";
const SUPABASE_DB_PASSWORDS_FILE = "db-passwords.json";
const SUPABASE_SMTP_LOGIN_FILE = "smtp-login.json";
const SUPABASE_STATE_FILE = "supabase.json";
const SUPABASE_DEFAULT_REGION_GROUP = "americas";
const SUPABASE_REGION_GROUPS = Object.freeze(["americas", "emea", "apac"]);
const SUPABASE_PROJECTS = Object.freeze({
  [MANAGED_APP_AUTH_ENVIRONMENT_DEV]: Object.freeze({
    environment: MANAGED_APP_AUTH_ENVIRONMENT_DEV,
    name: "Vibe64 Auth Dev"
  }),
  [MANAGED_APP_AUTH_ENVIRONMENT_PROD]: Object.freeze({
    environment: MANAGED_APP_AUTH_ENVIRONMENT_PROD,
    name: "Vibe64 Auth Prod"
  })
});

function managedAppAuthResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_managed_app_auth_request_failed",
    fallbackMessage: "Vibe64 managed app auth request failed."
  });
}

function refreshRequested(input = {}) {
  return input?.refresh === true || input?.refresh === "true" || input?.refresh === "1";
}

function managedAppAuthError(code, message, extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    errors: [
      {
        code,
        message
      }
    ],
    ok: false
  };
}

function appAuthConnection({
  connected = false,
  message = "",
  observed = "",
  required = true,
  status = "not_connected",
  syncManaged = false
} = {}) {
  return {
    connected,
    id: MANAGED_APP_AUTH_CONNECTION_ID,
    label: "App login",
    message,
    observed,
    required,
    scope: "app",
    status,
    syncManaged
  };
}

function requireManagement(accountRuntime = null, input = {}) {
  if (typeof accountRuntime?.requireAppAuthManagement === "function") {
    return accountRuntime.requireAppAuthManagement(input);
  }
  return null;
}

function resolveAppAuthRoot(systemRoot = "") {
  return path.join(systemRoot, SUPABASE_APP_AUTH_HOME);
}

function appAuthStatePath(systemRoot = "") {
  return path.join(resolveAppAuthRoot(systemRoot), SUPABASE_STATE_FILE);
}

function appAuthPatPath(root = "") {
  return path.join(root, SUPABASE_PAT_FILE);
}

function appAuthDbPasswordsPath(root = "") {
  return path.join(root, SUPABASE_DB_PASSWORDS_FILE);
}

function appAuthSmtpLoginPath(root = "") {
  return path.join(root, SUPABASE_SMTP_LOGIN_FILE);
}

async function readOptionalText(filePath = "") {
  if (!filePath) {
    return "";
  }
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return "";
    }
    throw error;
  }
}

async function readOptionalJson(filePath = "") {
  const text = await readOptionalText(filePath);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath = "", value = {}) {
  await mkdir(path.dirname(filePath), {
    mode: 0o700,
    recursive: true
  });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(filePath, 0o600);
}

async function writeSecretText(filePath = "", value = "") {
  await mkdir(path.dirname(filePath), {
    mode: 0o700,
    recursive: true
  });
  await writeFile(filePath, `${String(value || "").trim()}\n`, {
    mode: 0o600
  });
  await chmod(filePath, 0o600);
}

async function readStoredToken(appAuthRoot = "") {
  return normalizeText(await readOptionalText(appAuthPatPath(appAuthRoot)));
}

async function writeStoredToken(appAuthRoot = "", accessToken = "") {
  await writeSecretText(appAuthPatPath(appAuthRoot), accessToken);
}

async function writeGeneratedDbPassword(appAuthRoot = "", environment = "", dbPassword = "") {
  const filePath = appAuthDbPasswordsPath(appAuthRoot);
  const existing = await readOptionalJson(filePath) || {};
  await writeJsonFile(filePath, {
    ...existing,
    [environment]: dbPassword
  });
}

async function readStoredSmtpLogin(appAuthRoot = "") {
  return vibe64EmailConfig(await readOptionalJson(appAuthSmtpLoginPath(appAuthRoot)) || {});
}

async function writeStoredSmtpLogin(appAuthRoot = "", value = {}) {
  await writeJsonFile(appAuthSmtpLoginPath(appAuthRoot), vibe64EmailConfig(value));
}

async function removeStoredSmtpLogin(appAuthRoot = "") {
  await rm(appAuthSmtpLoginPath(appAuthRoot), {
    force: true
  });
}

function requireStorageRoots({
  appAuthRoot = "",
  systemRoot = ""
} = {}) {
  if (!systemRoot || !appAuthRoot) {
    throw vibe64Error(
      "Vibe64 managed app auth requires app auth and system storage roots.",
      "vibe64_managed_app_auth_roots_missing"
    );
  }
}

function emptyState() {
  return {
    method: "pat",
    organizationSlug: "",
    projects: {},
    provider: "supabase",
    regionGroup: SUPABASE_DEFAULT_REGION_GROUP,
    updatedAt: "",
    version: MANAGED_APP_AUTH_STATE_VERSION
  };
}

async function readState(systemRoot = "") {
  return {
    ...emptyState(),
    ...await readOptionalJson(appAuthStatePath(systemRoot))
  };
}

async function writeState(systemRoot = "", state = {}) {
  await writeJsonFile(appAuthStatePath(systemRoot), {
    ...emptyState(),
    ...state,
    updatedAt: new Date().toISOString(),
    version: MANAGED_APP_AUTH_STATE_VERSION
  });
}

function normalizeRegionGroup(value = "") {
  const normalized = normalizeText(value).toLowerCase();
  return SUPABASE_REGION_GROUPS.includes(normalized)
    ? normalized
    : SUPABASE_DEFAULT_REGION_GROUP;
}

function generatedDatabasePassword() {
  return `${randomBytes(24).toString("base64url")}aA1!`;
}

function supabaseProjectUrl(ref = "") {
  const projectRef = normalizeText(ref);
  return projectRef ? `https://${projectRef}.supabase.co` : "";
}

function publicProjectRecord(project = {}, fallbackEnvironment = "") {
  const environment = normalizeText(project.environment || fallbackEnvironment);
  const ref = normalizeText(project.ref || project.id);
  const url = normalizeText(project.url) || supabaseProjectUrl(ref);
  const publishableKey = normalizeText(project.publishableKey || project.apiKey);
  return {
    createdAt: normalizeText(project.createdAt),
    environment,
    keyType: normalizeText(project.keyType),
    name: normalizeText(project.name || SUPABASE_PROJECTS[environment]?.name),
    publishableKeyPresent: Boolean(publishableKey),
    ref,
    status: normalizeText(project.status || "unknown"),
    updatedAt: normalizeText(project.updatedAt),
    url
  };
}

function stateProjectRecord({
  apiProject = {},
  environment = "",
  publishableKey = "",
  keyType = ""
} = {}) {
  const ref = normalizeText(apiProject.ref || apiProject.id);
  return {
    createdAt: normalizeText(apiProject.created_at || apiProject.createdAt),
    environment,
    keyType: normalizeText(keyType),
    name: normalizeText(apiProject.name || SUPABASE_PROJECTS[environment]?.name),
    publishableKey: normalizeText(publishableKey),
    ref,
    status: normalizeText(apiProject.status || "unknown"),
    updatedAt: new Date().toISOString(),
    url: supabaseProjectUrl(ref)
  };
}

function publishableApiKey(apiKeys = []) {
  const keys = Array.isArray(apiKeys) ? apiKeys : [];
  return keys.find((key) => normalizeText(key.type) === "publishable" && normalizeText(key.api_key)) || null;
}

function organizationRecords(organizations = []) {
  return (Array.isArray(organizations) ? organizations : [])
    .map((organization) => ({
      name: normalizeText(organization.name),
      slug: normalizeText(organization.slug || organization.id)
    }))
    .filter((organization) => organization.slug)
    .sort((left, right) => left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug));
}

function normalizeStoredProjects(projects = {}) {
  return Object.fromEntries(Object.keys(SUPABASE_PROJECTS).map((environment) => [
    environment,
    publicProjectRecord(projects?.[environment] || {}, environment)
  ]));
}

function projectHasUsableKey(project = {}) {
  return Boolean(normalizeText(project?.url) && normalizeText(project?.publishableKey));
}

function environmentReady(state = {}, environment = MANAGED_APP_AUTH_ENVIRONMENT_DEV) {
  return projectHasUsableKey(state.projects?.[environment]);
}

function stateReady(state = {}) {
  return environmentReady(state, MANAGED_APP_AUTH_ENVIRONMENT_DEV);
}

function emptyRedirectTargets() {
  return {
    all: [],
    [MANAGED_APP_AUTH_ENVIRONMENT_DEV]: [],
    [MANAGED_APP_AUTH_ENVIRONMENT_PROD]: []
  };
}

function normalizeSyncEnvironment(value = "") {
  const environment = normalizeText(value);
  return Object.hasOwn(SUPABASE_PROJECTS, environment) ? environment : "";
}

function normalizeSetupEnvironments(input = {}) {
  const submitted = Array.isArray(input.environments)
    ? input.environments
    : input.environment
      ? [input.environment]
      : [];
  const normalized = submitted
    .map((environment) => normalizeSyncEnvironment(environment))
    .filter(Boolean);
  const unique = [...new Set(normalized)];
  return unique.length
    ? unique
    : [MANAGED_APP_AUTH_ENVIRONMENT_DEV];
}

function addRedirectTargets(targets = emptyRedirectTargets(), urls = [], environment = "") {
  const targetEnvironment = normalizeSyncEnvironment(environment);
  const key = targetEnvironment || "all";
  targets[key] = [
    ...(targets[key] || []),
    ...normalizeRedirectUrls({
      redirectUrls: urls
    })
  ];
  return targets;
}

function addRedirectSource(targets = emptyRedirectTargets(), source = null) {
  if (!source) {
    return targets;
  }
  if (Array.isArray(source)) {
    return addRedirectTargets(targets, source);
  }
  if (typeof source !== "object") {
    return addRedirectTargets(targets, [source]);
  }
  if (source.redirectUrlsByEnvironment && typeof source.redirectUrlsByEnvironment === "object") {
    for (const [environment, urls] of Object.entries(source.redirectUrlsByEnvironment)) {
      addRedirectTargets(targets, Array.isArray(urls) ? urls : [urls], environment);
    }
  }
  addRedirectTargets(targets, [
    source.siteUrl,
    ...(Array.isArray(source.redirectUrls) ? source.redirectUrls : [])
  ], source.environment);
  return targets;
}

async function collectRedirectTargets({
  input = {},
  redirectUrlResolvers = []
} = {}) {
  const targets = addRedirectSource(emptyRedirectTargets(), input);
  const resolvers = Array.isArray(redirectUrlResolvers) ? redirectUrlResolvers : [];
  for (const resolver of resolvers) {
    if (typeof resolver !== "function") {
      continue;
    }
    addRedirectSource(targets, await resolver(input));
  }
  return Object.fromEntries(Object.entries(targets).map(([environment, urls]) => [
    environment,
    [...new Set(normalizeRedirectUrls({
      redirectUrls: urls
    }))].sort((left, right) => left.localeCompare(right))
  ]));
}

function redirectTargetsForProject(targets = {}, environment = "") {
  return [...new Set([
    ...(targets.all || []),
    ...(targets[environment] || [])
  ])].sort((left, right) => left.localeCompare(right));
}

function redirectTargetCount(targets = {}) {
  return Object.values(targets).reduce((count, urls) => count + (Array.isArray(urls) ? urls.length : 0), 0);
}

function publicSmtpLogin(config = {}) {
  const emailConfig = vibe64EmailConfig(config);
  return {
    fromEmail: emailConfig.fromEmail,
    fromName: emailConfig.fromName,
    host: emailConfig.smtpHost,
    passwordPresent: Boolean(emailConfig.smtpPassword),
    port: emailConfig.smtpPort,
    ready: vibe64EmailSmtpReady(emailConfig),
    username: emailConfig.smtpUser
  };
}

function publicStatus({
  organizations = [],
  ready = false,
  state = {},
  smtpConfig = {},
  tokenPresent = false,
  tokenStatus = "unknown"
} = {}) {
  const projects = normalizeStoredProjects(state.projects || {});
  const connected = Boolean(tokenPresent && ready);
  const message = connected
    ? "Vibe64 managed Supabase app login is ready."
    : tokenPresent
      ? "Vibe64 managed Supabase app login needs setup or sync."
      : "Supabase Personal Access Token is not configured.";
  return {
    account: appAuthConnection({
      connected,
      message,
      observed: `Supabase PAT: ${tokenPresent ? "present" : "missing"}. Dev project: ${projects.dev.publishableKeyPresent ? "ready" : "missing"}. Prod project: ${projects.prod.publishableKeyPresent ? "ready" : "missing"}.`,
      required: false,
      status: connected ? "connected" : tokenPresent ? "setup_required" : "not_connected",
      syncManaged: true
    }),
    managed: true,
    method: "pat",
    ok: true,
    organizationSlug: normalizeText(state.organizationSlug),
    organizations: organizationRecords(organizations),
    projects,
    provider: "supabase",
    ready,
    regionGroup: normalizeRegionGroup(state.regionGroup),
    smtp: publicSmtpLogin(smtpConfig),
    tokenPresent,
    tokenStatus,
    updatedAt: normalizeText(state.updatedAt) || new Date().toISOString()
  };
}

function selectedOrganizationSlug(organizations = [], requestedSlug = "") {
  const normalizedRequestedSlug = normalizeText(requestedSlug);
  const records = organizationRecords(organizations);
  if (normalizedRequestedSlug) {
    return records.some((organization) => organization.slug === normalizedRequestedSlug)
      ? normalizedRequestedSlug
      : "";
  }
  return records.length === 1 ? records[0].slug : "";
}

function supabaseApiError(response, body = null, text = "") {
  const message = normalizeText(body?.message || body?.error || text) ||
    `Supabase Management API request failed with HTTP ${response.status}.`;
  const error = vibe64Error(message, response.status === 401 || response.status === 403
    ? "vibe64_supabase_pat_invalid"
    : "vibe64_supabase_api_request_failed");
  error.statusCode = response.status;
  error.responseBody = body;
  return error;
}

function createSupabaseManagementClient({
  accessToken = "",
  apiBaseUrl = SUPABASE_MANAGEMENT_API_BASE_URL,
  fetchImpl = globalThis.fetch
} = {}) {
  const token = normalizeText(accessToken);
  if (!token) {
    throw vibe64Error("Supabase Personal Access Token is required.", "vibe64_supabase_pat_required");
  }
  if (typeof fetchImpl !== "function") {
    throw vibe64Error("Fetch is not available for Supabase Management API requests.", "vibe64_supabase_fetch_unavailable");
  }

  async function request(method, pathname, body = null) {
    const response = await fetchImpl(`${apiBaseUrl}${pathname}`, {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {})
      },
      method
    });
    const text = await response.text();
    const json = parseJson(text);
    if (!response.ok) {
      throw supabaseApiError(response, json, text);
    }
    return json;
  }

  return Object.freeze({
    createProject(body = {}) {
      return request("POST", "/v1/projects", body);
    },
    getApiKeys(ref = "") {
      return request("GET", `/v1/projects/${encodeURIComponent(ref)}/api-keys?reveal=true`);
    },
    getAuthConfig(ref = "") {
      return request("GET", `/v1/projects/${encodeURIComponent(ref)}/config/auth`);
    },
    listOrganizations() {
      return request("GET", "/v1/organizations");
    },
    listProjects() {
      return request("GET", "/v1/projects");
    },
    patchAuthConfig(ref = "", body = {}) {
      return request("PATCH", `/v1/projects/${encodeURIComponent(ref)}/config/auth`, body);
    }
  });
}

function parseJson(text = "") {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function apiProjectsArray(response = null) {
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.projects)) {
    return response.projects;
  }
  return [];
}

function findProjectForEnvironment(projects = [], environment = "", current = {}) {
  const currentRef = normalizeText(current.ref);
  if (currentRef) {
    const byRef = projects.find((project) => normalizeText(project.ref || project.id) === currentRef);
    if (byRef) {
      return byRef;
    }
  }
  const expectedName = SUPABASE_PROJECTS[environment]?.name || "";
  return projects.find((project) => normalizeText(project.name) === expectedName) || null;
}

async function fetchProjectKey(api, apiProject = {}, environment = "") {
  const ref = normalizeText(apiProject.ref || apiProject.id);
  if (!ref) {
    return {
      keyType: "",
      publishableKey: "",
      record: stateProjectRecord({
        apiProject,
        environment
      })
    };
  }
  try {
    const keys = await api.getApiKeys(ref);
    const key = publishableApiKey(keys);
    return {
      keyType: normalizeText(key?.type),
      publishableKey: normalizeText(key?.api_key),
      record: stateProjectRecord({
        apiProject,
        environment,
        keyType: normalizeText(key?.type),
        publishableKey: normalizeText(key?.api_key)
      })
    };
  } catch (error) {
    return {
      error,
      keyType: "",
      publishableKey: "",
      record: stateProjectRecord({
        apiProject,
        environment
      })
    };
  }
}

async function ensureSupabaseProject({
  api,
  environment = "",
  organizationSlug = "",
  appAuthRoot = "",
  regionGroup = SUPABASE_DEFAULT_REGION_GROUP,
  state = {},
  projects = []
} = {}) {
  const existingProject = findProjectForEnvironment(projects, environment, state.projects?.[environment]);
  if (existingProject) {
    return fetchProjectKey(api, existingProject, environment);
  }

  const dbPassword = generatedDatabasePassword();
  const created = await api.createProject({
    db_pass: dbPassword,
    name: SUPABASE_PROJECTS[environment].name,
    organization_slug: organizationSlug,
    region_selection: {
      code: normalizeRegionGroup(regionGroup),
      type: "smartGroup"
    }
  });
  await writeGeneratedDbPassword(appAuthRoot, environment, dbPassword);
  return fetchProjectKey(api, created, environment);
}

function normalizeRedirectUrls(input = {}) {
  const source = [
    input.siteUrl,
    ...(Array.isArray(input.redirectUrls) ? input.redirectUrls : [])
  ];
  return [...new Set(source
    .map((value) => normalizeText(value))
    .filter((value) => {
      if (!value) {
        return false;
      }
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    }))]
    .sort((left, right) => left.localeCompare(right));
}

function mergeRedirectAllowList(existing = "", additions = []) {
  const entries = [
    ...normalizeText(existing).split(/[\s,]+/u),
    ...additions
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return [...new Set(entries)].sort((left, right) => left.localeCompare(right)).join(",");
}

function smtpPortNumber(value = "") {
  const port = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

function supabaseSmtpConfig(emailConfig = {}) {
  if (!vibe64EmailSmtpReady(emailConfig)) {
    return null;
  }
  const smtpPort = smtpPortNumber(emailConfig.smtpPort);
  if (!smtpPort) {
    throw vibe64Error("Email delivery SMTP port must be a number from 1 to 65535.", "vibe64_invalid_smtp_port");
  }
  const senderName = normalizeText(emailConfig.fromName);
  return {
    external_email_enabled: true,
    smtp_admin_email: normalizeText(emailConfig.fromEmail),
    smtp_host: normalizeText(emailConfig.smtpHost),
    smtp_pass: String(emailConfig.smtpPassword ?? ""),
    smtp_port: smtpPort,
    ...(senderName ? { smtp_sender_name: senderName } : {}),
    smtp_user: normalizeText(emailConfig.smtpUser)
  };
}

function missingSmtpLoginFields(config = {}) {
  const normalized = vibe64EmailConfig(config);
  return [
    ["fromEmail", normalized.fromEmail],
    ["smtpHost", normalized.smtpHost],
    ["smtpPassword", normalized.smtpPassword],
    ["smtpPort", normalized.smtpPort],
    ["smtpUser", normalized.smtpUser]
  ]
    .filter(([, value]) => !String(value ?? "").trim())
    .map(([field]) => field);
}

function managedProjectForEnvironment(state = {}, environment = MANAGED_APP_AUTH_ENVIRONMENT_DEV) {
  return state.projects?.[environment] || null;
}

function createManagedAppAuthService({
  accountRuntime = null,
  apiBaseUrl = SUPABASE_MANAGEMENT_API_BASE_URL,
  fetchImpl = globalThis.fetch,
  appAuthRoot = "",
  redirectUrlResolvers = [],
  systemRoot = ""
} = {}) {
  const resolvedSystemRoot = normalizeText(systemRoot || accountRuntime?.systemRoot);
  const resolvedAppAuthRoot = normalizeText(appAuthRoot) || (
    resolvedSystemRoot ? resolveAppAuthRoot(resolvedSystemRoot) : ""
  );

  function api(accessToken = "") {
    return createSupabaseManagementClient({
      accessToken,
      apiBaseUrl,
      fetchImpl
    });
  }

  async function readStoredAuthState() {
    const [state, smtpConfig, token] = await Promise.all([
      readState(resolvedSystemRoot),
      readStoredSmtpLogin(resolvedAppAuthRoot),
      readStoredToken(resolvedAppAuthRoot)
    ]);
    return {
      smtpConfig,
      state,
      token
    };
  }

  async function storedStatus({
    organizations = [],
    tokenStatus = "unknown"
  } = {}) {
    requireStorageRoots({
      appAuthRoot: resolvedAppAuthRoot,
      systemRoot: resolvedSystemRoot
    });
    const { state, smtpConfig, token } = await readStoredAuthState();
    return publicStatus({
      organizations,
      ready: Boolean(token) && stateReady(state),
      state,
      smtpConfig,
      tokenPresent: Boolean(token),
      tokenStatus
    });
  }

  async function refreshStatus() {
    requireStorageRoots({
      appAuthRoot: resolvedAppAuthRoot,
      systemRoot: resolvedSystemRoot
    });
    const { state, smtpConfig, token } = await readStoredAuthState();
    if (!token) {
      return publicStatus({
        ready: false,
        smtpConfig,
        state,
        tokenPresent: false,
        tokenStatus: "missing"
      });
    }
    const supabase = api(token);
    const [organizations, projectsResponse] = await Promise.all([
      supabase.listOrganizations(),
      supabase.listProjects()
    ]);
    const projects = apiProjectsArray(projectsResponse);
    const nextProjects = {
      ...(state.projects || {})
    };
    for (const environment of Object.keys(SUPABASE_PROJECTS)) {
      const apiProject = findProjectForEnvironment(projects, environment, state.projects?.[environment]);
      if (!apiProject) {
        continue;
      }
      const keyed = await fetchProjectKey(supabase, apiProject, environment);
      nextProjects[environment] = keyed.record;
    }
    const nextState = {
      ...state,
      projects: nextProjects
    };
    await writeState(resolvedSystemRoot, nextState);
    return publicStatus({
      organizations,
      ready: stateReady(nextState),
      state: nextState,
      smtpConfig,
      tokenPresent: true,
      tokenStatus: "valid"
    });
  }

  async function connectManagedAuth(input = {}) {
    const managementError = requireManagement(accountRuntime, input);
    if (managementError) {
      return managementError;
    }
    requireStorageRoots({
      appAuthRoot: resolvedAppAuthRoot,
      systemRoot: resolvedSystemRoot
    });
    const accessToken = normalizeText(input.accessToken);
    if (!accessToken) {
      return managedAppAuthError("vibe64_supabase_pat_required", "Supabase Personal Access Token is required.");
    }
    const supabase = api(accessToken);
    const organizations = await supabase.listOrganizations();
    const { state, smtpConfig } = await readStoredAuthState();
    const organizationSlug = selectedOrganizationSlug(
      organizations,
      input.organizationSlug || state.organizationSlug
    );
    const nextState = {
      ...state,
      ...(organizationSlug ? { organizationSlug } : {}),
      regionGroup: normalizeRegionGroup(input.regionGroup || state.regionGroup)
    };
    await Promise.all([
      writeStoredToken(resolvedAppAuthRoot, accessToken),
      writeState(resolvedSystemRoot, nextState)
    ]);
    return publicStatus({
      organizations,
      ready: stateReady(nextState),
      state: nextState,
      smtpConfig,
      tokenPresent: true,
      tokenStatus: "valid"
    });
  }

  async function setupManagedAuth(input = {}) {
    const managementError = requireManagement(accountRuntime, input);
    if (managementError) {
      return managementError;
    }
    requireStorageRoots({
      appAuthRoot: resolvedAppAuthRoot,
      systemRoot: resolvedSystemRoot
    });
    const { state, smtpConfig, token } = await readStoredAuthState();
    const accessToken = normalizeText(input.accessToken) ||
      token;
    if (!accessToken) {
      return managedAppAuthError("vibe64_supabase_pat_required", "Supabase Personal Access Token is required.");
    }
    const supabase = api(accessToken);
    const organizations = await supabase.listOrganizations();
    const organizationSlug = selectedOrganizationSlug(
      organizations,
      input.organizationSlug || state.organizationSlug
    );
    if (!organizationSlug) {
      return managedAppAuthError(
        "vibe64_supabase_organization_required",
        "Choose which Supabase organization Vibe64 should use for managed app auth.",
        {
          organizations: organizationRecords(organizations)
        }
      );
    }

    const regionGroup = normalizeRegionGroup(input.regionGroup || state.regionGroup);
    const setupEnvironments = normalizeSetupEnvironments(input);
    const nextProjects = {
      ...(state.projects || {})
    };
    let nextState = {
      ...state,
      organizationSlug,
      projects: nextProjects,
      regionGroup
    };
    await Promise.all([
      writeStoredToken(resolvedAppAuthRoot, accessToken),
      writeState(resolvedSystemRoot, nextState)
    ]);
    for (const environment of setupEnvironments) {
      const projects = apiProjectsArray(await supabase.listProjects());
      const ensured = await ensureSupabaseProject({
        api: supabase,
        environment,
        organizationSlug,
        projects,
        appAuthRoot: resolvedAppAuthRoot,
        regionGroup,
        state: nextState
      });
      nextProjects[environment] = ensured.record;
      nextState = {
        ...nextState,
        projects: {
          ...nextProjects
        }
      };
      await writeState(resolvedSystemRoot, nextState);
    }

    const status = publicStatus({
      organizations,
      ready: stateReady(nextState),
      state: nextState,
      smtpConfig,
      tokenPresent: true,
      tokenStatus: "valid"
    });
    return {
      ...status,
      ...await bestEffortSyncMetadata({
        reason: "setup"
      })
    };
  }

  async function bestEffortSyncMetadata(input = {}) {
    try {
      const result = await syncManagedAuth(input, {
        requirePermission: false
      });
      return result?.sync
        ? {
            sync: result.sync
          }
        : {};
    } catch (error) {
      return {
        syncError: {
          code: error?.code || "vibe64_managed_app_auth_sync_failed",
          message: String(error?.message || error || "Managed app auth sync failed.")
        }
      };
    }
  }

  async function saveSmtpLogin(input = {}) {
    const managementError = requireManagement(accountRuntime, input);
    if (managementError) {
      return managementError;
    }
    requireStorageRoots({
      appAuthRoot: resolvedAppAuthRoot,
      systemRoot: resolvedSystemRoot
    });
    const existing = await readStoredSmtpLogin(resolvedAppAuthRoot);
    const submittedPassword = String(input.smtpPassword ?? "");
    const nextConfig = vibe64EmailConfig({
      fromEmail: input.fromEmail,
      fromName: input.fromName,
      smtpHost: input.smtpHost,
      smtpPassword: submittedPassword || existing.smtpPassword,
      smtpPort: input.smtpPort,
      smtpUser: input.smtpUser
    });
    const missing = missingSmtpLoginFields(nextConfig);
    if (missing.length) {
      return managedAppAuthError(
        "vibe64_smtp_login_required",
        "Enter SMTP host, port, username, password, and sender email.",
        {
          missing
        }
      );
    }
    supabaseSmtpConfig(nextConfig);
    await writeStoredSmtpLogin(resolvedAppAuthRoot, nextConfig);
    const status = await storedStatus();
    return status.ready
      ? {
          ...status,
          ...await bestEffortSyncMetadata({
            reason: "smtp-login"
          })
        }
      : status;
  }

  async function disconnectSmtpLogin(input = {}) {
    const managementError = requireManagement(accountRuntime, input);
    if (managementError) {
      return managementError;
    }
    requireStorageRoots({
      appAuthRoot: resolvedAppAuthRoot,
      systemRoot: resolvedSystemRoot
    });
    await removeStoredSmtpLogin(resolvedAppAuthRoot);
    return storedStatus();
  }

  async function syncManagedAuth(input = {}, {
    requirePermission = true
  } = {}) {
    if (requirePermission) {
      const managementError = requireManagement(accountRuntime, input);
      if (managementError) {
        return managementError;
      }
    }
    requireStorageRoots({
      appAuthRoot: resolvedAppAuthRoot,
      systemRoot: resolvedSystemRoot
    });
    const token = await readStoredToken(resolvedAppAuthRoot);
    if (!token) {
      return managedAppAuthError("vibe64_supabase_pat_required", "Supabase Personal Access Token is required before sync.");
    }
    const status = await refreshStatus();
    const redirectTargets = await collectRedirectTargets({
      input,
      redirectUrlResolvers
    });
    const smtpConfig = supabaseSmtpConfig(input.smtpConfig || await readStoredSmtpLogin(resolvedAppAuthRoot));
    if (redirectTargetCount(redirectTargets) === 0 && !smtpConfig) {
      return {
        ...status,
        sync: {
          changed: false,
          redirectUrls: [],
          redirectUrlsByEnvironment: redirectTargets,
          smtpConfigured: false,
          syncedAt: new Date().toISOString()
        }
      };
    }

    const supabase = api(token);
    const syncProjects = [];
    for (const project of Object.values(status.projects || {})) {
      if (!project.ref) {
        continue;
      }
      const redirects = redirectTargetsForProject(redirectTargets, project.environment);
      if (!redirects.length && !smtpConfig) {
        continue;
      }
      const body = {
        ...(smtpConfig || {})
      };
      if (redirects.length) {
        const authConfig = await supabase.getAuthConfig(project.ref);
        body.uri_allow_list = mergeRedirectAllowList(authConfig?.uri_allow_list, redirects);
      }
      await supabase.patchAuthConfig(project.ref, body);
      syncProjects.push({
        environment: project.environment,
        ref: project.ref,
        smtpConfigured: Boolean(smtpConfig)
      });
    }
    return {
      ...await refreshStatus(),
      sync: {
        changed: syncProjects.length > 0,
        projects: syncProjects,
        redirectUrls: [...new Set(Object.values(redirectTargets).flat())].sort((left, right) => left.localeCompare(right)),
        redirectUrlsByEnvironment: redirectTargets,
        smtpConfigured: Boolean(smtpConfig),
        syncedAt: new Date().toISOString()
      }
    };
  }

  async function disconnect(input = {}) {
    const managementError = requireManagement(accountRuntime, input);
    if (managementError) {
      return managementError;
    }
    requireStorageRoots({
      appAuthRoot: resolvedAppAuthRoot,
      systemRoot: resolvedSystemRoot
    });
    await rm(appAuthPatPath(resolvedAppAuthRoot), {
      force: true
    });
    return storedStatus({
      tokenStatus: "missing"
    });
  }

  return Object.freeze({
    async disconnect(input = {}) {
      return managedAppAuthResult(() => disconnect(input));
    },

    async getStatus(input = {}) {
      return managedAppAuthResult(() => refreshRequested(input)
        ? refreshStatus()
        : storedStatus());
    },

    async managedSupabaseProject({
      environment = MANAGED_APP_AUTH_ENVIRONMENT_DEV
    } = {}) {
      const normalizedEnvironment = normalizeSyncEnvironment(environment) || MANAGED_APP_AUTH_ENVIRONMENT_DEV;
      if (!resolvedSystemRoot) {
        return {
          environment: normalizedEnvironment,
          projectRef: "",
          publishableKey: "",
          url: ""
        };
      }
      const project = managedProjectForEnvironment(await readState(resolvedSystemRoot), normalizedEnvironment);
      return {
        environment: normalizedEnvironment,
        projectRef: project?.ref || "",
        publishableKey: project?.publishableKey || "",
        url: project?.url || ""
      };
    },

    async connect(input = {}) {
      return managedAppAuthResult(() => connectManagedAuth(input));
    },

    async setup(input = {}) {
      return managedAppAuthResult(() => setupManagedAuth(input));
    },

    async saveSmtpLogin(input = {}) {
      return managedAppAuthResult(() => saveSmtpLogin(input));
    },

    async sync(input = {}) {
      return managedAppAuthResult(() => syncManagedAuth(input));
    },

    async syncSystem(input = {}) {
      return managedAppAuthResult(() => syncManagedAuth(input, {
        requirePermission: false
      }));
    },

    async disconnectSmtpLogin(input = {}) {
      return managedAppAuthResult(() => disconnectSmtpLogin(input));
    }
  });
}

export {
  MANAGED_APP_AUTH_CONNECTION_ID,
  SUPABASE_PROJECTS,
  VIBE64_MANAGED_APP_AUTH_REDIRECT_URL_RESOLVERS_SERVICE,
  VIBE64_MANAGED_APP_AUTH_SERVICE,
  appAuthPatPath,
  appAuthSmtpLoginPath,
  appAuthStatePath,
  createManagedAppAuthService,
  createSupabaseManagementClient,
  managedProjectForEnvironment,
  resolveAppAuthRoot,
  stateReady
};
