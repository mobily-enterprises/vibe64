import {
  studioApiPath,
  studioHttpClient
} from "@/lib/studioHttp.js";

const TARGET_PROJECT_API_SUFFIX = "/studio/current-app";
const AI_STUDIO_ACCOUNTS_AUTH_API_SUFFIX = "/ai-studio/accounts/auth";
const AI_STUDIO_PROJECT_CONFIG_API_SUFFIX = "/ai-studio/project-config";
const AI_STUDIO_PROJECT_TYPE_API_SUFFIX = "/ai-studio/project-type";

const ACCOUNTS_ENDPOINT = studioApiPath("ai-studio/accounts");
const STUDIO_SETUP_ENDPOINT = studioApiPath("studio/studio-setup");
const ADAPTER_SETUP_ENDPOINT = studioApiPath("studio/adapter-setup");
const PROJECT_SETUP_ENDPOINT = studioApiPath("studio/project-setup");
const TARGET_PROJECT_ENDPOINT = studioApiPath("studio/current-app");
const SETUP_READINESS_ENDPOINT = `${TARGET_PROJECT_ENDPOINT}/setup-readiness`;
const SETUP_READINESS_STREAM_ENDPOINT = `${SETUP_READINESS_ENDPOINT}/stream`;
const AI_STUDIO_ENDPOINT = studioApiPath("ai-studio");
const PROJECT_CONFIG_ENDPOINT = `${AI_STUDIO_ENDPOINT}/project-config`;
const PROJECT_TYPE_ENDPOINT = `${AI_STUDIO_ENDPOINT}/project-type`;
const ACCOUNTS_AUTH_ENDPOINT = `${ACCOUNTS_ENDPOINT}/auth`;
const ACCOUNTS_LOGOUT_ENDPOINT = `${ACCOUNTS_ENDPOINT}/logout`;

const STUDIO_SETUP_TERMINAL_ENDPOINT = `${STUDIO_SETUP_ENDPOINT}/terminal`;
const ADAPTER_SETUP_TERMINAL_ENDPOINT = `${ADAPTER_SETUP_ENDPOINT}/terminal`;
const PROJECT_SETUP_TERMINAL_ENDPOINT = `${PROJECT_SETUP_ENDPOINT}/terminal`;
const STUDIO_SETUP_STREAM_ENDPOINT = `${STUDIO_SETUP_ENDPOINT}/stream`;
const ADAPTER_SETUP_STREAM_ENDPOINT = `${ADAPTER_SETUP_ENDPOINT}/stream`;
const PROJECT_SETUP_STREAM_ENDPOINT = `${PROJECT_SETUP_ENDPOINT}/stream`;

function withRefreshQuery(endpoint, {
  refresh = false
} = {}) {
  if (!refresh) {
    return endpoint;
  }
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}refresh=true`;
}

function projectTypeQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "project-type"];
}

function projectConfigQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "project-config"];
}

function targetProjectQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "target-project"];
}

function accountsQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "accounts"];
}

async function readAccountsStatus(options = {}) {
  return studioHttpClient.get(withRefreshQuery(ACCOUNTS_ENDPOINT, options));
}

async function readStudioSetupStatus(options = {}) {
  return studioHttpClient.get(withRefreshQuery(STUDIO_SETUP_ENDPOINT, options));
}

async function readAdapterSetupStatus(options = {}) {
  return studioHttpClient.get(withRefreshQuery(ADAPTER_SETUP_ENDPOINT, options));
}

async function readProjectSetupStatus(options = {}) {
  return studioHttpClient.get(withRefreshQuery(PROJECT_SETUP_ENDPOINT, options));
}

async function readSetupReadinessStatus() {
  return studioHttpClient.get(SETUP_READINESS_ENDPOINT);
}

export {
  ACCOUNTS_AUTH_ENDPOINT,
  ACCOUNTS_ENDPOINT,
  ACCOUNTS_LOGOUT_ENDPOINT,
  AI_STUDIO_ACCOUNTS_AUTH_API_SUFFIX,
  AI_STUDIO_PROJECT_CONFIG_API_SUFFIX,
  AI_STUDIO_PROJECT_TYPE_API_SUFFIX,
  PROJECT_CONFIG_ENDPOINT,
  PROJECT_TYPE_ENDPOINT,
  PROJECT_SETUP_STREAM_ENDPOINT,
  PROJECT_SETUP_TERMINAL_ENDPOINT,
  SETUP_READINESS_ENDPOINT,
  SETUP_READINESS_STREAM_ENDPOINT,
  STUDIO_SETUP_STREAM_ENDPOINT,
  STUDIO_SETUP_TERMINAL_ENDPOINT,
  TARGET_PROJECT_API_SUFFIX,
  TARGET_PROJECT_ENDPOINT,
  ADAPTER_SETUP_STREAM_ENDPOINT,
  ADAPTER_SETUP_TERMINAL_ENDPOINT,
  accountsQueryKey,
  projectConfigQueryKey,
  projectTypeQueryKey,
  readAccountsStatus,
  readProjectSetupStatus,
  readSetupReadinessStatus,
  readStudioSetupStatus,
  readAdapterSetupStatus,
  targetProjectQueryKey
};
