import {
  studioApiPath,
  studioHttpClient
} from "@/lib/studioHttp.js";

const TARGET_PROJECT_API_SUFFIX = "/studio/current-app";
const AI_STUDIO_PROJECT_CONFIG_API_SUFFIX = "/ai-studio/project-config";
const AI_STUDIO_PROJECT_TYPE_API_SUFFIX = "/ai-studio/project-type";

const BOOTSTRAP_ENDPOINT = studioApiPath("studio/bootstrap");
const TARGET_BOOTUP_ENDPOINT = studioApiPath("studio/target-app");
const TARGET_SETUP_ENDPOINT = studioApiPath("studio/app-setup");
const TARGET_PROJECT_ENDPOINT = studioApiPath("studio/current-app");
const AI_STUDIO_ENDPOINT = studioApiPath("ai-studio");
const PROJECT_CONFIG_ENDPOINT = `${AI_STUDIO_ENDPOINT}/project-config`;
const PROJECT_TYPE_ENDPOINT = `${AI_STUDIO_ENDPOINT}/project-type`;

const BOOTSTRAP_TERMINAL_ENDPOINT = `${BOOTSTRAP_ENDPOINT}/terminal`;
const TARGET_BOOTUP_TERMINAL_ENDPOINT = `${TARGET_BOOTUP_ENDPOINT}/terminal`;
const TARGET_SETUP_TERMINAL_ENDPOINT = `${TARGET_SETUP_ENDPOINT}/terminal`;
const BOOTSTRAP_STREAM_ENDPOINT = `${BOOTSTRAP_ENDPOINT}/stream`;
const TARGET_BOOTUP_STREAM_ENDPOINT = `${TARGET_BOOTUP_ENDPOINT}/stream`;
const TARGET_SETUP_STREAM_ENDPOINT = `${TARGET_SETUP_ENDPOINT}/stream`;

function projectTypeQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "project-type"];
}

function projectConfigQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "project-config"];
}

function targetProjectQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "target-project"];
}

async function readBootstrapStatus() {
  return studioHttpClient.get(BOOTSTRAP_ENDPOINT);
}

async function readTargetBootupStatus() {
  return studioHttpClient.get(TARGET_BOOTUP_ENDPOINT);
}

async function readTargetSetupStatus() {
  return studioHttpClient.get(TARGET_SETUP_ENDPOINT);
}

export {
  AI_STUDIO_PROJECT_CONFIG_API_SUFFIX,
  AI_STUDIO_PROJECT_TYPE_API_SUFFIX,
  PROJECT_CONFIG_ENDPOINT,
  PROJECT_TYPE_ENDPOINT,
  TARGET_SETUP_STREAM_ENDPOINT,
  TARGET_SETUP_TERMINAL_ENDPOINT,
  BOOTSTRAP_STREAM_ENDPOINT,
  BOOTSTRAP_TERMINAL_ENDPOINT,
  TARGET_PROJECT_API_SUFFIX,
  TARGET_PROJECT_ENDPOINT,
  TARGET_BOOTUP_STREAM_ENDPOINT,
  TARGET_BOOTUP_TERMINAL_ENDPOINT,
  projectConfigQueryKey,
  projectTypeQueryKey,
  readTargetSetupStatus,
  readBootstrapStatus,
  readTargetBootupStatus,
  targetProjectQueryKey
};
