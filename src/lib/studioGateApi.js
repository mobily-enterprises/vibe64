import {
  studioApiPath,
  studioHttpClient
} from "@/lib/studioHttp.js";
import {
  vibe64WorkspaceQueryScope
} from "@/lib/vibe64WorkspaceScope.js";

const TARGET_PROJECT_API_SUFFIX = "/studio/current-app";
const VIBE64_ACCOUNTS_AUTH_API_SUFFIX = "/vibe64/accounts/auth";
const VIBE64_PROJECT_CONFIG_API_SUFFIX = "/vibe64/project-config";
const VIBE64_PROJECT_CREATE_API_SUFFIX = "/vibe64/projects";
const VIBE64_PROJECT_SELECT_API_SUFFIX = "/vibe64/projects/select";
const VIBE64_PROJECT_TYPE_API_SUFFIX = "/vibe64/project-type";

const ACCOUNTS_ENDPOINT = studioApiPath("vibe64/accounts");
const STUDIO_SETUP_ENDPOINT = studioApiPath("studio/studio-setup");
const PROJECT_SETUP_ENDPOINT = studioApiPath("studio/project-setup");
const TARGET_PROJECT_ENDPOINT = studioApiPath("studio/current-app");
const CAPABILITIES_ENDPOINT = `${TARGET_PROJECT_ENDPOINT}/capabilities`;
const SETUP_READINESS_ENDPOINT = `${TARGET_PROJECT_ENDPOINT}/setup-readiness`;
const SETUP_READINESS_STREAM_ENDPOINT = `${SETUP_READINESS_ENDPOINT}/stream`;
const VIBE64_ENDPOINT = studioApiPath("vibe64");
const PROJECT_SELECTION_ENDPOINT = `${VIBE64_ENDPOINT}/projects`;
const PROJECT_CONFIG_ENDPOINT = `${VIBE64_ENDPOINT}/project-config`;
const PROJECT_TYPE_ENDPOINT = `${VIBE64_ENDPOINT}/project-type`;
const ACCOUNTS_AUTH_ENDPOINT = `${ACCOUNTS_ENDPOINT}/auth`;
const ACCOUNTS_LOGOUT_ENDPOINT = `${ACCOUNTS_ENDPOINT}/logout`;

const STUDIO_SETUP_TERMINAL_ENDPOINT = `${STUDIO_SETUP_ENDPOINT}/terminal`;
const PROJECT_SETUP_TERMINAL_ENDPOINT = `${PROJECT_SETUP_ENDPOINT}/terminal`;
const STUDIO_SETUP_STREAM_ENDPOINT = `${STUDIO_SETUP_ENDPOINT}/stream`;
const PROJECT_SETUP_STREAM_ENDPOINT = `${PROJECT_SETUP_ENDPOINT}/stream`;

function withRefreshQuery(endpoint, {
  refresh = false
} = {}) {
  if (!refresh) {
    return endpoint;
  }
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}refresh=true`;
}

function projectTypeQueryKey(surfaceId, ownershipFilter, workspaceSlug) {
  return ["vibe64", ...vibe64WorkspaceQueryScope(workspaceSlug), surfaceId, ownershipFilter, "project-type"];
}

function projectSelectionQueryKey(surfaceId, ownershipFilter, workspaceSlug) {
  return ["vibe64", ...vibe64WorkspaceQueryScope(workspaceSlug), surfaceId, ownershipFilter, "projects"];
}

function projectConfigQueryKey(surfaceId, ownershipFilter, workspaceSlug) {
  return ["vibe64", ...vibe64WorkspaceQueryScope(workspaceSlug), surfaceId, ownershipFilter, "project-config"];
}

function targetProjectQueryKey(surfaceId, ownershipFilter, workspaceSlug) {
  return ["vibe64", ...vibe64WorkspaceQueryScope(workspaceSlug), surfaceId, ownershipFilter, "target-project"];
}

function accountsQueryKey(surfaceId, ownershipFilter, workspaceSlug) {
  return ["vibe64", ...vibe64WorkspaceQueryScope(workspaceSlug), surfaceId, ownershipFilter, "accounts"];
}

function capabilitiesQueryKey(surfaceId, ownershipFilter, workspaceSlug) {
  return ["vibe64", ...vibe64WorkspaceQueryScope(workspaceSlug), surfaceId, ownershipFilter, "capabilities"];
}

async function readAccountsStatus(options = {}) {
  return studioHttpClient.get(withRefreshQuery(ACCOUNTS_ENDPOINT, options));
}

async function readCapabilitiesStatus() {
  return studioHttpClient.get(CAPABILITIES_ENDPOINT);
}

async function readStudioSetupStatus(options = {}) {
  return studioHttpClient.get(withRefreshQuery(STUDIO_SETUP_ENDPOINT, options));
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
  CAPABILITIES_ENDPOINT,
  VIBE64_ACCOUNTS_AUTH_API_SUFFIX,
  VIBE64_PROJECT_CONFIG_API_SUFFIX,
  VIBE64_PROJECT_CREATE_API_SUFFIX,
  VIBE64_PROJECT_SELECT_API_SUFFIX,
  VIBE64_PROJECT_TYPE_API_SUFFIX,
  PROJECT_CONFIG_ENDPOINT,
  PROJECT_SELECTION_ENDPOINT,
  PROJECT_TYPE_ENDPOINT,
  PROJECT_SETUP_STREAM_ENDPOINT,
  PROJECT_SETUP_TERMINAL_ENDPOINT,
  SETUP_READINESS_ENDPOINT,
  SETUP_READINESS_STREAM_ENDPOINT,
  STUDIO_SETUP_STREAM_ENDPOINT,
  STUDIO_SETUP_TERMINAL_ENDPOINT,
  TARGET_PROJECT_API_SUFFIX,
  TARGET_PROJECT_ENDPOINT,
  accountsQueryKey,
  capabilitiesQueryKey,
  projectConfigQueryKey,
  projectSelectionQueryKey,
  projectTypeQueryKey,
  readAccountsStatus,
  readCapabilitiesStatus,
  readProjectSetupStatus,
  readSetupReadinessStatus,
  readStudioSetupStatus,
  targetProjectQueryKey
};
