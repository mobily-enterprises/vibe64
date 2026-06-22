import {
  studioApiPath
} from "@/lib/studioUrls.js";
import {
  vibe64ProjectQueryScope
} from "@/lib/vibe64ProjectScope.js";

const TARGET_PROJECT_API_SUFFIX = "/studio/current-app";
const VIBE64_PROJECT_CONFIG_API_SUFFIX = "/vibe64/project-config";
const VIBE64_PROJECT_CREATE_API_SUFFIX = "/vibe64/projects";
const VIBE64_RUNTIME_CONFIG_API_SUFFIX = "/vibe64/runtime-config";
const VIBE64_RUNTIME_CONFIG_MATERIALIZE_API_SUFFIX = "/vibe64/runtime-config/materialize";
const VIBE64_RUNTIME_CONFIG_USER_VALUES_API_SUFFIX = "/vibe64/runtime-config/user-values";
const VIBE64_PROJECT_SELECT_API_SUFFIX = "/vibe64/projects/select";
const VIBE64_PROJECT_TYPE_API_SUFFIX = "/vibe64/project-type";
const VIBE64_CONNECTIONS_CHANGED_EVENT = "vibe64.connections.changed";
const VIBE64_PROJECT_CHANGED_EVENT = "vibe64.project.changed";

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
const RUNTIME_CONFIG_ENDPOINT = `${VIBE64_ENDPOINT}/runtime-config`;
const RUNTIME_CONFIG_MATERIALIZE_ENDPOINT = `${RUNTIME_CONFIG_ENDPOINT}/materialize`;
const RUNTIME_CONFIG_USER_VALUES_ENDPOINT = `${RUNTIME_CONFIG_ENDPOINT}/user-values`;

const STUDIO_SETUP_TERMINAL_ENDPOINT = `${STUDIO_SETUP_ENDPOINT}/terminal`;
const PROJECT_SETUP_TERMINAL_ENDPOINT = `${PROJECT_SETUP_ENDPOINT}/terminal`;
const STUDIO_SETUP_STREAM_ENDPOINT = `${STUDIO_SETUP_ENDPOINT}/stream`;
const PROJECT_SETUP_STREAM_ENDPOINT = `${PROJECT_SETUP_ENDPOINT}/stream`;

function projectTypeQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "project-type"];
}

function projectSelectionQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "projects"];
}

function projectConfigQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "project-config"];
}

function runtimeConfigQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "runtime-config"];
}

function targetProjectQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "target-project"];
}

function capabilitiesQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "capabilities"];
}

export {
  CAPABILITIES_ENDPOINT,
  VIBE64_CONNECTIONS_CHANGED_EVENT,
  VIBE64_PROJECT_CONFIG_API_SUFFIX,
  VIBE64_PROJECT_CREATE_API_SUFFIX,
  VIBE64_PROJECT_CHANGED_EVENT,
  VIBE64_PROJECT_SELECT_API_SUFFIX,
  VIBE64_PROJECT_TYPE_API_SUFFIX,
  VIBE64_RUNTIME_CONFIG_API_SUFFIX,
  VIBE64_RUNTIME_CONFIG_MATERIALIZE_API_SUFFIX,
  VIBE64_RUNTIME_CONFIG_USER_VALUES_API_SUFFIX,
  PROJECT_CONFIG_ENDPOINT,
  PROJECT_SETUP_ENDPOINT,
  PROJECT_SELECTION_ENDPOINT,
  PROJECT_TYPE_ENDPOINT,
  RUNTIME_CONFIG_ENDPOINT,
  RUNTIME_CONFIG_MATERIALIZE_ENDPOINT,
  RUNTIME_CONFIG_USER_VALUES_ENDPOINT,
  PROJECT_SETUP_STREAM_ENDPOINT,
  PROJECT_SETUP_TERMINAL_ENDPOINT,
  SETUP_READINESS_ENDPOINT,
  SETUP_READINESS_STREAM_ENDPOINT,
  STUDIO_SETUP_ENDPOINT,
  STUDIO_SETUP_STREAM_ENDPOINT,
  STUDIO_SETUP_TERMINAL_ENDPOINT,
  TARGET_PROJECT_API_SUFFIX,
  TARGET_PROJECT_ENDPOINT,
  capabilitiesQueryKey,
  projectConfigQueryKey,
  projectSelectionQueryKey,
  projectTypeQueryKey,
  runtimeConfigQueryKey,
  targetProjectQueryKey
};
