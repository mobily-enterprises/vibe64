import {
  studioApiPath
} from "@/lib/studioUrls.js";
import {
  vibe64ProjectQueryScope
} from "@/lib/vibe64ProjectScope.js";

const TARGET_PROJECT_API_SUFFIX = "/studio/current-app";
const VIBE64_PROJECT_CREATE_API_SUFFIX = "/vibe64/projects";
const VIBE64_ENV_API_SUFFIX = "/vibe64/env";
const VIBE64_ENV_SECRET_REVEAL_API_SUFFIX = "/vibe64/env/reveal";
const VIBE64_ENV_DOWNLOAD_API_SUFFIX = "/vibe64/env/download";
const VIBE64_DEVELOPMENT_DATABASE_API_SUFFIX = "/vibe64/settings/development-database";
const VIBE64_ENGINEERING_API_SUFFIX = "/vibe64/settings/engineering";
const VIBE64_COLLABORATION_API_SUFFIX = "/vibe64/settings/collaboration";
const VIBE64_PROMPT_HINTS_SETTINGS_API_SUFFIX = "/vibe64/settings/prompt-hints";
const VIBE64_ENV_USER_VALUES_API_SUFFIX = "/vibe64/env/user-values";
const VIBE64_PREVIEW_IDENTITIES_API_SUFFIX = "/vibe64/preview-identities";
const VIBE64_PROJECT_SELECT_API_SUFFIX = "/vibe64/projects/select";
const VIBE64_CONNECTIONS_CHANGED_EVENT = "vibe64.connections.changed";
const VIBE64_PROJECT_CHANGED_EVENT = "vibe64.project.changed";

const TARGET_PROJECT_ENDPOINT = studioApiPath("studio/current-app");
const STUDIO_HEALTH_ENDPOINT = studioApiPath("studio/health");
const STUDIO_TOOLS_ENDPOINT = studioApiPath("studio/health/tools");
const VIBE64_ENDPOINT = studioApiPath("vibe64");
const PROJECT_SELECTION_ENDPOINT = `${VIBE64_ENDPOINT}/projects`;
const ENV_ENDPOINT = `${VIBE64_ENDPOINT}/env`;
const ENV_SECRET_REVEAL_ENDPOINT = `${ENV_ENDPOINT}/reveal`;
const ENV_DOWNLOAD_ENDPOINT = `${ENV_ENDPOINT}/download`;
const PROJECT_SETTINGS_ENDPOINT = `${VIBE64_ENDPOINT}/settings`;
const DEVELOPMENT_DATABASE_ENDPOINT = `${PROJECT_SETTINGS_ENDPOINT}/development-database`;
const ENGINEERING_ENDPOINT = `${PROJECT_SETTINGS_ENDPOINT}/engineering`;
const COLLABORATION_ENDPOINT = `${PROJECT_SETTINGS_ENDPOINT}/collaboration`;
const PROMPT_HINTS_SETTINGS_ENDPOINT = `${PROJECT_SETTINGS_ENDPOINT}/prompt-hints`;
const ENV_USER_VALUES_ENDPOINT = `${ENV_ENDPOINT}/user-values`;
const PREVIEW_IDENTITIES_ENDPOINT = `${VIBE64_ENDPOINT}/preview-identities`;

function projectSelectionQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "projects"];
}

function envQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "env"];
}

function projectSettingsQueryKey(surfaceId, ownershipFilter, projectSlug, sessionId = "") {
  return [
    "vibe64",
    ...vibe64ProjectQueryScope(projectSlug),
    surfaceId,
    ownershipFilter,
    "settings",
    String(sessionId || "").trim() || "selected-source"
  ];
}

function engineeringSettingsQueryKey(surfaceId, ownershipFilter, projectSlug, sessionId = "") {
  return [
    "vibe64",
    ...vibe64ProjectQueryScope(projectSlug),
    surfaceId,
    ownershipFilter,
    "engineering",
    String(sessionId || "").trim() || "selected-source"
  ];
}

function previewIdentitiesQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "preview-identities"];
}

function targetProjectQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "target-project"];
}

function studioHealthQueryKey(surfaceId, ownershipFilter) {
  return ["vibe64", surfaceId, ownershipFilter, "studio-health"];
}

export {
  VIBE64_COLLABORATION_API_SUFFIX,
  VIBE64_DEVELOPMENT_DATABASE_API_SUFFIX,
  VIBE64_ENGINEERING_API_SUFFIX,
  VIBE64_CONNECTIONS_CHANGED_EVENT,
  VIBE64_PROJECT_CREATE_API_SUFFIX,
  VIBE64_PROJECT_CHANGED_EVENT,
  VIBE64_PROJECT_SELECT_API_SUFFIX,
  VIBE64_ENV_API_SUFFIX,
  VIBE64_ENV_SECRET_REVEAL_API_SUFFIX,
  VIBE64_ENV_DOWNLOAD_API_SUFFIX,
  VIBE64_ENV_USER_VALUES_API_SUFFIX,
  VIBE64_PREVIEW_IDENTITIES_API_SUFFIX,
  VIBE64_PROMPT_HINTS_SETTINGS_API_SUFFIX,
  PROJECT_SELECTION_ENDPOINT,
  ENV_ENDPOINT,
  ENV_SECRET_REVEAL_ENDPOINT,
  ENV_DOWNLOAD_ENDPOINT,
  DEVELOPMENT_DATABASE_ENDPOINT,
  ENGINEERING_ENDPOINT,
  COLLABORATION_ENDPOINT,
  ENV_USER_VALUES_ENDPOINT,
  PROJECT_SETTINGS_ENDPOINT,
  PROMPT_HINTS_SETTINGS_ENDPOINT,
  PREVIEW_IDENTITIES_ENDPOINT,
  TARGET_PROJECT_API_SUFFIX,
  TARGET_PROJECT_ENDPOINT,
  STUDIO_HEALTH_ENDPOINT,
  STUDIO_TOOLS_ENDPOINT,
  projectSelectionQueryKey,
  envQueryKey,
  engineeringSettingsQueryKey,
  projectSettingsQueryKey,
  previewIdentitiesQueryKey,
  targetProjectQueryKey,
  studioHealthQueryKey
};
